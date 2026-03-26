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
import { mainLog, mainWarn, mainError, perfLog } from './utils/mainLogger';

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

  // 3. Start async installation of runtime dependencies (non-blocking)
  // Now that bridges are ready, the renderer will receive status updates
  void installRuntimes();

  // Initialize Extension Registry (scan and resolve all extensions)
  const extStart = Date.now();
  try {
    await ExtensionRegistry.getInstance().initialize();
  } catch (error) {
    mainError('Process', 'Failed to initialize ExtensionRegistry', error);
  }
  perfLog('ExtensionRegistry', Date.now() - extStart);

  // Initialize Channel subsystem
  const channelStart = Date.now();
  try {
    await getChannelManager().initialize();
  } catch (error) {
    mainError('Process', 'Failed to initialize ChannelManager', error);
  }
  perfLog('ChannelManager', Date.now() - channelStart);

  perfLog('total_startup', Date.now() - totalStart);
  mainLog('Process', `Initialization complete in ${Date.now() - totalStart}ms`);

  // Start Nexus Python server in the background (non-blocking)
  // The startNexusService function is in a separate file that won't be analyzed during build
  void import('./startNexusService')
    .then(({ startNexusService }) => startNexusService())
    .catch((error) => {
      mainError('Process', 'Failed to start Nexus server', error);
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
    mainLog('Runtime', 'Skipping runtime installation on Windows (installed by NSIS)');
    initStatusManager.setStatus('ready', '初始化完成', 100);
    // Start Sudoclaw gateway in background (non-blocking)
    void startSudoclawGatewayInBackground();
    return;
  }

  // Check which components are already installed
  mainLog('Runtime', 'Checking runtime dependencies...');
  const [{ dynamicNexusService }, { ensureSudoclawInstalled }] = await Promise.all([import('./services/nexus/DynamicNexusService'), import('./services/sudoclaw/SudoclawInstallService')]);

  const nodeInstalled = await checkNodeInstalled();
  const sudoclawInstalled = await checkSudoclawInstalled();
  const nexusInstalled = await dynamicNexusService.checkInstalled();

  mainLog('Runtime', `Runtime status: Node=${nodeInstalled}, Sudoclaw=${sudoclawInstalled}, Nexus=${nexusInstalled}`);

  // All components present — go directly to ready without showing "组件安装中"
  if (nodeInstalled && sudoclawInstalled && nexusInstalled) {
    mainLog('Runtime', 'All runtimes already installed, skipping installation');
    try {
      const { repairOpenClawConfig } = await import('./services/sudoclaw/SudoclawInstallService');
      repairOpenClawConfig();
    } catch {
      // ignore
    }
    initStatusManager.setStatus('ready', '初始化完成', 100);
    void startSudoclawGatewayInBackground();
    return;
  }

  // At least one component is missing — show "组件安装中" and install only what's needed

  // Node.js (progress: 10-30%)
  if (!nodeInstalled) {
    try {
      mainLog('Runtime', 'Installing Node.js runtime...');
      initStatusManager.setStatus('installing', '组件安装中', 10);
      await ensureNodeInstalled();
      mainLog('Runtime', 'Node.js runtime installed successfully');
    } catch (err) {
      mainError('Runtime', 'Node.js runtime install failed', err);
      initStatusManager.setStatus('error', '安装失败', 0, err instanceof Error ? err.message : String(err));
      return;
    }
  }

  // Sudoclaw (progress: 30-60%)
  if (!sudoclawInstalled) {
    try {
      mainLog('Runtime', 'Installing Sudoclaw...');
      initStatusManager.setStatus('installing', '组件安装中', 30);
      const sudoclawResult = await ensureSudoclawInstalled();
      if (!sudoclawResult.installed) {
        mainError('Runtime', 'Sudoclaw install failed - missing required files after extraction');
        initStatusManager.setStatus('error', '安装失败', 0, 'Sudoclaw install incomplete, please reinstall the app');
        return;
      }
      mainLog('Runtime', 'Sudoclaw installed successfully');
    } catch (err) {
      mainError('Runtime', 'Sudoclaw install failed', err);
      initStatusManager.setStatus('error', '安装失败', 0, err instanceof Error ? err.message : String(err));
      return;
    }
  }

  // Nexus (progress: 60-90%)
  if (!nexusInstalled) {
    try {
      mainLog('Runtime', 'Installing Nexus...');
      initStatusManager.setStatus('installing', '组件安装中', 60);
      await dynamicNexusService.install();
      mainLog('Runtime', 'Nexus installed successfully, starting...');
      await dynamicNexusService.start();
      mainLog('Runtime', 'Nexus started successfully');
    } catch (err) {
      mainError('Runtime', 'Nexus install/start failed', err);
      // Nexus install failure is not critical, continue
    }
  }

  // All done
  initStatusManager.setStatus('ready', '初始化完成', 100);
  mainLog('Runtime', 'Runtime installation complete');
  void startSudoclawGatewayInBackground();
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

/** Start Sudoclaw gateway in background (non-blocking, won't delay UI ready) */
async function startSudoclawGatewayInBackground(): Promise<void> {
  try {
    mainLog('Runtime', 'Starting Sudoclaw gateway in background...');
    const { OpenClawGatewayManager } = await import('@/agent/openclaw');
    const { SUDOCLAW_DIR, SUDOCLAW_DEFAULT_PORT } = await import('./services/sudoclaw/SudoclawInstallService');
    const gatewayManager = new OpenClawGatewayManager({
      port: SUDOCLAW_DEFAULT_PORT,
      stateDir: SUDOCLAW_DIR,
      customEnv: { OPENCLAW_STATE_DIR: SUDOCLAW_DIR },
      forceSubprocessGateway: true, // Use subprocess mode for stability
    });
    await gatewayManager.start();
    mainLog('Runtime', 'Sudoclaw gateway started successfully');
  } catch (err) {
    mainError('Runtime', 'Sudoclaw gateway start failed', err);
    // Gateway start failure is not critical - user can restart manually from settings
  }
}
