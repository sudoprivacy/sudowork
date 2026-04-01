import { ipcBridge } from '../../common';
import { dynamicNexusService, type NexusSetupStatus } from '../services/nexus/DynamicNexusService';
import { serviceManager } from '../services/serviceManager';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';

export function initNexusBridge(): void {
  ipcBridge.nexus.getStatus.provider(async () => {
    const installed = await dynamicNexusService.checkInstalled();
    // Treat Nexus as running only when /health returns a healthy response.
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
      const os = await import('os');
      const tar = await import('tar');
      const { execFile } = await import('child_process');
      const util = await import('util');

      const execFileAsync = util.promisify(execFile);
      const app = await import('electron').then((m) => m.app);
      const isWindows = process.platform === 'win32';
      const tempDir = path.join(os.tmpdir(), `nexus-${Date.now()}`);
      const tempTarGzPath = path.join(tempDir, 'nexus.tar.gz');
      const formatCommandError = (error: unknown): string => {
        if (!(error instanceof Error)) {
          return String(error);
        }

        const execError = error as Error & { code?: number | string; stdout?: string; stderr?: string };
        const details = [execError.message, execError.code !== undefined ? `code=${String(execError.code)}` : null, execError.stdout?.trim() ? `stdout=${execError.stdout.trim()}` : null, execError.stderr?.trim() ? `stderr=${execError.stderr.trim()}` : null].filter(Boolean);

        return details.join(' | ');
      };
      const runCondaUnpack = async (): Promise<void> => {
        const pythonBin = isWindows ? path.join(envDir, 'python.exe') : path.join(envDir, 'bin', 'python');
        const binDir = isWindows ? path.join(envDir, 'Scripts') : path.join(envDir, 'bin');
        const condaUnpackScriptCandidates = isWindows ? ['conda-unpack-script.py', 'conda-unpack.py'] : ['conda-unpack'];
        const condaUnpackScript = condaUnpackScriptCandidates.map((name) => path.join(binDir, name)).find((candidate) => fs.existsSync(candidate));
        const condaUnpackExe = isWindows ? path.join(binDir, 'conda-unpack.exe') : path.join(binDir, 'conda-unpack');

        if (condaUnpackScript) {
          mainLog('NexusBridge', `Running conda-unpack via python: ${pythonBin} ${condaUnpackScript}`);
          try {
            await execFileAsync(pythonBin, [condaUnpackScript]);
            return;
          } catch (error) {
            throw new Error(`conda-unpack script failed: ${formatCommandError(error)}`);
          }
        }

        if (!fs.existsSync(condaUnpackExe)) {
          mainWarn('NexusBridge', `conda-unpack not found at ${condaUnpackExe} — skipping`);
          return;
        }

        if (!isWindows) {
          fs.chmodSync(condaUnpackExe, 0o755);
          mainLog('NexusBridge', `Running conda-unpack via python: ${pythonBin} ${condaUnpackExe}`);
          try {
            await execFileAsync(pythonBin, [condaUnpackExe]);
            return;
          } catch (error) {
            throw new Error(`conda-unpack failed: ${formatCommandError(error)}`);
          }
        }

        mainLog('NexusBridge', `Running conda-unpack executable: ${condaUnpackExe}`);
        try {
          await execFileAsync(condaUnpackExe, []);
        } catch (error) {
          throw new Error(`conda-unpack executable failed: ${formatCommandError(error)}`);
        }
      };

      await fs.promises.mkdir(tempDir, { recursive: true });
      await fs.promises.copyFile(filePath, tempTarGzPath);

      const envDir = path.join(app.getPath('home'), '.nexus', 'nexus_env');
      if (fs.existsSync(envDir)) {
        fs.rmSync(envDir, { recursive: true, force: true });
      }

      await fs.promises.mkdir(envDir, { recursive: true });
      mainLog('NexusBridge', `Extracting local nexus file to ${envDir}...`);
      await tar.x({ file: tempTarGzPath, cwd: envDir });

      await runCondaUnpack();
      mainLog('NexusBridge', 'conda-unpack completed');

      const nexusdBin = isWindows ? path.join(envDir, 'Scripts', 'nexusd.exe') : path.join(envDir, 'bin', 'nexusd');

      if (!fs.existsSync(nexusdBin)) {
        throw new Error(`nexusd not found at ${nexusdBin} after extraction`);
      }
      if (!isWindows) fs.chmodSync(nexusdBin, 0o755);

      const markerFile = path.join(envDir, '.nexus-conda-ready');
      await fs.promises.writeFile(markerFile, app.getVersion());
      mainLog('NexusBridge', 'Local file installation complete, starting service...');

      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore temp cleanup failures.
      }

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
