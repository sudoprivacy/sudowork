import { ipcBridge } from '../../common';
import { dynamicNexusService } from '../services/nexus/DynamicNexusService';

export function initNexusBridge(): void {
  ipcBridge.nexus.getStatus.provider(async () => {
    const installed = await dynamicNexusService.checkInstalled();
    // Use actual process check (by PID/child process object) so the "About" page
    // always reflects reality, even when the internal _running flag is stale
    // (e.g. child process exited but nexusd is still serving, or vice-versa).
    const running = await dynamicNexusService.checkActualRunning();
    return {
      success: true,
      data: {
        running,
        port: dynamicNexusService.port,
        setupStage: dynamicNexusService.setupStage,
        installed,
      },
    };
  });

  ipcBridge.nexus.checkInstalled.provider(async () => {
    try {
      const installed = await dynamicNexusService.checkInstalled();
      return { success: true, data: { installed } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, msg };
    }
  });

  ipcBridge.nexus.install.provider(async () => {
    try {
      console.log('[NexusBridge] Starting Nexus installation...');

      await dynamicNexusService.installAndStart((status) => {
        ipcBridge.nexus.installProgress.emit({
          phase: status.stage as any,
          message: status.message,
          percent: status.percent,
        });
      });

      console.log('[NexusBridge] Nexus service started successfully');
      const result = { success: true, msg: 'Nexus 安装并启动成功' };
      ipcBridge.nexus.installResult.emit(result);
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[NexusBridge] Error during Nexus installation/startup:', err);
      const result = { success: false, msg: errorMsg };
      ipcBridge.nexus.installResult.emit(result);
      return result;
    }
  });
}
