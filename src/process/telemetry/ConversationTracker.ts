/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ConversationTracker - 对话状态追踪
 *
 * 追踪内容：
 * - 对话开始/结束时间
 * - 对话状态 (success/error/user_cancel)
 * - 使用的模型
 * - Token 消耗
 */

import { getTelemetryReporter } from './TelemetryBatchReporter';
import type { ConversationStatus, ConversationData, ModelProvider } from '../../shared/types/telemetry';

// ============================================================
// 类型定义
// ============================================================

/** 对话追踪状态 */
interface ConversationTrackingState {
  sessionId: string;
  modelId: string;
  modelProvider?: ModelProvider;
  startTime: number;
  status: ConversationStatus;
  tokensUsed?: number;
  inputTokens?: number;
  outputTokens?: number;
  errorCode?: string;
}

// ============================================================
// ConversationTracker 类
// ============================================================

/**
 * 对话追踪器
 *
 * 单例模式，追踪对话生命周期
 */
export class ConversationTracker {
  private static instance: ConversationTracker | null = null;

  /** 当前活跃的对话追踪 */
  private activeConversations: Map<string, ConversationTrackingState> = new Map();

  /** 私有构造函数 */
  private constructor() {}

  /** 获取单例实例 */
  public static getInstance(): ConversationTracker {
    if (!ConversationTracker.instance) {
      ConversationTracker.instance = new ConversationTracker();
    }
    return ConversationTracker.instance;
  }

  /**
   * 开始对话追踪
   *
   * @param sessionId - 会话 ID
   * @param modelId - 模型 ID
   * @param modelProvider - 模型提供商
   */
  public startConversation(sessionId: string, modelId: string, modelProvider?: ModelProvider): void {
    const state: ConversationTrackingState = {
      sessionId,
      modelId,
      modelProvider,
      startTime: Date.now(),
      status: 'success', // 默认成功，后续可更新
    };

    this.activeConversations.set(sessionId, state);
  }

  /**
   * 更新 Token 使用量
   *
   * @param sessionId - 会话 ID
   * @param tokensUsed - 总 token 数
   * @param inputTokens - 输入 token
   * @param outputTokens - 输出 token
   */
  public updateTokens(
    sessionId: string,
    tokensUsed?: number,
    inputTokens?: number,
    outputTokens?: number,
  ): void {
    const state = this.activeConversations.get(sessionId);
    if (!state) {
      return;
    }

    if (tokensUsed !== undefined) {
      state.tokensUsed = tokensUsed;
    }
    if (inputTokens !== undefined) {
      state.inputTokens = inputTokens;
    }
    if (outputTokens !== undefined) {
      state.outputTokens = outputTokens;
    }
  }

  /**
   * 结束对话追踪 - 成功
   *
   * @param sessionId - 会话 ID
   */
  public endConversationSuccess(sessionId: string): void {
    const state = this.activeConversations.get(sessionId);
    if (!state) {
      return;
    }

    state.status = 'success';
    this.finalizeConversation(state);
  }

  /**
   * 结束对话追踪 - 错误
   *
   * @param sessionId - 会话 ID
   * @param errorCode - 错误码 (可选，默认为 E009 Agent 内部错误)
   */
  public endConversationError(sessionId: string, errorCode: string = 'E009'): void {
    const state = this.activeConversations.get(sessionId);
    if (!state) {
      return;
    }

    state.status = 'error';
    state.errorCode = errorCode;
    this.finalizeConversation(state);
  }

  /**
   * 结束对话追踪 - 用户取消
   *
   * @param sessionId - 会话 ID
   */
  public endConversationUserCancel(sessionId: string): void {
    const state = this.activeConversations.get(sessionId);
    if (!state) {
      return;
    }

    state.status = 'user_cancel';
    this.finalizeConversation(state);
  }

  /**
   * 完成对话并上报
   */
  private finalizeConversation(state: ConversationTrackingState): void {
    const duration = Date.now() - state.startTime;

    const conversationData: ConversationData = {
      session_id: state.sessionId,
      model_id: state.modelId,
      model_provider: state.modelProvider,
      status: state.status,
      duration_ms: duration,
      tokens_used: state.tokensUsed,
      input_tokens: state.inputTokens,
      output_tokens: state.outputTokens,
      error_code: state.errorCode,
    };

    // 移除追踪状态
    this.activeConversations.delete(state.sessionId);

    // 上报对话事件
    getTelemetryReporter().record('conversation', conversationData);
  }

  /**
   * 获取活跃对话数量
   */
  public getActiveCount(): number {
    return this.activeConversations.size;
  }

  /**
   * 获取对话状态
   */
  public getConversationState(sessionId: string): ConversationTrackingState | undefined {
    return this.activeConversations.get(sessionId);
  }
}

// ============================================================
// 导出便捷方法
// ============================================================

/** 获取对话追踪器实例 */
export const getConversationTracker = (): ConversationTracker => {
  return ConversationTracker.getInstance();
};

/** 开始对话追踪 */
export const startConversationTracking = (
  sessionId: string,
  modelId: string,
  modelProvider?: ModelProvider,
): void => {
  getConversationTracker().startConversation(sessionId, modelId, modelProvider);
};

/** 更新 Token 使用量 */
export const updateConversationTokens = (
  sessionId: string,
  tokensUsed?: number,
  inputTokens?: number,
  outputTokens?: number,
): void => {
  getConversationTracker().updateTokens(sessionId, tokensUsed, inputTokens, outputTokens);
};

/** 结束对话 - 成功 */
export const endConversationSuccess = (sessionId: string): void => {
  getConversationTracker().endConversationSuccess(sessionId);
};

/** 结束对话 - 错误 */
export const endConversationError = (sessionId: string, errorCode?: string): void => {
  getConversationTracker().endConversationError(sessionId, errorCode);
};

/** 结束对话 - 用户取消 */
export const endConversationUserCancel = (sessionId: string): void => {
  getConversationTracker().endConversationUserCancel(sessionId);
};