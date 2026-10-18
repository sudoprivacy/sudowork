import { mainLog, mainError } from '@process/utils/mainLogger';
import { ipcBridge } from '../../common';
import { scodeRuntimeService, type NexusVfsStatus } from '../services/scode/ScodeRuntimeService';
import { serviceManager } from '../services/serviceManager';

export function initNexusBridge(): void {
  ipcBridge.nexus.getStatus.provider(async () => {
    const [running, installed] = await Promise.all([scodeRuntimeService.checkActualRunning(), scodeRuntimeService.checkInstalled()]);
    return {
      success: true,
      data: {
        running,
        setupStage: scodeRuntimeService.setupStage,
        installed,
        version: scodeRuntimeService.getBundledVersion(),
      },
    };
  });

  ipcBridge.nexus.checkInstalled.provider(async () => {
    try {
      const installed = await scodeRuntimeService.checkInstalled();
      return { success: true, data: { installed } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, msg };
    }
  });

  ipcBridge.nexus.install.provider(async () => {
    return new Promise((resolve) => {
      void (async () => {
        let unsubscribe: (() => void) | null = null;
        try {
          mainLog('NexusBridge', 'Starting Sudocode services installation...');

          const progressHandler = (status: NexusVfsStatus) => {
            ipcBridge.nexus.installProgress.emit({
              phase: status.stage as any,
              message: status.message,
              percent: status.percent,
            });
          };

          unsubscribe = scodeRuntimeService.onSetupStatus(progressHandler);

          await scodeRuntimeService.install();
          mainLog('NexusBridge', 'Sudocode services installation completed, starting service...');

          await serviceManager.startNexusVfs();
          mainLog('NexusBridge', 'Sudocode services service started successfully');

          resolve({ success: true, msg: 'Nexus VFS installed and started' });

          setTimeout(() => {
            ipcBridge.nexus.installResult.emit({ success: true, msg: 'Nexus VFS installed and started' });
          }, 100);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          mainError('NexusBridge', 'Error during Sudocode services installation/startup:', err);
          resolve({ success: false, msg: errorMsg });

          setTimeout(() => {
            ipcBridge.nexus.installResult.emit({ success: false, msg: errorMsg });
          }, 100);
        } finally {
          unsubscribe?.();
        }
      })();
    });
  });

  ipcBridge.nexus.uninstall.provider(async () => {
    try {
      await serviceManager.stopNexusVfs();
    } catch {
      // Ignore stop errors.
    }

    try {
      const { getScodeServiceClient } = await import('@/common/scode/serviceClient');
      await getScodeServiceClient().request('service.removeInstallation');

      return { success: true };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.nexus.start.provider(async () => {
    try {
      await serviceManager.startNexusVfs();
      return { success: true };
    } catch (err) {
      mainError('NexusBridge', 'Start failed:', err);
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.nexus.stop.provider(async () => {
    try {
      await serviceManager.stopNexusVfs();
      return { success: true };
    } catch (err) {
      mainError('NexusBridge', 'Stop failed:', err);
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });
}
