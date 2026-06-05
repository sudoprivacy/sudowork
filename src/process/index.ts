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
import initStorage, { ProcessConfig } from './initStorage';
// initBridge is dynamically imported in initializeProcess() to ensure correct initialization order
import './i18n'; // Initialize i18n for main process
import { syncElectronPath } from './services/claudeCli/CliInstallService';
import { getChannelManager } from '@/channels';
import { ExtensionRegistry } from '@/extensions';
import { initStatusManager } from './services/initStatus';
import { mainLog, mainError, perfLog } from './utils/mainLogger';
import { initializeSudoworkLogUploader } from './utils/sudoworkLogUploader';
import { refreshEnterpriseCache } from '@/common/enterpriseDebugConfig';
// Crash bridge must be initialized early to handle renderer errors before other bridges
import { initCrashBridge } from './bridge/crashBridge';

export const initializeProcess = async () => {
  const totalStart = Date.now();
  mainLog('Process', 'Initializing process...');

  // Keep ~/.sudowork/electron-path fresh so CLI wrappers always find the binary
  syncElectronPath();

  // 0. Initialize crash bridge FIRST to handle any renderer errors during startup
  // This must happen before the renderer process can trigger error events
  try {
    initCrashBridge();
    mainLog('Process', 'Crash bridge initialized (early)');
  } catch (error) {
    mainError('Process', 'Crash bridge initialization failed', error);
  }

  // 1. Initialize storage first (required for most bridges)
  const storageStart = Date.now();
  await initStorage();
  perfLog('initStorage', Date.now() - storageStart);

  try {
    initializeSudoworkLogUploader();
  } catch (error) {
    console.warn('[Process] Failed to initialize Sudowork Log uploader:', error);
  }

  // 2. Initialize bridge as soon as storage is ready
  // This ensures the renderer can communicate with the backend even while runtimes are installing
  const bridgeStart = Date.now();
  try {
    await import('./initBridge');
    // Refresh enterprise config cache before mode branching
    // This ensures isEnterpriseMode() returns correct value in ChannelManager
    await refreshEnterpriseCache();
    mainLog('Process', 'Bridge initialized successfully');
  } catch (error) {
    mainError('Process', 'Bridge initialization failed', error);
  }
  perfLog('initBridge', Date.now() - bridgeStart);

  // ExtensionRegistry is zero-coupled to serviceManager/ChannelManager (verified in source),
  // so it must be initialized in ALL modes to support themes, i18n, settings tabs, etc.
  const extStart = Date.now();
  try {
    await ExtensionRegistry.getInstance().initialize();
  } catch (error) {
    mainError('Process', 'Failed to initialize ExtensionRegistry', error);
  }
  perfLog('ExtensionRegistry', Date.now() - extStart);

  // 3. Three-way mode branching: 'e' (enterprise), 'c' (consumer), null (new user)
  // Use ProcessConfig.getSync() instead of ConfigStorage.get() because the latter
  // uses BroadcastChannel IPC which doesn't work in the main process (no renderer yet).
  const appMode = ProcessConfig.getSync('system.appMode') ?? null;

  if (appMode) {
    // Both Enterprise and Consumer modes: start local services + ChannelManager
    // Enterprise mode now requires local services for Local session mode support
    const serviceStart = Date.now();
    const { serviceManager } = await import('./services/serviceManager');
    void serviceManager.startup();
    perfLog('serviceManager.startup', Date.now() - serviceStart);

    const channelStart = Date.now();
    try {
      await getChannelManager().initialize();
    } catch (error) {
      mainError('Process', 'Failed to initialize ChannelManager', error);
    }
    perfLog('ChannelManager', Date.now() - channelStart);
  } else {
    // New user (no appMode set): skip services, show ModeSetup
    // User selects C → startConsumerServices IPC + renderer reload (no app restart needed)
    initStatusManager.setStatus('ready', '初始化完成', 100);
  }

  perfLog('total_startup', Date.now() - totalStart);
  mainLog('Process', `Initialization complete in ${Date.now() - totalStart}ms`);
};
