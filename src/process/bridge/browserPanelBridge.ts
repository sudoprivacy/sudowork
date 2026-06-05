/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { session } from 'electron';
import { ipcBridge } from '@/common';
import { BROWSER_PANEL_PARTITION } from '@/common/browserPanelUrl';
import { mainError, mainLog } from '@process/utils/mainLogger';

/**
 * IPC bridge for the right-panel BrowserPanel.
 *
 * Today only `clearCache` lives here — later commits in this PR will add the
 * CDP-driven providers (registerTab, evaluateScript, takeScreenshot, ...).
 */
export function initBrowserPanelBridge(): void {
  ipcBridge.browserPanel.clearCache.provider(async () => {
    try {
      const partitionSession = session.fromPartition(BROWSER_PANEL_PARTITION);
      await partitionSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage', 'serviceworkers', 'shadercache', 'websql'],
      });
      await partitionSession.clearCache();
      await partitionSession.clearAuthCache();
      mainLog('BrowserPanel', 'Cleared right-panel browser cache and storage');
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      mainError('BrowserPanel', `Failed to clear browser cache: ${msg}`);
      return { success: false, msg };
    }
  });
}
