/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message } from '@arco-design/web-react';
import type { TFunction } from 'i18next';

/**
 * 统一的错误消息配置
 */
export interface ErrorToastOptions {
  /** 消息持续时间（毫秒） */
  duration?: number;
  /** 是否显示关闭按钮 */
  closable?: boolean;
  /** i18n 翻译函数 */
  t?: TFunction;
}

/**
 * 显示错误消息
 * @param message 错误消息内容
 * @param options 配置选项
 */
export const showErrorToast = (message: string, options?: ErrorToastOptions): void => {
  const { duration = 3000, closable = true } = options || {};
  Message.error({
    content: message,
    duration,
    closable,
  });
};

/**
 * 显示成功消息
 * @param message 成功消息内容
 * @param options 配置选项
 */
export const showSuccessToast = (message: string, options?: ErrorToastOptions): void => {
  const { duration = 2000, closable = false } = options || {};
  Message.success({
    content: message,
    duration,
    closable,
  });
};

/**
 * 显示警告消息
 * @param message 警告消息内容
 * @param options 配置选项
 */
export const showWarningToast = (message: string, options?: ErrorToastOptions): void => {
  const { duration = 3000, closable = true } = options || {};
  Message.warning({
    content: message,
    duration,
    closable,
  });
};

/**
 * 显示信息消息
 * @param message 信息消息内容
 * @param options 配置选项
 */
export const showInfoToast = (message: string, options?: ErrorToastOptions): void => {
  const { duration = 3000, closable = false } = options || {};
  Message.info({
    content: message,
    duration,
    closable,
  });
};

/**
 * 统一错误处理
 * @param error 错误对象或消息
 * @param defaultMessage 默认错误消息
 * @param options 配置选项
 */
export const handleErrorResponse = (
  error: unknown,
  defaultMessage = 'common.operationFailed',
  options?: ErrorToastOptions
): void => {
  const { t, duration = 3000, closable = true } = options || {};

  let errorMessage = t ? t(defaultMessage) : defaultMessage;

  if (error instanceof Error) {
    errorMessage = error.message;
  } else if (typeof error === 'string') {
    errorMessage = error;
  } else if (error && typeof error === 'object' && 'message' in error) {
    errorMessage = String((error as { message: unknown }).message);
  }

  showErrorToast(errorMessage, { duration, closable, t });
};

/**
 * 常用的预定义错误消息 key
 */
export const CommonErrorKeys = {
  // 通用错误
  OPERATION_FAILED: 'common.operationFailed',
  SAVE_FAILED: 'common.saveFailed',
  DELETE_FAILED: 'common.deleteFailed',
  COPY_FAILED: 'common.copyFailed',
  LOAD_FAILED: 'common.loadFailed',

  // 网络错误
  NETWORK_ERROR: 'errors.networkError',
  TIMEOUT: 'errors.timeout',
  CONNECTION_FAILED: 'errors.connectionFailed',

  // 验证错误
  VALIDATION_ERROR: 'errors.validationError',
  REQUIRED_FIELD: 'errors.requiredField',
  INVALID_FORMAT: 'errors.invalidFormat',

  // 权限错误
  PERMISSION_DENIED: 'errors.permissionDenied',
  NOT_AUTHORIZED: 'errors.notAuthorized',

  // 文件操作
  FILE_NOT_FOUND: 'errors.fileNotFound',
  FILE_READ_FAILED: 'errors.fileReadFailed',
  FILE_WRITE_FAILED: 'errors.fileWriteFailed',

  // API 错误
  API_ERROR: 'errors.apiError',
  API_TIMEOUT: 'errors.apiTimeout',
  API_RATE_LIMITED: 'errors.apiRateLimited',
} as const;

/**
 * 显示带行动按钮的错误消息（用于需要重试的场景）
 * 注意：Arco Design Message 不支持 custom footer，此函数使用普通错误消息
 * @param message 错误消息内容
 * @param onRetry 重试回调函数
 * @param options 配置选项
 * @deprecated 请使用 showErrorToast 并在外部处理重试逻辑
 */
export const showErrorToastWithRetry = (
  message: string,
  _onRetry: () => void | Promise<void>,
  options?: ErrorToastOptions
): void => {
  // Arco Design Message 不支持自定义 footer，使用普通错误消息
  showErrorToast(message, options);
};
