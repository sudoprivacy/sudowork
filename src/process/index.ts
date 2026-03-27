/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
import { ensureNodeInstalled, isNodeInstalled } from './services/claudeCli/NodeRuntimeService';
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

  // ── Fast synchronous pre-check (no awaits, only fs.existsSync) ──────────────
  // Check critical executables directly before any dynamic import.
  // Running before the first `await` means this executes synchronously in the
  // same event-loop tick as `void installRuntimes()`, so initStatusManager is
  // set to 'ready' before the renderer can poll getStatus via IPC.
  // This prevents the brief "组件安装中" flash on subsequent launches.
  const resDir = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources');

  // Node: use the already-loaded isNodeInstalled() (static import, fs.existsSync only)
  const fastNodeOk = isNodeInstalled();

  // Sudoclaw: check the openclaw binary under ~/.nexus/sudoclaw/cli/package/bin/
  const sudoclawBinName = process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
  const sudoclawBinPath = path.join(os.homedir(), '.nexus', 'sudoclaw', 'cli', 'package', 'bin', sudoclawBinName);
  const fastSudoclawOk = fs.existsSync(sudoclawBinPath);

  // Nexus: check nexusd binary; treat as OK when no resource bundle is present (optional)
  const nexusEnvBinPath =
    process.platform === 'win32'
      ? path.join(os.homedir(), '.nexus', 'nexus_env', 'Scripts', 'nexusd.exe')
      : path.join(os.homedir(), '.nexus', 'nexus_env', 'bin', 'nexusd');
  const nexusResPath = path.join(resDir, 'nexus.tar.gz');
  const hasNexusResource = (() => {
    try {
      return fs.existsSync(nexusResPath) && fs.statSync(nexusResPath).size >= 1024 * 1024;
    } catch {
      return false;
    }
  })();
  const fastNexusOk = !hasNexusResource || fs.existsSync(nexusEnvBinPath);

  mainLog('Runtime', `Fast check: Node=${fastNodeOk}, Sudoclaw=${fastSudoclawOk}, Nexus=${fastNexusOk} (hasNexusResource=${hasNexusResource})`);

  if (fastNodeOk && fastSudoclawOk && fastNexusOk) {
    // All installed — mark ready immediately (synchronous, no dialog shown)
    mainLog('Runtime', 'All runtimes already installed, skipping installation');
    initStatusManager.setStatus('ready', '初始化完成', 100);
    // Repair config and start gateway deferred (non-blocking, after ready is set)
    void import('./services/sudoclaw/SudoclawInstallService')
      .then(({ repairOpenClawConfig }) => {
        repairOpenClawConfig();
      })
      .catch(() => {
        // ignore
      })
      .finally(() => {
        void startSudoclawGatewayInBackground();
      });
    return;
  }
  // ── End fast check ───────────────────────────────────────────────────────────

  // At least one component appears to be missing — do full async check
  mainLog('Runtime', 'Checking runtime dependencies...');
  const [{ dynamicNexusService }, { ensureSudoclawInstalled }] = await Promise.all([import('./services/nexus/DynamicNexusService'), import('./services/sudoclaw/SudoclawInstallService')]);

  const nodeInstalled = await checkNodeInstalled();
  const sudoclawInstalled = await checkSudoclawInstalled();
  const nexusInstalled = await dynamicNexusService.checkInstalled();

  mainLog('Runtime', `Full check: Node=${nodeInstalled}, Sudoclaw=${sudoclawInstalled}, Nexus=${nexusInstalled}`);

  // Full check may confirm everything is fine (e.g. fast check had a false negative)
  if (nodeInstalled && sudoclawInstalled && nexusInstalled) {
    mainLog('Runtime', 'All runtimes confirmed installed');
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

  // Check which resource files are available before showing the install dialog.
  // Only show "组件安装中" and attempt install when the source archive actually exists.
  const nodeResName = `node-${process.platform}-${process.arch}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`;
  const hasNodeResource = fs.existsSync(path.join(resDir, nodeResName));
  const hasSudoclawResource = fs.existsSync(path.join(resDir, 'openclaw.tgz'));

  const willInstallNode = !nodeInstalled && hasNodeResource;
  const willInstallSudoclaw = !sudoclawInstalled && hasSudoclawResource;
  const willInstallNexus = !nexusInstalled && hasNexusResource;

  if (!willInstallNode && !willInstallSudoclaw && !willInstallNexus) {
    // Missing components but no resources to install from — skip dialog, mark ready
    mainWarn('Runtime', 'Some components missing but no installation resources found, marking ready');
    initStatusManager.setStatus('ready', '初始化完成', 100);
    void startSudoclawGatewayInBackground();
    return;
  }

  // Node.js (progress: 10-30%)
  if (willInstallNode) {
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
  if (willInstallSudoclaw) {
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
  if (willInstallNexus) {
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
    const { SUDOCLAW_DIR, SUDOCLAW_DEFAULT_PORT, SUDOCLAW_CONFIG_PATH, repairOpenClawConfig } = await import('./services/sudoclaw/SudoclawInstallService');

    // CRITICAL: Ensure skills.load.extraDirs is always set before gateway starts
    // This guarantees ~/.nexus/config/skills is always loaded regardless of:
    // - Platform (Windows/macOS/Linux)
    // - Whether config was manually modified
    // - Whether repair was skipped during install check
    repairOpenClawConfig();

    const gatewayManager = new OpenClawGatewayManager({
      port: SUDOCLAW_DEFAULT_PORT,
      stateDir: SUDOCLAW_DIR,
      customEnv: { OPENCLAW_STATE_DIR: SUDOCLAW_DIR, OPENCLAW_CONFIG_PATH: SUDOCLAW_CONFIG_PATH },
      forceSubprocessGateway: true, // Use subprocess mode for stability
    });
    await gatewayManager.start();
    mainLog('Runtime', 'Sudoclaw gateway started successfully');
  } catch (err) {
    mainError('Runtime', 'Sudoclaw gateway start failed', err);
    // Gateway start failure is not critical - user can restart manually from settings
  }
}
