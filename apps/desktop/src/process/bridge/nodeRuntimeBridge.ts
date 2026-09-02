import { ipcBridge } from '../../common';
import { installNode, uninstallNode, checkNodeStatus } from '../services/claudeCli/NodeRuntimeService';

export function initNodeRuntimeBridge(): void {
  ipcBridge.nodeRuntime.checkInstalled.provider(async () => {
    try {
      return { success: true, data: await checkNodeStatus() };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.nodeRuntime.install.provider(async () => {
    try {
      const ok = await installNode();
      if (ok) {
        ipcBridge.nodeRuntime.installResult.emit({ success: true });
        return { success: true };
      }
      const msg = 'Node.js installation failed';
      ipcBridge.nodeRuntime.installResult.emit({ success: false, msg });
      return { success: false, msg };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ipcBridge.nodeRuntime.installResult.emit({ success: false, msg });
      return { success: false, msg };
    }
  });

  ipcBridge.nodeRuntime.uninstall.provider(async () => {
    try {
      uninstallNode();
      return { success: true };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });
}
