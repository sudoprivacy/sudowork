import { ipcBridge } from '../../common';
import { dynamicNexusService, type NexusSetupStatus } from '../services/nexus/DynamicNexusService';

export function initNexusBridge(): void {
  ipcBridge.nexus.ping.provider(async () => {
    if (!dynamicNexusService.isRunning) {
      return { success: false, msg: 'Nexus server is not running' };
    }
    try {
      const res = await fetch(`http://127.0.0.1:${dynamicNexusService.port}/ping`);
      const data = (await res.json()) as { message: string; timestamp: number; port: number };
      return { success: true, data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, msg };
    }
  });

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

      // 创建临时目录
      const tempDir = path.join(os.tmpdir(), `nexus-${Date.now()}`);
      const tempTarGzPath = path.join(tempDir, 'nexus.tar.gz');

      // 复制本地文件到临时位置
      await fs.promises.mkdir(tempDir, { recursive: true });
      await fs.promises.copyFile(filePath, tempTarGzPath);

      // 环境目录：与 DynamicNexusService.getCondaEnvDir() 保持一致
      // (~/.nexus/nexus_env on macOS/Linux, %USERPROFILE%\.nexus\nexus_env on Windows)
      const envDir = path.join(app.getPath('home'), '.nexus', 'nexus_env');

      // 删除旧环境
      if (fs.existsSync(envDir)) {
        fs.rmSync(envDir, { recursive: true, force: true });
      }

      // 解压
      await fs.promises.mkdir(envDir, { recursive: true });
      console.log(`[NexusBridge] Extracting local nexus file to ${envDir}...`);
      await tar.x({ file: tempTarGzPath, cwd: envDir });

      // 运行 conda-unpack 修复硬编码路径
      // Windows 下路径为 Scripts\conda-unpack.exe，macOS/Linux 为 bin/conda-unpack
      const condaUnpack = isWindows ? path.join(envDir, 'Scripts', 'conda-unpack.exe') : path.join(envDir, 'bin', 'conda-unpack');

      if (fs.existsSync(condaUnpack)) {
        if (!isWindows) fs.chmodSync(condaUnpack, 0o755);
        console.log(`[NexusBridge] Running conda-unpack: ${condaUnpack}`);
        await execAsync(`"${condaUnpack}"`);
        console.log('[NexusBridge] conda-unpack completed');
      } else {
        console.warn(`[NexusBridge] conda-unpack not found at ${condaUnpack} — skipping`);
      }

      // Repair code signatures on macOS (strip conda-forge Team IDs, ad-hoc re-sign).
      // force=true because this is always a fresh local-file install.
      await dynamicNexusService.repairMacOSLibrarySignatures(envDir, true);

      // 确保 nexusd 可执行
      // Windows: bin\nexusd.exe or bin\nexusd; macOS/Linux: bin/nexusd
      const nexusdBin = isWindows ? (fs.existsSync(path.join(envDir, 'bin', 'nexusd.exe')) ? path.join(envDir, 'bin', 'nexusd.exe') : path.join(envDir, 'bin', 'nexusd')) : path.join(envDir, 'bin', 'nexusd');

      if (!fs.existsSync(nexusdBin)) {
        throw new Error(`nexusd not found at ${nexusdBin} after extraction`);
      }
      if (!isWindows) fs.chmodSync(nexusdBin, 0o755);

      // 写入版本标记
      const CONDA_READY_MARKER = '.nexus-conda-ready';
      const markerFile = path.join(envDir, CONDA_READY_MARKER);
      await fs.promises.writeFile(markerFile, app.getVersion());
      console.log('[NexusBridge] Local file installation complete, starting service...');

      // 清理临时文件
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }

      // 安装完成后自动启动服务
      await dynamicNexusService.start();
      console.log('[NexusBridge] Nexus service started after local file install');

      return { success: true, msg: 'Nexus 安装并启动成功' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[NexusBridge] installFromLocalFile failed:', err);
      return { success: false, msg };
    }
  });
}
