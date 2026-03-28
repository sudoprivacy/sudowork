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
import { mainLog, mainError, perfLog } from './utils/mainLogger';

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
};
