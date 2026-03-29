import { ipcBridge } from '../../common';
import { dynamicNexusService, type NexusSetupStatus } from '../services/nexus/DynamicNexusService';

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

  // Register the progress callback when install is initiated
  ipcBridge.nexus.install.provider(async () => {
    return new Promise((resolve) => {
      void (async () => {
        try {
          console.log('[NexusBridge] Starting Nexus installation...');

          // Register a one-time progress listener
          const progressHandler = (status: NexusSetupStatus) => {
            // Emit progress event to renderer
            ipcBridge.nexus.installProgress.emit({
              phase: status.stage as any,
              message: status.message,
              percent: status.percent,
            });
          };

          dynamicNexusService.onSetupStatus(progressHandler);

          await dynamicNexusService.install();
          console.log('[NexusBridge] Nexus installation completed, starting service...');

          // 安装完成后自动启动服务
          await dynamicNexusService.start();
          console.log('[NexusBridge] Nexus service started successfully');

          resolve({ success: true, msg: 'Nexus 安装并启动成功' });

          setTimeout(() => {
            ipcBridge.nexus.installResult.emit({ success: true, msg: 'Nexus 安装并启动成功' });
          }, 100);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error('[NexusBridge] Error during Nexus installation/startup:', err);
          resolve({ success: false, msg: errorMsg });

          setTimeout(() => {
            ipcBridge.nexus.installResult.emit({ success: false, msg: errorMsg });
          }, 100);
        }
      })();
    });
  });
}
