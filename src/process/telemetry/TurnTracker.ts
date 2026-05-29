/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turn Tracker - Turn 追踪器
 *
 * Turn 定义：一次用户输入到 AI 响应完成
 * 追踪内容：
 * - turn_id
 * - session_id
 * - model_id, model_provider
 * - tokens 消耗
 * - duration
 * - status
 */

import { getTelemetryReporter } from './TelemetryBatchReporter';
import type { TurnStatus, ModelProvider, AgentType } from '../../shared/types/telemetry';
import type { AcpPromptResponseUsage } from '../../types/acpTypes';
import { mainLog } from '../utils/mainLogger';

const TAG = 'TurnTracker';

// ============================================================
// 类型定义
// ============================================================

interface TurnTrackingState {
  turnId: string;
  sessionId: string;
  modelId: string;
  modelProvider?: ModelProvider;
  agentType?: AgentType;
  startTime: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  status: TurnStatus;
  errorCode?: string;
}

// ============================================================
// TurnTracker 类
// ============================================================

/**
 * Turn 追踪器
 *
 * 单例模式，追踪 Turn 生命周期
 */
export class TurnTracker {
  private static instance: TurnTracker | null = null;

  /** 当前活跃的 Turn 追踪 (按 sessionId 索引) */
  private activeTurns: Map<string, TurnTrackingState> = new Map();

  /** 当前 Turn ID 映射 (sessionId -> turnId) */
  private currentTurnId: Map<string, string> = new Map();

  /** 私有构造函数 */
  private constructor() {}

  /** 获取单例实例 */
  public static getInstance(): TurnTracker {
    if (!TurnTracker.instance) {
      TurnTracker.instance = new TurnTracker();
    }
    return TurnTracker.instance;
  }

  /**
   * 开始 Turn 追踪
   *
   * @param sessionId - 会话 ID
   * @param modelId - 模型 ID
   * @param modelProvider - 模型提供商
   * @param agentType - Agent 类型 (sudocode, claude 等)
   * @returns turnId - Turn ID
   */
  public startTurn(sessionId: string, modelId: string, modelProvider?: ModelProvider, agentType?: AgentType): string {
    const turnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const state: TurnTrackingState = {
      turnId,
      sessionId,
      modelId,
      modelProvider,
      agentType,
      startTime: Date.now(),
      status: 'success', // 默认成功
    };

    this.activeTurns.set(sessionId, state);
    this.currentTurnId.set(sessionId, turnId);

    mainLog(TAG, `Turn started: ${turnId} (session: ${sessionId}, model: ${modelId}, agent: ${agentType || 'N/A'})`);

    return turnId;
  }

  /**
   * 更新 Turn Token 使用量
   *
   * @param sessionId - 会话 ID
   * @param usage - Token 使用量
   */
  public updateTokens(sessionId: string, usage: AcpPromptResponseUsage): void {
    const state = this.activeTurns.get(sessionId);
    if (!state) {
      return;
    }

    state.inputTokens = usage.inputTokens;
    state.outputTokens = usage.outputTokens;
    state.totalTokens = usage.totalTokens;
  }

  /**
   * 结束 Turn 追踪 - 成功
   *
   * @param sessionId - 会话 ID
   */
  public endTurnSuccess(sessionId: string): void {
    const state = this.activeTurns.get(sessionId);
    if (!state) {
      return;
    }

    state.status = 'success';
    this.finalizeTurn(state);
  }

  /**
   * 结束 Turn 追踪 - 错误
   *
   * @param sessionId - 会话 ID
   * @param errorCode - 错误码
   */
  public endTurnError(sessionId: string, errorCode?: string): void {
    const state = this.activeTurns.get(sessionId);
    if (!state) {
      return;
    }

    state.status = 'error';
    state.errorCode = errorCode;
    this.finalizeTurn(state);
  }

  /**
   * 完成 Turn 并上报
   */
  private finalizeTurn(state: TurnTrackingState): void {
    const duration = Date.now() - state.startTime;

    // 上报 Turn 事件
    getTelemetryReporter().record('turn', {
      turn_id: state.turnId,
      session_id: state.sessionId,
      model_id: state.modelId,
      model_provider: state.modelProvider,
      input_tokens: state.inputTokens,
      output_tokens: state.outputTokens,
      total_tokens: state.totalTokens,
      duration_ms: duration,
      status: state.status,
      error_code: state.errorCode,
    }, state.agentType);

    // 清理追踪状态
    this.activeTurns.delete(state.sessionId);
    this.currentTurnId.delete(state.sessionId);

    mainLog(
      TAG,
      `Turn ended: ${state.turnId} (status: ${state.status}, duration: ${duration}ms, tokens: ${state.totalTokens || 'N/A'})`
    );
  }

  /**
   * 获取当前 Turn ID
   *
   * @param sessionId - 会话 ID
   */
  public getCurrentTurnId(sessionId: string): string | undefined {
    return this.currentTurnId.get(sessionId);
  }

  /**
   * 获取活跃 Turn 数量
   */
  public getActiveCount(): number {
    return this.activeTurns.size;
  }

  /**
   * 获取 Turn 状态
   */
  public getTurnState(sessionId: string): TurnTrackingState | undefined {
    return this.activeTurns.get(sessionId);
  }
}

// ============================================================
// 导出便捷方法
// ============================================================

/** 获取 Turn 追踪器实例 */
export const getTurnTracker = (): TurnTracker => {
  return TurnTracker.getInstance();
};

/** 开始 Turn 追踪 */
export const startTurnTracking = (sessionId: string, modelId: string, modelProvider?: ModelProvider, agentType?: AgentType): string => {
  return getTurnTracker().startTurn(sessionId, modelId, modelProvider, agentType);
};

/** 更新 Turn Token 使用量 */
export const updateTurnTokens = (sessionId: string, usage: AcpPromptResponseUsage): void => {
  getTurnTracker().updateTokens(sessionId, usage);
};

/** 结束 Turn - 成功 */
export const endTurnSuccess = (sessionId: string): void => {
  getTurnTracker().endTurnSuccess(sessionId);
};

/** 结束 Turn - 错误 */
export const endTurnError = (sessionId: string, errorCode?: string): void => {
  getTurnTracker().endTurnError(sessionId, errorCode);
};

/** 获取当前 Turn ID */
export const getCurrentTurnId = (sessionId: string): string | undefined => {
  return getTurnTracker().getCurrentTurnId(sessionId);
};
