/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import { ipcBridge } from '../../common';
import { getSystemDir, ProcessEnv } from '../initStorage';
import { copyDirectoryRecursively } from '../utils';
import WorkerManage from '../WorkerManage';
import { getZoomFactor, setZoomFactor } from '../utils/zoom';
import { getCdpStatus, updateCdpConfig, verifyCdpReady } from '../../utils/configureChromium';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

export function initApplicationBridge(): void {
  ipcBridge.application.restart.provider(() => {
    // 清理所有工作进程
    WorkerManage.clear();
    // 重启应用 - 使用标准的 Electron 重启方式
    app.relaunch();
    app.exit(0);
    return Promise.resolve();
  });

  ipcBridge.application.updateSystemInfo.provider(async ({ cacheDir, workDir }) => {
    try {
      const oldDir = getSystemDir();
      if (oldDir.cacheDir !== cacheDir) {
        await copyDirectoryRecursively(oldDir.cacheDir, cacheDir);
      }
      await ProcessEnv.set('nexus.dir', { cacheDir, workDir });
      return { success: true };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });

  ipcBridge.application.systemInfo.provider(() => {
    return Promise.resolve(getSystemDir());
  });

  ipcBridge.application.getPath.provider(({ name }) => {
    return Promise.resolve(app.getPath(name));
  });

  ipcBridge.application.openDevTools.provider(() => {
    // This will be handled by the main window when needed
    return Promise.resolve(false);
  });

  ipcBridge.application.getZoomFactor.provider(() => Promise.resolve(getZoomFactor()));

  ipcBridge.application.setZoomFactor.provider(({ factor }) => {
    return Promise.resolve(setZoomFactor(factor));
  });

  // CDP status and configuration
  ipcBridge.application.getCdpStatus.provider(async () => {
    try {
      const status = getCdpStatus();
      // If port is set, CDP is considered enabled (verification is optional)
      return { success: true, data: status };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });

  ipcBridge.application.updateCdpConfig.provider(async (config) => {
    try {
      const updatedConfig = updateCdpConfig(config);
      return { success: true, data: updatedConfig };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });

  // Execute shell command (for OpenClaw CLI commands)
  ipcBridge.application.execCommand.provider(async ({ command, cwd }) => {
    try {
      const execAsync = promisify(exec);
      const { stdout, stderr } = await execAsync(command, {
        cwd: cwd || app.getPath('home'),
        env: process.env,
        timeout: 10000, // 10 秒超时
      });
      return { success: true, data: { stdout, stderr } };
    } catch (e: any) {
      // Command executed but may have non-zero exit code
      if (e.stdout || e.stderr) {
        return {
          success: true,
          data: { stdout: e.stdout, stderr: e.stderr },
        };
      }
      return {
        success: false,
        msg: e.message || e.toString(),
        data: { stdout: e.stdout, stderr: e.stderr },
      };
    }
  });
}
