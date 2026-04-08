/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';

// Force node-gyp-build to skip build/ directory and use prebuilds/ only in production
// This prevents loading wrong architecture binaries from development environment
// Only apply in packaged app to allow development builds to use build/Release/
if (app.isPackaged) {
  process.env.PREBUILDS_ONLY = '1';
}
import initStorage from './initStorage';
// initBridge is dynamically imported in initializeProcess() to ensure correct initialization order
import './i18n'; // Initialize i18n for main process
import { syncElectronPath } from './services/claudeCli/CliInstallService';
import { getChannelManager } from '@/channels';
import { ExtensionRegistry } from '@/extensions';
import { mainLog, mainError, mainWarn, perfLog } from './utils/mainLogger';
import { checkForResume } from './services/sudoclaw/StatePointer';

export const initializeProcess = async () => {
  const totalStart = Date.now();
  mainLog('Process', 'Initializing process...');

  // Keep ~/.sudowork/electron-path fresh so CLI wrappers always find the binary
  syncElectronPath();

  // 1. Initialize storage first (required for bridges)
  const storageStart = Date.now();
  await initStorage();
  perfLog('initStorage', Date.now() - storageStart);

  // 2. Initialize bridge as soon as storage is ready
  // This ensures the renderer can communicate with the backend even while runtimes are installing
  const bridgeStart = Date.now();
  try {
    await import('./initBridge');
    mainLog('Process', 'Bridge initialized successfully');
  } catch (error) {
    mainError('Process', 'Bridge initialization failed', error);
  }
  perfLog('initBridge', Date.now() - bridgeStart);

  // 3. Start ServiceManager — installs missing runtimes & starts services (non-blocking)
  //    Handles: Node.js, Sudoclaw, Nexus install + OpenClaw gateway + Nexus + SafetyPollingService
  const { serviceManager } = await import('./services/serviceManager');
  void serviceManager.startup();

  // Initialize Extension Registry and Channel subsystem in parallel (they are independent)
  const parallelStart = Date.now();
  await Promise.all([
    (async () => {
      const extStart = Date.now();
      try {
        await ExtensionRegistry.getInstance().initialize();
      } catch (error) {
        mainError('Process', 'Failed to initialize ExtensionRegistry', error);
      }
      perfLog('ExtensionRegistry', Date.now() - extStart);
    })(),
    (async () => {
      const channelStart = Date.now();
      try {
        await getChannelManager().initialize();
      } catch (error) {
        mainError('Process', 'Failed to initialize ChannelManager', error);
      }
      perfLog('ChannelManager', Date.now() - channelStart);
    })(),
  ]);
  perfLog('ExtensionRegistry+ChannelManager(parallel)', Date.now() - parallelStart);

  // 4. SudoClaw crash recovery — check for a valid state pointer and auto-resume
  //    Runs after channels are initialized so re-notifications can be delivered.
  const resumeStart = Date.now();
  try {
    await attemptSudoClawResume();
  } catch (error) {
    mainError('Process', 'SudoClaw crash recovery failed', error);
  }
  perfLog('sudoclawResume', Date.now() - resumeStart);

  perfLog('total_startup', Date.now() - totalStart);
  mainLog('Process', `Initialization complete in ${Date.now() - totalStart}ms`);
};

// ────────────────────────────────────────────────────────────────────────────
//  SudoClaw crash recovery
// ────────────────────────────────────────────────────────────────────────────

/**
 * Attempt to resume SudoClaw from a crash-time state pointer.
 *
 * Flow:
 * 1. Read ~/.sudowork/sudoclaw-state.json
 * 2. Validate: must be non-expired (4h TTL) + enabled + resumable state
 * 3. If valid → call SudoClawManager.resume() (once available)
 * 4. If requires_action was pending → re-fire notifications to all channels
 */
async function attemptSudoClawResume(): Promise<void> {
  const result = checkForResume();

  if (!result.shouldResume || !result.pointer) {
    mainLog('Process', 'SudoClaw resume: no valid state pointer found — skipping');
    return;
  }

  mainLog('Process', `SudoClaw resume: recovering from state=${result.pointer.state}, pendingAction=${result.pendingAction}`);

  // Attempt to call SudoClawManager.resume() if available.
  // The manager may not exist yet (depends on #217 IPC bridge merge).
  // This try/catch ensures graceful degradation until the manager is wired up.
  try {
    const managerModule = await import('./services/sudoclaw/SudoClawManager').catch(() => null);
    if (managerModule?.SudoClawManager) {
      const manager = managerModule.SudoClawManager.getInstance?.() ?? managerModule.SudoClawManager;
      if (typeof manager.resume === 'function') {
        await manager.resume(result.pointer);
        mainLog('Process', 'SudoClaw resume: manager.resume() completed');
      } else {
        mainWarn('Process', 'SudoClaw resume: SudoClawManager.resume() not yet implemented — skipping resume');
      }
    } else {
      mainWarn('Process', 'SudoClaw resume: SudoClawManager not yet available — skipping resume');
    }
  } catch (error) {
    mainError('Process', 'SudoClaw resume: failed to call SudoClawManager.resume()', error);
  }

  // Re-fire notifications if requires_action was pending at crash time.
  // This ensures the user is reminded to take action even after a restart.
  if (result.pendingAction) {
    try {
      await renotifyPendingAction(result.pointer);
    } catch (error) {
      mainError('Process', 'SudoClaw resume: failed to re-notify pending action', error);
    }
  }
}

/**
 * Re-fire notifications to all active channels when `requires_action`
 * was pending at crash time.
 *
 * This ensures the user sees the action prompt on all connected platforms
 * (Telegram, Lark, DingTalk, WeChat, WeCom, etc.) after a restart.
 */
async function renotifyPendingAction(pointer: import('./services/sudoclaw/StatePointer').SudoClawStatePointer): Promise<void> {
  mainLog('Process', 'SudoClaw resume: re-notifying pending requires_action');

  const channelManager = getChannelManager();
  const pluginManager = channelManager.getPluginManager();
  const sessionManager = channelManager.getSessionManager();

  if (!pluginManager) {
    mainWarn('Process', 'SudoClaw resume: PluginManager not available — cannot re-notify');
    return;
  }

  const message = [
    '[SudoClaw] Action required after restart',
    `SudoClaw was in "requires_action" state when the app last exited.`,
    pointer.conversationId ? `Conversation: ${pointer.conversationId}` : '',
    'Please check and take the required action to continue.',
  ]
    .filter(Boolean)
    .join('\n');

  // Find all connected plugins and broadcast to sessions with active chat IDs
  const pluginStatuses = pluginManager.getPluginStatuses();
  const connectedPlugins = pluginStatuses.filter((p) => p.connected);
  const sessions = sessionManager?.getAllSessions() ?? [];
  const sessionsWithChat = sessions.filter((s) => s.chatId);
  let notified = 0;

  for (const pluginStatus of connectedPlugins) {
    for (const session of sessionsWithChat) {
      try {
        await pluginManager.sendMessage(pluginStatus.id, session.chatId!, { text: message });
        notified++;
      } catch (error) {
        mainWarn('Process', `SudoClaw resume: failed to notify via plugin ${pluginStatus.id}`, error);
      }
    }
  }

  mainLog('Process', `SudoClaw resume: re-notified ${notified} channel(s)`);
}
