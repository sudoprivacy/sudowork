/**
 * Auth Proxy IPC Bridge - connects renderer to Auth Proxy services in main process.
 */

import { ipcBridge } from '@/common';
import { getAuthProxyRules, refreshAuthProxyRules, getAuthProxyPort } from '@process/services/authProxy';
import { mainError } from '@process/utils/mainLogger';

export function initAuthProxyBridge(): void {
  ipcBridge.authProxy.getRules.provider(async () => {
    try {
      const rules = getAuthProxyRules();
      return { success: true, data: rules };
    } catch (err) {
      mainError('AuthProxyBridge', 'Failed to get rules:', err);
      return { success: false, data: [] };
    }
  });

  ipcBridge.authProxy.refreshRules.provider(async ({ accessToken, enabledConfigItemIds }) => {
    try {
      await refreshAuthProxyRules(accessToken, enabledConfigItemIds);
      return { success: true };
    } catch (err) {
      mainError('AuthProxyBridge', 'Failed to refresh rules:', err);
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.authProxy.getStatus.provider(async () => {
    try {
      const port = getAuthProxyPort();
      return { success: true, data: { running: port !== null, port } };
    } catch (err) {
      mainError('AuthProxyBridge', 'Failed to get status:', err);
      return { success: false, data: { running: false, port: null } };
    }
  });
}
