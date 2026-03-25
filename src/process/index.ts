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

  // 1. Initialize storage first (required for bridges)
  await initStorage();

  // 2. Initialize bridge as soon as storage is ready
  // This ensures the renderer can communicate with the backend even while runtimes are installing
  try {
    await import('./initBridge');
    console.log('[Process] Bridge initialized successfully');
  } catch (error) {
    console.error('[Process] Bridge initialization failed:', error);
  }

  // 3. Start async installation of runtime dependencies (non-blocking)
  // Now that bridges are ready, the renderer will receive status updates
  void installRuntimes();

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
 * Install runtime dependencies (Node.js, Sudoclaw, Nexus) asynchronously
 * Only runs on macOS - Windows installs via NSIS installer
 * Updates initStatusManager so renderer can display progress
 */
async function installRuntimes(): Promise<void> {
  // Skip on Windows - installed by NSIS installer
  if (process.platform === 'win32') {
    console.log('[Process] Skipping runtime installation on Windows (installed by NSIS)');
    initStatusManager.setStatus('ready', '初始化完成', 100);
    return;
  }

  // Check if all components are already installed
  console.log('[Process] Checking runtime dependencies...');
  const [{ dynamicNexusService }, { ensureSudoclawInstalled }] = await Promise.all([
    import('./services/nexus/DynamicNexusService'),
    import('./services/sudoclaw/SudoclawInstallService'),
  ]);

  const nodeInstalled = await checkNodeInstalled();
  const sudoclawInstalled = await checkSudoclawInstalled();
  const nexusInstalled = await dynamicNexusService.checkInstalled();

  if (nodeInstalled && sudoclawInstalled && nexusInstalled) {
    console.log('[Process] All runtimes already installed, skipping installation');
    // Still need to repair config in case it's outdated
    try {
      const { repairOpenClawConfig } = await import('./services/sudoclaw/SudoclawInstallService');
      repairOpenClawConfig();
    } catch {
      // ignore
    }
    initStatusManager.setStatus('ready', '初始化完成', 100);
    return;
  }

  // Install bundled Node.js (progress: 10-25%)
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
    await ensureSudoclawInstalled();
  } catch (err) {
    console.error('[Process] Sudoclaw install failed:', err);
    initStatusManager.setStatus('error', '安装失败', 0, err instanceof Error ? err.message : String(err));
    return;
  }

  // Install Nexus (progress: 60-90%)
  try {
    initStatusManager.setStatus('installing', '组件安装中', 60);

    // Only install if bundled resource exists
    const isInstalled = await dynamicNexusService.checkInstalled();
    if (!isInstalled) {
      console.log('[Process] Installing Nexus...');
      await dynamicNexusService.install();
      // Auto-start Nexus after installation
      console.log('[Process] Starting Nexus after installation...');
      await dynamicNexusService.start();
    }
  } catch (err) {
    console.error('[Process] Nexus install failed:', err);
    // Nexus install failure is not critical, continue
  }

  initStatusManager.setStatus('ready', '初始化完成', 100);
}

/** Check if Node.js runtime is already installed */
async function checkNodeInstalled(): Promise<boolean> {
  try {
    const { isNodeInstalled } = await import('./services/claudeCli/NodeRuntimeService');
    return isNodeInstalled();
  } catch {
    return false;
  }
}

/** Check if Sudoclaw is already installed */
async function checkSudoclawInstalled(): Promise<boolean> {
  try {
    const { getSudoclawCliPath } = await import('./services/sudoclaw/SudoclawInstallService');
    return getSudoclawCliPath() !== null;
  } catch {
    return false;
  }
}
