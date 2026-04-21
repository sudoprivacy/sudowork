/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import { ipcBridge } from '@/common';
import { initStatusManager } from '../services/initStatus';

export function initInitBridge(): void {
  ipcBridge.init.getStatus.provider(async () => {
    return { success: true, data: initStatusManager.getStatus() };
  });

  ipcBridge.init.retryStartup.provider(async () => {
    try {
      const { serviceManager } = await import('../services/serviceManager');
      initStatusManager.clearRetry();
      initStatusManager.addLog('↻ 手动触发重新启动检查...');
      await serviceManager.startup();
      const finalStatus = initStatusManager.getStatus();
      if (finalStatus.phase === 'ready') {
        return { success: true };
      }
      return {
        success: false,
        msg: finalStatus.error ?? '重新启动后仍未就绪',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      initStatusManager.setStatus('error', '初始化失败', 0, message);
      initStatusManager.addLog(`✗ 手动重试失败：${message}`);
      return { success: false, msg: message };
    }
  });

  ipcBridge.init.reinstallComponent.provider(async ({ component }) => {
    try {
      const { serviceManager } = await import('../services/serviceManager');
      const fs = await import('fs');
      const path = await import('path');

      initStatusManager.clearRetry();

      if (component === 'nexus') {
        const { getDataPath } = await import('../utils');
        const dataPath = getDataPath();
        const binDir = path.join(dataPath, 'bin');
        const envDir = path.join(dataPath, 'nexus_env');
        const pidFile = path.join(dataPath, 'nexusd.pid');
        const readyFile = path.join(dataPath, 'nexusd.ready');

        initStatusManager.addLog('↻ 手动触发 Nexus 重装...');
        await serviceManager.stopNexus().catch(() => {});
        // Clean new binary path
        if (fs.existsSync(binDir)) fs.rmSync(binDir, { recursive: true, force: true });
        // Clean legacy conda env path
        if (fs.existsSync(envDir)) fs.rmSync(envDir, { recursive: true, force: true });
        if (fs.existsSync(pidFile)) fs.rmSync(pidFile, { force: true });
        if (fs.existsSync(readyFile)) fs.rmSync(readyFile, { force: true });
      } else {
        const { SUDOCLAW_DIR, removeSudoclawCli } = await import('../services/sudoclaw/SudoclawInstallService');
        const sudoclawManifestPath = path.join(SUDOCLAW_DIR, 'install-manifest.json');
        const sudoclawCliStagingDir = path.join(SUDOCLAW_DIR, 'cli.new');
        const sudoclawCliBackupDir = path.join(SUDOCLAW_DIR, 'cli.old');

        initStatusManager.addLog('↻ 手动触发 Sudoclaw 重装...');
        await serviceManager.stopOpenClaw().catch(() => {});
        if (fs.existsSync(SUDOCLAW_DIR)) {
          removeSudoclawCli();
          if (fs.existsSync(sudoclawCliStagingDir)) fs.rmSync(sudoclawCliStagingDir, { recursive: true, force: true });
          if (fs.existsSync(sudoclawCliBackupDir)) fs.rmSync(sudoclawCliBackupDir, { recursive: true, force: true });
          if (fs.existsSync(sudoclawManifestPath)) fs.rmSync(sudoclawManifestPath, { force: true });
        }
      }

      await serviceManager.startup();
      const finalStatus = initStatusManager.getStatus();
      if (finalStatus.phase === 'ready') {
        return { success: true };
      }

      return {
        success: false,
        msg: finalStatus.error ?? `${component} 重装后仍未就绪`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      initStatusManager.setStatus('error', '初始化失败', 0, message);
      initStatusManager.addLog(`✗ 手动重装失败：${message}`);
      return { success: false, msg: message };
    }
  });

  // Subscribe to status changes and broadcast to renderer
  initStatusManager.subscribe((status) => {
    ipcBridge.init.onStatusChange.emit(status);
  });

  // Quit the entire application
  ipcBridge.init.quitApp.provider(() => {
    app.exit(0);
    return Promise.resolve();
  });
}
