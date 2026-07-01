/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Telemetry Bridge - IPC 桥接实现
 *
 * 将渲染进程的遥测请求转发到主进程的 Telemetry 模块
 */

import { ipcBridge } from '../../common';
import { ProcessConfig } from '../initStorage';
import { getTelemetryReporter, getPerfTracker, getConversationTracker, flushTelemetry, getUserContextSync } from '../telemetry';

export function initTelemetryBridge(): void {
  // 获取遥测状态
  ipcBridge.telemetry.getStatus.provider(async () => {
    const reporter = getTelemetryReporter();
    const status = reporter.getStatus();
    return { success: true, data: status };
  });

  // 设置启用状态
  ipcBridge.telemetry.setEnabled.provider(async ({ enabled }) => {
    const reporter = getTelemetryReporter();
    await reporter.setEnabled(enabled);
    const isPersonal = getUserContextSync().login_mode === 'personal';
    await ProcessConfig.set('telemetry.enabled', isPersonal ? enabled : false);
    return { success: true };
  });

  // 检查是否已显示 opt-in 弹窗
  ipcBridge.telemetry.getOptInShown.provider(async () => {
    const shown = await ProcessConfig.get('telemetry.optInShown').catch(() => false);
    return { success: true, data: shown ?? false };
  });

  // 标记 opt-in 弹窗已显示
  ipcBridge.telemetry.setOptInShown.provider(async () => {
    await ProcessConfig.set('telemetry.optInShown', true);
    return { success: true };
  });

  // 标记渲染进程就绪 (首屏时间)
  ipcBridge.telemetry.markRendererReady.provider(async () => {
    const perfTracker = getPerfTracker();
    perfTracker.markRendererReady();
    return { success: true };
  });

  // 记录首 token 时间
  ipcBridge.telemetry.recordFirstToken.provider(async ({ session_id, duration_ms }) => {
    const perfTracker = getPerfTracker();
    perfTracker.recordFirstToken(session_id, duration_ms);
    return { success: true };
  });

  // 开始对话追踪
  ipcBridge.telemetry.startConversation.provider(async ({ session_id, model_id, model_provider }) => {
    const conversationTracker = getConversationTracker();
    conversationTracker.startConversation(session_id, model_id, model_provider);
    return { success: true };
  });

  // 更新对话 token 使用量
  ipcBridge.telemetry.updateConversationTokens.provider(async ({ session_id, tokens_used, input_tokens, output_tokens }) => {
    const conversationTracker = getConversationTracker();
    conversationTracker.updateTokens(session_id, tokens_used, input_tokens, output_tokens);
    return { success: true };
  });

  // 结束对话追踪
  ipcBridge.telemetry.endConversation.provider(async ({ session_id, status, error_code, tokens_used, input_tokens, output_tokens }) => {
    const conversationTracker = getConversationTracker();

    // 先更新 token（如果有）
    if (tokens_used !== undefined || input_tokens !== undefined || output_tokens !== undefined) {
      conversationTracker.updateTokens(session_id, tokens_used, input_tokens, output_tokens);
    }

    // 结束对话
    switch (status) {
      case 'success':
        conversationTracker.endConversationSuccess(session_id);
        break;
      case 'error':
        conversationTracker.endConversationError(session_id, error_code);
        break;
      case 'user_cancel':
        conversationTracker.endConversationUserCancel(session_id);
        break;
    }

    return { success: true };
  });

  // 上报剩余事件
  ipcBridge.telemetry.flush.provider(async () => {
    await flushTelemetry();
    return { success: true };
  });
}
