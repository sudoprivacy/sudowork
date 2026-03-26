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
import * as fs from 'fs';
import * as path from 'path';
import initStorage from './initStorage';
// initBridge is dynamically imported in initializeProcess() to ensure correct initialization order
import './i18n'; // Initialize i18n for main process
import { syncElectronPath } from './services/claudeCli/CliInstallService';
import { ensureNodeInstalled } from './services/claudeCli/NodeRuntimeService';
import { getChannelManager } from '@/channels';
import { ExtensionRegistry } from '@/extensions';
import { initStatusManager } from './services/initStatus';
import { mainLog, mainWarn, mainError, perfLog } from './utils/mainLogger';
import { getDataPath } from '@process/utils';

/** Marker file that records the app version after all components are successfully installed */
const COMPONENTS_READY_MARKER = '.components_ready';

function getComponentsReadyMarkerPath(): string {
  return path.join(getDataPath(), COMPONENTS_READY_MARKER);
}

/** Returns true if the marker file exists and matches the given app version */
function isComponentsReadyForVersion(version: string): boolean {
  try {
    const markerPath = getComponentsReadyMarkerPath();
    if (!fs.existsSync(markerPath)) return false;
    const markerVersion = fs.readFileSync(markerPath, 'utf-8').trim();
    return markerVersion === version;
  } catch {
    return false;
  }
}

/** Writes the components-ready marker with the current app version */
function writeComponentsReadyMarker(version: string): void {
  try {
    const markerPath = getComponentsReadyMarkerPath();
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, version, 'utf-8');
    mainLog('Runtime', `Components ready marker written for v${version}`);
  } catch (err) {
    mainWarn('Runtime', `Failed to write components ready marker: ${err}`);
  }
}

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

  const appVersion = app.getVersion();

  // Fast-path: if marker file exists with current app version, all components are already
  // installed — skip all checks and go directly to ready without showing "组件安装中".
  if (isComponentsReadyForVersion(appVersion)) {
    mainLog('Runtime', `Components ready marker found for v${appVersion}, skipping checks`);
    initStatusManager.setStatus('ready', '初始化完成', 100);
    void startSudoclawGatewayInBackground();
    return;
  }

  // Check if all components are already installed
  mainLog('Runtime', 'Checking runtime dependencies...');
  const [{ dynamicNexusService }, { ensureSudoclawInstalled }] = await Promise.all([import('./services/nexus/DynamicNexusService'), import('./services/sudoclaw/SudoclawInstallService')]);

  const nodeInstalled = await checkNodeInstalled();
  const sudoclawInstalled = await checkSudoclawInstalled();
  const nexusInstalled = await dynamicNexusService.checkInstalled();

  mainLog('Runtime', `Runtime status: Node=${nodeInstalled}, Sudoclaw=${sudoclawInstalled}, Nexus=${nexusInstalled}`);

  if (nodeInstalled && sudoclawInstalled && nexusInstalled) {
    mainLog('Runtime', 'All runtimes already installed, skipping installation');
    // Still need to repair config in case it's outdated
    try {
      const { repairOpenClawConfig } = await import('./services/sudoclaw/SudoclawInstallService');
      repairOpenClawConfig();
    } catch {
      // ignore
    }

    // Write marker so next startup fast-paths directly to ready
    writeComponentsReadyMarker(appVersion);

    // Set ready first so user can enter main UI
    initStatusManager.setStatus('ready', '初始化完成', 100);

    // Start Sudoclaw gateway in background (non-blocking)
    void startSudoclawGatewayInBackground();
    return;
  }

  // Install bundled Node.js (progress: 10-25%)
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

  // Install Sudoclaw (built-in OpenClaw) (progress: 30-50%)
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

  // Install Nexus (progress: 60-90%)
  try {
    initStatusManager.setStatus('installing', '组件安装中', 60);

    // Only install if bundled resource exists
    const isInstalled = await dynamicNexusService.checkInstalled();
    if (!isInstalled) {
      mainLog('Runtime', 'Installing Nexus...');
      await dynamicNexusService.install();
      mainLog('Runtime', 'Nexus installed successfully, starting...');
      await dynamicNexusService.start();
      mainLog('Runtime', 'Nexus started successfully');
    }
  } catch (err) {
    mainError('Runtime', 'Nexus install/start failed', err);
    // Nexus install failure is not critical, continue
  }

  // Write marker so next startup fast-paths directly to ready (no "组件安装中")
  writeComponentsReadyMarker(appVersion);

  // Set ready first so user can enter main UI
  initStatusManager.setStatus('ready', '初始化完成', 100);
  mainLog('Runtime', 'Runtime installation complete');

  // Start Sudoclaw gateway in background (non-blocking)
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
