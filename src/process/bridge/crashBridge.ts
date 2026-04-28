/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Crash Bridge - IPC 桥接实现
 *
 * 将渲染进程的 crash 上报请求转发到主进程的 CrashReporter 模块
 */

import { ipcBridge } from '../../common';
import {
  getCrashReporter,
  addCrashBreadcrumb,
  flushCrashReporter,
} from '../telemetry/CrashReporter';

export function initCrashBridge(): void {
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