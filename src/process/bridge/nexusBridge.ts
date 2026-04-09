import { ipcBridge } from '../../common';
import { dynamicNexusService, type NexusSetupStatus } from '../services/nexus/DynamicNexusService';
import { serviceManager } from '../services/serviceManager';
import { mainLog, mainError } from '@process/utils/mainLogger';
import runtimeVersions from '@/shared/runtime-versions.json';

export function initNexusBridge(): void {
  ipcBridge.nexus.getStatus.provider(async () => {
    // Treat Nexus as running only when /health returns a healthy response.
    const [running, installedByFiles] = await Promise.all([dynamicNexusService.checkActualRunning(), dynamicNexusService.checkInstalled()]);
    const installed = running || installedByFiles;
    const version = installedByFiles ? await dynamicNexusService.getInstalledVersion() : undefined;
    return {
      success: true,
      data: {
        running,
        port: dynamicNexusService.port,
        setupStage: dynamicNexusService.setupStage,
        installed,
        version,
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
        let unsubscribe: (() => void) | null = null;
        try {
          mainLog('NexusBridge', 'Starting Nexus installation...');

          const progressHandler = (status: NexusSetupStatus) => {
            ipcBridge.nexus.installProgress.emit({
              phase: status.stage as any,
              message: status.message,
              percent: status.percent,
            });
          };

          unsubscribe = dynamicNexusService.onSetupStatus(progressHandler);

          await dynamicNexusService.install();
          mainLog('NexusBridge', 'Nexus installation completed, starting service...');

          await serviceManager.startNexus();
          mainLog('NexusBridge', 'Nexus service started successfully');

          resolve({ success: true, msg: 'Nexus 安装并启动成功' });

          setTimeout(() => {
            ipcBridge.nexus.installResult.emit({ success: true, msg: 'Nexus 安装并启动成功' });
          }, 100);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          mainError('NexusBridge', 'Error during Nexus installation/startup:', err);
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
      await serviceManager.stopNexus();
    } catch {
      // Ignore stop errors.
    }

    try {
      const fs = await import('fs');
      const path = await import('path');
      const { getDataPath } = await import('../utils');
      const dataPath = getDataPath();
      const binDir = path.join(dataPath, 'bin');
      const envDir = path.join(dataPath, 'nexus_env');
      const pidFile = path.join(dataPath, 'nexusd.pid');

      // Clean new binary path
      if (fs.existsSync(binDir)) fs.rmSync(binDir, { recursive: true, force: true });
      // Clean legacy conda env path
      if (fs.existsSync(envDir)) fs.rmSync(envDir, { recursive: true, force: true });
      if (fs.existsSync(pidFile)) fs.rmSync(pidFile, { force: true });

      return { success: true };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.nexus.start.provider(async () => {
    try {
      await serviceManager.startNexus();
      return { success: true };
    } catch (err) {
      mainError('NexusBridge', 'Start failed:', err);
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.nexus.stop.provider(async () => {
    try {
      await serviceManager.stopNexus();
      return { success: true };
    } catch (err) {
      mainError('NexusBridge', 'Stop failed:', err);
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.nexus.installFromLocalFile.provider(async ({ filePath }) => {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const app = await import('electron').then((m) => m.app);
      const isWindows = process.platform === 'win32';

      const binDir = path.join(app.getPath('home'), '.nexus', 'bin');
      const nexusdName = isWindows ? 'nexusd.exe' : 'nexusd';
      const destPath = path.join(binDir, nexusdName);

      // Ensure bin directory exists
      await fs.promises.mkdir(binDir, { recursive: true });

      // Copy the binary file to ~/.nexus/bin/nexusd
      mainLog('NexusBridge', `Copying local nexus binary to ${destPath}...`);
      await fs.promises.copyFile(filePath, destPath);

      // Make binary executable on macOS/Linux
      if (!isWindows) {
        fs.chmodSync(destPath, 0o755);
      }

      // Write version marker (use nexus runtime version for consistency with DynamicNexusService)
      const markerFile = path.join(binDir, '.nexus-bin-ready');
      await fs.promises.writeFile(markerFile, runtimeVersions.nexus);
      mainLog('NexusBridge', 'Local file installation complete, starting service...');

      await serviceManager.startNexus();
      mainLog('NexusBridge', 'Nexus service started after local file install');

      return { success: true, msg: 'Nexus 安装并启动成功' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainError('NexusBridge', 'installFromLocalFile failed:', err);
      return { success: false, msg };
    }
  });
}
