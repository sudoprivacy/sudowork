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

export const initializeProcess = async () => {
  // Keep ~/.sudowork/electron-path fresh so CLI wrappers always find the binary
  syncElectronPath();

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

  // Start Nexus Python server in both development and production
  // The startNexusService function is in a separate file that won't be analyzed during build
  try {
    const { startNexusService } = await import('./startNexusService');
    await startNexusService();
  } catch (error) {
    console.error('[Process] Failed to start Nexus server:', error);
    // Don't fail app startup if Nexus server fails to start
  }
};
