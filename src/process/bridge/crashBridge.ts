/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Crash Bridge - IPC 桥接实现
 * / Crash Bridge - IPC Bridge Implementation
 *
 * 将渲染进程的 crash 上报请求转发到主进程的 CrashReporter 模块
 * / Forward crash reports from renderer process to main process CrashReporter module
 */

import { ipcMain } from 'electron';
import { ipcBridge } from '../../common';
import { getCrashReporter, addCrashBreadcrumb, flushCrashReporter } from '../telemetry/CrashReporter';

export function initCrashBridge(): void {
  // 注册直接 IPC handlers (preload.ts 使用 ipcRenderer.invoke 直接调用)
  // Register direct IPC handlers (preload.ts uses ipcRenderer.invoke directly)

  // 上报渲染进程 JS 异常 / Report renderer process JS exceptions
  ipcMain.handle('crash.report-exception', async (_event, data) => {
    const { error_name, error_message, stack_trace, context } = data;
    const crashReporter = getCrashReporter();
    crashReporter.captureRendererException({
      error_name,
      error_message,
      stack_trace,
      context,
    });
    return { success: true };
  });

  // 添加面包屑 / Add breadcrumb
  ipcMain.handle('crash.add-breadcrumb', async (_event, data) => {
    const { category, message, data: breadcrumbData, level } = data;
    addCrashBreadcrumb(category, message, breadcrumbData, level);
    return { success: true };
  });

  // 同时注册 bridge library handlers (用于 ipcBridge 调用)
  // Also register bridge library handlers (for ipcBridge calls)

  // 上报渲染进程 JS 异常
  ipcBridge.crash.reportException.provider(async ({ error_name, error_message, stack_trace, context }) => {
    const crashReporter = getCrashReporter();
    crashReporter.captureRendererException({
      error_name,
      error_message,
      stack_trace,
      context,
    });
    return { success: true };
  });

  // 添加面包屑
  ipcBridge.crash.addBreadcrumb.provider(async ({ category, message, data, level }) => {
    addCrashBreadcrumb(category, message, data, level);
    return { success: true };
  });

  // 获取 CrashReporter 状态
  ipcBridge.crash.getStatus.provider(async () => {
    const crashReporter = getCrashReporter();
    const status = crashReporter.getStatus();
    return { success: true, data: status };
  });

  // 清空面包屑
  ipcBridge.crash.clearBreadcrumbs.provider(async () => {
    const crashReporter = getCrashReporter();
    crashReporter.clearBreadcrumbs();
    return { success: true };
  });

  // 上报剩余 crash 事件
  ipcBridge.crash.flush.provider(async () => {
    await flushCrashReporter();
    return { success: true };
  });
}
