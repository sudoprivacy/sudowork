/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Renderer Crash Handler - 渲染进程 Crash/异常处理
 *
 * 功能:
 * - 捕获 window error 事件
 * - 捕获 unhandledrejection 事件
 * - 通过 IPC 上报到主进程 CrashReporter
 */

// ============================================================
// Crash 处理器
// ============================================================

/**
 * 初始化渲染进程 Crash 处理器
 *
 * 捕获 window error 和 unhandledrejection，上报到主进程
 */
export function initRendererCrashHandler(): void {
  if (typeof window === 'undefined') {
    return;
  }

  // 捕获 window error
  window.addEventListener('error', (event) => {
    // 忽略 ResizeObserver 等已知噪音错误
    const message = event.error?.message || event.message || '';
    if (shouldIgnoreError(message)) {
      return;
    }

    // 上报到主进程
    reportException({
      error_name: event.error?.name || 'Error',
      error_message: event.error?.message || message,
      stack_trace: event.error?.stack,
      context: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  // 捕获 unhandledrejection
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;

    // 如果是 Error 对象，提取信息
    if (reason instanceof Error) {
      const message = reason.message || '';
      if (shouldIgnoreError(message)) {
        return;
      }

      reportException({
        error_name: reason.name,
        error_message: reason.message,
        stack_trace: reason.stack,
        context: {
          type: 'unhandledrejection',
        },
      });
    } else {
      // 非 Error 对象的 rejection
      reportException({
        error_name: 'UnhandledRejection',
        error_message: String(reason),
        stack_trace: undefined,
        context: {
          type: 'unhandledrejection',
          reason_type: typeof reason,
        },
      });
    }
  });
}

/**
 * 上报异常到主进程
 */
function reportException(data: {
  error_name: string;
  error_message: string;
  stack_trace?: string;
  context?: Record<string, unknown>;
}): void {
  try {
    if (window.electronAPI?.crashReportException) {
      window.electronAPI.crashReportException(data).catch((error: Error) => {
        console.error('[CrashHandler] Failed to report exception:', error);
      });
    }
  } catch (error) {
    // 上报失败时静默处理，避免循环上报
    console.error('[CrashHandler] Failed to report exception:', error);
  }
}

/**
 * 添加面包屑 (供渲染进程代码调用)
 */
export function addRendererBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
  level?: 'debug' | 'info' | 'warning' | 'error',
): void {
  try {
    if (window.electronAPI?.crashAddBreadcrumb) {
      window.electronAPI.crashAddBreadcrumb({ category, message, data, level }).catch(() => {
        // 静默处理
      });
    }
  } catch {
    // 静默处理
  }
}

/**
 * 判断是否应该忽略的错误
 *
 * 某些第三方库产生的噪音错误不需要上报
 */
function shouldIgnoreError(message: string): boolean {
  const normalized = message.toLowerCase();

  // ResizeObserver 循环警告
  const resizeObserverPatterns = [
    'resizeobserver loop limit exceeded',
    'resizeobserver loop completed with undelivered notifications',
  ];
  if (resizeObserverPatterns.some((p) => normalized.includes(p))) {
    return true;
  }

  // Arco Design Message key 警告
  const arcoPatterns = ['each child in a list should have a unique "key" prop'];
  if (arcoPatterns.some((p) => normalized.includes(p))) {
    return true;
  }

  // React 19 ref 废弃警告
  const reactRefPatterns = ['accessing element.ref was removed in react 19', 'ref is now a regular prop'];
  if (reactRefPatterns.some((p) => normalized.includes(p))) {
    return true;
  }

  return false;
}

// ============================================================
// 自动初始化
// ============================================================

// 在模块加载时自动初始化
initRendererCrashHandler();