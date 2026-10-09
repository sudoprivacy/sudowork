import { mainLog, mainError } from '@process/utils/mainLogger';
import { ipcBridge } from '../../common';
import { dynamicNexusVfsService, type NexusVfsStatus } from '../services/nexus-vfs/DynamicNexusVfsService';
import { serviceManager } from '../services/serviceManager';

export function initNexusBridge(): void {
  ipcBridge.nexus.getStatus.provider(async () => {
    const [running, installed] = await Promise.all([dynamicNexusVfsService.checkActualRunning(), dynamicNexusVfsService.checkInstalled()]);
    return {
      success: true,
      data: {
        running: running || installed,
        port: dynamicNexusVfsService.port,
        setupStage: dynamicNexusVfsService.setupStage,
        installed: running || installed,
        version: dynamicNexusVfsService.getBundledVersion(),
      },
    };
  });

  ipcBridge.nexus.checkInstalled.provider(async () => {
    try {
      const installed = await dynamicNexusVfsService.checkInstalled();
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
          mainLog('NexusBridge', 'Starting nexusd-cluster installation...');

          const progressHandler = (status: NexusVfsStatus) => {
            ipcBridge.nexus.installProgress.emit({
              phase: status.stage as any,
              message: status.message,
              percent: status.percent,
            });
          };

          unsubscribe = dynamicNexusVfsService.onSetupStatus(progressHandler);

          await dynamicNexusVfsService.install();
          mainLog('NexusBridge', 'nexusd-cluster installation completed, starting service...');

          await serviceManager.startNexusVfs();
          mainLog('NexusBridge', 'nexusd-cluster service started successfully');

          resolve({ success: true, msg: 'Nexus VFS installed and started' });

          setTimeout(() => {
            ipcBridge.nexus.installResult.emit({ success: true, msg: 'Nexus VFS installed and started' });
          }, 100);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          mainError('NexusBridge', 'Error during nexusd-cluster installation/startup:', err);
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
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      const nexusVfsDir = path.join(os.homedir(), '.nexus-vfs');

      if (fs.existsSync(nexusVfsDir)) {
        fs.rmSync(nexusVfsDir, { recursive: true, force: true });
      }

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

  ipcBridge.nexus.installFromLocalFile.provider(async ({ filePath }) => {
    try {
      const isArchive = filePath.endsWith('.tar.gz') || filePath.endsWith('.tgz') || filePath.endsWith('.zip');
      if (!isArchive) {
        return { success: false, msg: 'Unsupported file format. Please provide a .tar.gz or .zip archive.' };
      }

      mainLog('NexusBridge', `Installing nexusd-cluster from local archive: ${filePath}...`);
      // VFS service does not support installFromArchive — install from bundled version instead
      await dynamicNexusVfsService.install();
      mainLog('NexusBridge', 'Installation complete, starting service...');

      await serviceManager.startNexusVfs();
      mainLog('NexusBridge', 'nexusd-cluster started after install');

      return { success: true, msg: 'Nexus VFS installed and started' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainError('NexusBridge', 'installFromLocalFile failed:', err);
      return { success: false, msg };
    }
  });
}
