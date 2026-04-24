/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/** LLM error code to Chinese message translation map */
export const LLM_ERROR_TRANSLATIONS: Record<string, string> = {
  insufficient_user_quota: '用户积分余额不足，请充值后再继续使用',
  rate_limit_exceeded: '请求过于频繁，请稍后再试',
  invalid_api_key: 'API密钥无效，请检查配置',
  model_not_found: '模型不存在或不可用',
  context_length_exceeded: '对话内容过长，超出模型处理限制',
  server_error: '服务器内部错误，请稍后重试',
  timeout: '请求超时，请稍后重试',
  connection_error: '连接失败，请检查网络',
  authentication_failed: '认证失败，请检查API密钥配置',
};

/**
 * Translate LLM error message to user-friendly Chinese message.
 * Parses the error to detect specific error codes and returns translated message.
 * Falls back to original message for unknown errors.
 */
export function translateLLMError(errorMessage: string): string {
  if (!errorMessage) return '未知错误';

  // Try to extract error code from message patterns
  // Pattern 1: direct error code in message
  for (const [code, chinese] of Object.entries(LLM_ERROR_TRANSLATIONS)) {
    if (errorMessage.includes(code)) {
      return chinese;
    }
  }

  // Pattern 2: "user quota is not enough" text
  if (errorMessage.includes('user quota is not enough') || errorMessage.includes('quota is not enough')) {
    return LLM_ERROR_TRANSLATIONS.insufficient_user_quota;
  }

  // Pattern 3: rate limit related
  if (errorMessage.includes('rate limit') || errorMessage.includes('too many requests')) {
    return LLM_ERROR_TRANSLATIONS.rate_limit_exceeded;
  }

  // Pattern 4: context/token length related
  if (errorMessage.includes('context length') || errorMessage.includes('maximum context length') || errorMessage.includes('token limit')) {
    return LLM_ERROR_TRANSLATIONS.context_length_exceeded;
  }

  // Pattern 5: timeout related
  if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
    return LLM_ERROR_TRANSLATIONS.timeout;
  }

  // Pattern 6: connection related
  if (errorMessage.includes('connection') || errorMessage.includes('network') || errorMessage.includes('ECONNREFUSED')) {
    return LLM_ERROR_TRANSLATIONS.connection_error;
  }

  // Pattern 7: server error
  if (errorMessage.includes('server error') || errorMessage.includes('internal error') || errorMessage.includes('500')) {
    return LLM_ERROR_TRANSLATIONS.server_error;
  }

  // Pattern 8: authentication related
  if (errorMessage.includes('Failed to authenticate') || errorMessage.includes('authentication failed') || errorMessage.includes('403')) {
    return LLM_ERROR_TRANSLATIONS.authentication_failed;
  }

  // Return original message if no translation found
  return errorMessage;
}