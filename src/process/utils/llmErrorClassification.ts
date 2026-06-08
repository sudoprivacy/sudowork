/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

export type LlmErrorClass = 'context_window_exceeded' | 'single_request_too_large' | 'request_body_too_large' | 'rate_limit' | 'quota' | 'auth' | 'network' | 'timeout' | 'unknown';

export type LlmErrorClassification = {
  type: LlmErrorClass;
  recoverableByNewSession: boolean;
  userMessage: string;
};

const CONTEXT_WINDOW_PATTERNS = ['[context_window_exceeded]', 'context_window_exceeded', 'context_window_blocked', 'context length', 'maximum context length', 'context window', 'token limit', '超出模型处理限制', '超过模型处理限制', '对话内容过长'];

const SINGLE_REQUEST_PATTERNS = ['single_request_too_large', 'request content too large', 'request is too large', 'current request is too large', '当前请求内容过大', '图片或文本内容过大', '内容过大'];

const REQUEST_BODY_PATTERNS = ['request_body_too_large', 'request body size', 'payload too large', '413', 'base64'];

const includesAny = (message: string, patterns: string[]): boolean => {
  const normalized = message.toLowerCase();
  return patterns.some((pattern) => normalized.includes(pattern.toLowerCase()));
};

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const data = record.data;
    if (data && typeof data === 'object') {
      const dataRecord = data as Record<string, unknown>;
      const code = typeof dataRecord.code === 'string' ? dataRecord.code : '';
      const message = typeof dataRecord.message === 'string' ? dataRecord.message : '';
      if (code || message) return `${code} ${message}`.trim();
    }
    if (typeof record.code === 'string' || typeof record.message === 'string') {
      return `${record.code || ''} ${record.message || ''}`.trim();
    }
  }
  return String(error);
};

export function classifyLlmError(error: unknown): LlmErrorClassification {
  const message = extractErrorMessage(error);

  if (includesAny(message, SINGLE_REQUEST_PATTERNS)) {
    return {
      type: 'single_request_too_large',
      recoverableByNewSession: true,
      userMessage: '这次请求内容过大，超过当前模型处理限制。已为后续消息准备新的运行时上下文；如果要重试这份附件，请先压缩图片、拆分文件，或减少本次输入。',
    };
  }

  if (includesAny(message, CONTEXT_WINDOW_PATTERNS)) {
    return {
      type: 'context_window_exceeded',
      recoverableByNewSession: true,
      userMessage: '这次请求超过了当前模型上下文限制，未能完成。已为后续消息准备新的运行时上下文；你可以继续发送消息，但模型不会自动记住本次之前的完整历史。',
    };
  }

  if (includesAny(message, REQUEST_BODY_PATTERNS)) {
    return {
      type: 'request_body_too_large',
      recoverableByNewSession: false,
      userMessage: '这次请求体过大，未能发送给模型。请压缩图片、减少附件，或拆分后重试。',
    };
  }

  if (includesAny(message, ['insufficient_user_quota', 'quota is not enough', 'user quota is not enough'])) {
    return {
      type: 'quota',
      recoverableByNewSession: false,
      userMessage: '用户积分余额不足，请充值后再继续使用',
    };
  }

  if (includesAny(message, ['rate limit', 'too many requests', 'rate_limit_exceeded'])) {
    return {
      type: 'rate_limit',
      recoverableByNewSession: false,
      userMessage: '请求过于频繁，请稍后再试',
    };
  }

  if (includesAny(message, ['authentication', '认证失败', '[ACP-AUTH-', '403'])) {
    return {
      type: 'auth',
      recoverableByNewSession: false,
      userMessage: '认证失败，请检查API密钥配置',
    };
  }

  if (includesAny(message, ['timeout', 'timed out'])) {
    return {
      type: 'timeout',
      recoverableByNewSession: false,
      userMessage: '请求超时，请稍后重试',
    };
  }

  if (includesAny(message, ['connection', 'network', 'ECONNREFUSED'])) {
    return {
      type: 'network',
      recoverableByNewSession: false,
      userMessage: '连接失败，请检查网络',
    };
  }

  return {
    type: 'unknown',
    recoverableByNewSession: false,
    userMessage: message || '未知错误',
  };
}
