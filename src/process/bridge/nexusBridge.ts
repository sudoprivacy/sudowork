import { ipcBridge } from '../../common';
import { dynamicNexusService, type NexusSetupStatus } from '../services/nexus/DynamicNexusService';
import { serviceManager } from '../services/serviceManager';

export function initNexusBridge(): void {
  ipcBridge.nexus.getStatus.provider(async () => {
    const installed = await dynamicNexusService.checkInstalled();
    // Use actual process check (by PID/child process object) so the "About" page
    // always reflects reality, even when the internal _running flag is stale
    // (e.g. child process exited but nexusd is still serving, or vice-versa).
    const running = await dynamicNexusService.checkActualRunning();
    const version = installed ? await dynamicNexusService.getInstalledVersion() : undefined;
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
          console.log('[NexusBridge] Starting Nexus installation...');

          const progressHandler = (status: NexusSetupStatus) => {
            ipcBridge.nexus.installProgress.emit({
              phase: status.stage as any,
              message: status.message,
              percent: status.percent,
            });
          };

          unsubscribe = dynamicNexusService.onSetupStatus(progressHandler);

          await dynamicNexusService.install();
          console.log('[NexusBridge] Nexus installation completed, starting service...');

          await serviceManager.startNexus();
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
      const envDir = path.join(dataPath, 'nexus_env');
      const pidFile = path.join(dataPath, 'nexusd.pid');

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
      console.error('[NexusBridge] Start failed:', err);
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.nexus.stop.provider(async () => {
    try {
      await serviceManager.stopNexus();
      return { success: true };
    } catch (err) {
      console.error('[NexusBridge] Stop failed:', err);
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.nexus.installFromLocalFile.provider(async ({ filePath }) => {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      const tar = await import('tar');
      const { exec } = await import('child_process');
      const util = await import('util');

      const execAsync = util.promisify(exec);
      const app = await import('electron').then((m) => m.app);
      const isWindows = process.platform === 'win32';
      const tempDir = path.join(os.tmpdir(), `nexus-${Date.now()}`);
      const tempTarGzPath = path.join(tempDir, 'nexus.tar.gz');

      await fs.promises.mkdir(tempDir, { recursive: true });
      await fs.promises.copyFile(filePath, tempTarGzPath);

      const envDir = path.join(app.getPath('home'), '.nexus', 'nexus_env');
      if (fs.existsSync(envDir)) {
        fs.rmSync(envDir, { recursive: true, force: true });
      }

      await fs.promises.mkdir(envDir, { recursive: true });
      console.log(`[NexusBridge] Extracting local nexus file to ${envDir}...`);
      await tar.x({ file: tempTarGzPath, cwd: envDir });

      const condaUnpack = isWindows ? path.join(envDir, 'Scripts', 'conda-unpack.exe') : path.join(envDir, 'bin', 'conda-unpack');
      if (fs.existsSync(condaUnpack)) {
        if (!isWindows) fs.chmodSync(condaUnpack, 0o755);
        console.log(`[NexusBridge] Running conda-unpack: ${condaUnpack}`);
        if (isWindows) {
          await execAsync(`"${condaUnpack}"`);
        } else {
          const pythonBin = path.join(envDir, 'bin', 'python');
          await execAsync(`"${pythonBin}" "${condaUnpack}"`);
        }
        console.log('[NexusBridge] conda-unpack completed');
      } else {
        console.warn(`[NexusBridge] conda-unpack not found at ${condaUnpack} — skipping`);
      }

      const nexusdBin = isWindows ? (fs.existsSync(path.join(envDir, 'bin', 'nexusd.exe')) ? path.join(envDir, 'bin', 'nexusd.exe') : path.join(envDir, 'bin', 'nexusd')) : path.join(envDir, 'bin', 'nexusd');

      if (!fs.existsSync(nexusdBin)) {
        throw new Error(`nexusd not found at ${nexusdBin} after extraction`);
      }
      if (!isWindows) fs.chmodSync(nexusdBin, 0o755);

      const markerFile = path.join(envDir, '.nexus-conda-ready');
      await fs.promises.writeFile(markerFile, app.getVersion());
      console.log('[NexusBridge] Local file installation complete, starting service...');

      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore temp cleanup failures.
      }

      await serviceManager.startNexus();
      console.log('[NexusBridge] Nexus service started after local file install');

      return { success: true, msg: 'Nexus 安装并启动成功' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[NexusBridge] installFromLocalFile failed:', err);
      return { success: false, msg };
    }
  });
}
