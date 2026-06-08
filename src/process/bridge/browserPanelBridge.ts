/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { session } from 'electron';
import { ipcBridge } from '@/common';
import { BROWSER_PANEL_PARTITION } from '@/common/browserPanelUrl';
import { browserPanelCdpService } from '@process/services/browserPanel/BrowserPanelCdpService';
import { browserPanelHttpServer } from '@process/services/browserPanel/BrowserPanelHttpServer';
import type { ConsoleLevel, NetworkResourceType } from '@process/services/browserPanel/BrowserPanelCdpService';
import { mainError, mainLog } from '@process/utils/mainLogger';

/**
 * IPC bridge for the right-panel BrowserPanel.
 *
 * The BrowserPanelCdpService is installed here so its
 * `app.on('web-contents-created')` listener is registered before any
 * right-panel webview can mount in the renderer. The HTTP loopback server
 * for the MCP subprocess is started in the background — if it fails (e.g.
 * port exhaustion) the rest of sudowork is unaffected and the AI simply
 * cannot reach the browser tools until the next restart.
 */
export function initBrowserPanelBridge(): void {
  browserPanelCdpService.install();
  void browserPanelHttpServer
    .start()
    .then(({ port }) => mainLog('BrowserPanelHttp', `MCP bridge ready on 127.0.0.1:${port}`))
    .catch((err) => mainError('BrowserPanelHttp', `failed to start: ${String(err)}`));

  // ── Cache clearing (Tier A) ──────────────────────────────────────────────
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

  // ── Tab registry ────────────────────────────────────────────────────────
  ipcBridge.browserPanel.registerTab.provider(async ({ tabId, webContentsId }) => {
    browserPanelCdpService.registerTab(tabId, webContentsId);
    return { success: true };
  });

  ipcBridge.browserPanel.unregisterTab.provider(async ({ tabId }) => {
    browserPanelCdpService.unregisterTab(tabId);
    return { success: true };
  });

  ipcBridge.browserPanel.setActiveTab.provider(async ({ tabId }) => {
    browserPanelCdpService.setActiveTab(tabId);
    return { success: true };
  });

  ipcBridge.browserPanel.listTabs.provider(async () => {
    return { success: true, data: browserPanelCdpService.listTabs() };
  });

  // ── CDP action API ──────────────────────────────────────────────────────
  ipcBridge.browserPanel.evaluateScript.provider(async ({ tabId, expression, timeoutMs }) => {
    const id = browserPanelCdpService.resolveWebContentsId(tabId);
    if (id === null) return { success: false, msg: 'No active browser tab' };
    try {
      const result = await browserPanelCdpService.evaluateScript(id, { expression, timeoutMs });
      return { success: true, data: result };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.browserPanel.takeScreenshot.provider(async ({ tabId, format, quality, fullPage }) => {
    const id = browserPanelCdpService.resolveWebContentsId(tabId);
    if (id === null) return { success: false, msg: 'No active browser tab' };
    try {
      const result = await browserPanelCdpService.takeScreenshot(id, { format, quality, fullPage });
      return { success: true, data: result };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.browserPanel.navigate.provider(async ({ tabId, url, waitUntil }) => {
    const id = browserPanelCdpService.resolveWebContentsId(tabId);
    if (id === null) return { success: false, msg: 'No active browser tab' };
    try {
      const result = await browserPanelCdpService.navigate(id, { url, waitUntil });
      return { success: true, data: result };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.browserPanel.getDomSnapshot.provider(async ({ tabId, selector, format }) => {
    const id = browserPanelCdpService.resolveWebContentsId(tabId);
    if (id === null) return { success: false, msg: 'No active browser tab' };
    try {
      const result = await browserPanelCdpService.getDomSnapshot(id, { selector, format });
      return { success: true, data: result };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.browserPanel.listNetworkRequests.provider(async ({ tabId, filter, limit }) => {
    const id = browserPanelCdpService.resolveWebContentsId(tabId);
    if (id === null) return { success: false, msg: 'No active browser tab' };
    const data = browserPanelCdpService.listNetworkRequests(id, {
      filter: filter ? { ...filter, type: filter.type as NetworkResourceType | undefined } : undefined,
      limit,
    });
    return { success: true, data };
  });

  ipcBridge.browserPanel.listConsoleMessages.provider(async ({ tabId, levels, limit }) => {
    const id = browserPanelCdpService.resolveWebContentsId(tabId);
    if (id === null) return { success: false, msg: 'No active browser tab' };
    const data = browserPanelCdpService.listConsoleMessages(id, { levels: levels as ConsoleLevel[] | undefined, limit });
    return { success: true, data };
  });

  ipcBridge.browserPanel.clearBuffers.provider(async ({ tabId }) => {
    const id = browserPanelCdpService.resolveWebContentsId(tabId);
    if (id === null) return { success: false, msg: 'No active browser tab' };
    browserPanelCdpService.clearBuffers(id);
    return { success: true };
  });
}
