/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { ADAPTER_BRIDGE_EVENT_KEY } from './adapter/constant';

/**
 * @description 注入到renderer进程中, 用于与main进程通信
 * */
contextBridge.exposeInMainWorld('electronAPI', {
  emit: (name: string, data: any) => {
    return ipcRenderer
      .invoke(
        ADAPTER_BRIDGE_EVENT_KEY,
        JSON.stringify({
          name: name,
          data: data,
        })
      )
      .catch((error) => {
        console.error('IPC invoke error:', error);
        throw error;
      });
  },
  on: (callback: any) => {
    const handler = (event: any, value: any) => {
      callback({ event, value });
    };
    ipcRenderer.on(ADAPTER_BRIDGE_EVENT_KEY, handler);
    return () => {
      ipcRenderer.off(ADAPTER_BRIDGE_EVENT_KEY, handler);
    };
  },
  // 获取拖拽文件/目录的绝对路径 / Get absolute path for dragged file/directory
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  // 直接 IPC 调用（绕过 bridge库）/ Direct IPC calls (bypass bridge library)
  webuiResetPassword: () => ipcRenderer.invoke('webui-direct-reset-password'),
  webuiGetStatus: () => ipcRenderer.invoke('webui-direct-get-status'),
  // 修改密码不需要当前密码 / Change password without current password
  webuiChangePassword: (newPassword: string) => ipcRenderer.invoke('webui-direct-change-password', { newPassword }),
  // 生成二维码 token / Generate QR token
  webuiGenerateQRToken: () => ipcRenderer.invoke('webui-direct-generate-qr-token'),
  terminalCreate: (params: { cwd?: string; shell?: string }) => ipcRenderer.invoke('terminal.create', params),
  terminalWrite: (params: { sessionId: string; data: string }) => ipcRenderer.invoke('terminal.write', params),
  terminalResize: (params: { sessionId: string; cols: number; rows: number }) => ipcRenderer.invoke('terminal.resize', params),
  terminalDispose: (params: { sessionId: string }) => ipcRenderer.invoke('terminal.dispose', params),
  // ==================== FUSE-T smoke testing (dev mode only) ====================
  // Direct IPC handles registered only when `!app.isPackaged`, see fuseTBridge.ts.
  // The production renderer path is `ipcBridge.fuseT.ensureInstalled.invoke()`
  // (bridge.buildProvider's subscribe/callback protocol). DevTools console can't
  // import the bundled ipcBridge module, so these direct handles exist purely so
  // a Mac smoke tester can drive the lazy install from the console — they are
  // NOT exposed in packaged builds.
  devFuseTCheckInstalled: () => ipcRenderer.invoke('dev.fuse-t.check-installed'),
  devFuseTEnsureInstalled: () => ipcRenderer.invoke('dev.fuse-t.ensure-installed'),
  // ==================== Crash Reporter (渲染进程上报) ====================
  // 上报 JS 异常到主进程 CrashReporter
  crashReportException: (data: { error_name: string; error_message: string; stack_trace?: string; context?: Record<string, unknown> }) => ipcRenderer.invoke('crash.report-exception', data),
  // 添加面包屑到主进程 CrashReporter
  crashAddBreadcrumb: (data: { category: string; message: string; data?: Record<string, unknown>; level?: 'debug' | 'info' | 'warning' | 'error' }) => ipcRenderer.invoke('crash.add-breadcrumb', data),
});
