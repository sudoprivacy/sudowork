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
import { ensureNodeInstalled } from './services/claudeCli/NodeRuntimeService';
import { getChannelManager } from '@/channels';
import { ExtensionRegistry } from '@/extensions';
import { initStatusManager } from './services/initStatus';

export const initializeProcess = async () => {
  // Keep ~/.sudowork/electron-path fresh so CLI wrappers always find the binary
  syncElectronPath();

  // Start async installation of runtime dependencies (non-blocking)
  void installRuntimes();

  await initStorage();

  // Initialize bridge after storage is ready (dynamic import for correct order)
  try {
    await import('./initBridge');
    console.log('[Process] Bridge initialized successfully');
  } catch (error) {
    console.error('[Process] Bridge initialization failed:', error);
  }

  // Initialize Extension Registry (scan and resolve all extensions)
  try {
    await ExtensionRegistry.getInstance().initialize();
  } catch (error) {
    console.error('[Process] Failed to initialize ExtensionRegistry:', error);
    // Don't fail app startup if extensions fail to initialize
  }

  // Initialize Channel subsystem
  try {
    await getChannelManager().initialize();
  } catch (error) {
    console.error('[Process] Failed to initialize ChannelManager:', error);
  }

  // Start Nexus Python server in the background (non-blocking)
  // The startNexusService function is in a separate file that won't be analyzed during build
  void import('./startNexusService')
    .then(({ startNexusService }) => startNexusService())
    .catch((error) => {
      console.error('[Process] Failed to start Nexus server:', error);
    });
};

/**
 * Install runtime dependencies (Node.js, Sudoclaw, CLI tools) asynchronously
 * Updates initStatusManager so renderer can display progress
 */
async function installRuntimes(): Promise<void> {
  // Install bundled Node.js (progress: 10-20%)
  try {
    initStatusManager.setStatus('installing', '组件安装中', 10);
    await ensureNodeInstalled();
  } catch (err) {
    console.error('[Process] Node.js runtime install failed:', err);
    initStatusManager.setStatus('error', '安装失败', 0, err instanceof Error ? err.message : String(err));
    return;
  }

  // Install Sudoclaw (built-in OpenClaw) (progress: 30-50%)
  try {
    initStatusManager.setStatus('installing', '组件安装中', 30);
    const { ensureSudoclawInstalled } = await import('./services/sudoclaw/SudoclawInstallService');
    await ensureSudoclawInstalled();
  } catch (err) {
    console.error('[Process] Sudoclaw install failed:', err);
    initStatusManager.setStatus('error', '安装失败', 0, err instanceof Error ? err.message : String(err));
    return;
  }

  // Install CLI tools (Claude Code, Gemini) (progress: 60-90%)
  try {
    initStatusManager.setStatus('installing', '组件安装中', 60);
    const { claudeCliService, geminiCliService } = await import('./services/claudeCli/CliInstallService');

    // Install Claude CLI if bundle exists
    if (claudeCliService.hasTgzResource()) {
      const status = await claudeCliService.checkInstalled();
      if (!status.installed) {
        console.log('[Process] Installing Claude CLI...');
        await claudeCliService.install();
      }
    }
    initStatusManager.setStatus('installing', '组件安装中', 75);

    // Install Gemini CLI if bundle exists
    if (geminiCliService.hasTgzResource()) {
      const status = await geminiCliService.checkInstalled();
      if (!status.installed) {
        console.log('[Process] Installing Gemini CLI...');
        await geminiCliService.install();
      }
    }

    initStatusManager.setStatus('ready', '初始化完成', 100);
  } catch (err) {
    console.error('[Process] CLI tools install failed:', err);
    // CLI install failure is not critical, continue to ready
    initStatusManager.setStatus('ready', '初始化完成', 100);
  }
}
