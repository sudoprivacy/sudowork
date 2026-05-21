/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Step Tracker - Step 追踪器
 *
 * Step 定义：Turn 内的具体操作
 * 追踪类型：
 * - tool_call: 工具调用
 * - permission_request: 权限请求
 * - file_operation: 文件操作
 * - thinking: 思考过程
 */

import { getTelemetryReporter } from './TelemetryBatchReporter';
import type { StepType, StepStatus, AgentType } from '../../shared/types/telemetry';
import { mainLog } from '../utils/mainLogger';

const TAG = 'StepTracker';

// ============================================================
// 类型定义
// ============================================================

interface StepTrackingState {
  stepId: string;
  turnId: string;
  sessionId: string;
  stepType: StepType;
  agentType?: AgentType;
  toolName?: string;
  toolKind?: 'read' | 'edit' | 'execute';
  filePath?: string;
  permissionKind?: string;
  startTime: number;
  status: StepStatus;
}

// ============================================================
// StepTracker 类
// ============================================================

/**
 * Step 追踪器
 *
 * 单例模式，追踪 Step 生命周期
 */
export class StepTracker {
  private static instance: StepTracker | null = null;

  /** 当前活跃的 Step 追踪 (按 stepId 索引) */
  private activeSteps: Map<string, StepTrackingState> = new Map();

  /** 工具调用 ID 映射 (toolCallId -> stepId) */
  private toolCallStepMap: Map<string, string> = new Map();

  /** 私有构造函数 */
  private constructor() {}

  /** 获取单例实例 */
  public static getInstance(): StepTracker {
    if (!StepTracker.instance) {
      StepTracker.instance = new StepTracker();
    }
    return StepTracker.instance;
  }

  // ============================================================
  // 工具调用追踪
  // ============================================================

  /**
   * 开始工具调用追踪
   *
   * @param sessionId - 会话 ID
   * @param turnId - Turn ID
   * @param toolCallId - 工具调用 ID (来自 ACP)
   * @param toolName - 工具名称
   * @param kind - 工具类型 (read/edit/execute)
   * @param agentType - Agent 类型 (sudocode, claude 等)
   * @returns stepId
   */
  public startToolCall(
    sessionId: string,
    turnId: string,
    toolCallId: string,
    toolName: string,
    kind: 'read' | 'edit' | 'execute',
    agentType?: AgentType
  ): string {
    const stepId = `step_tc_${toolCallId}`;

    const state: StepTrackingState = {
      stepId,
      turnId,
      sessionId,
      stepType: 'tool_call',
      agentType,
      toolName,
      toolKind: kind,
      startTime: Date.now(),
      status: 'pending',
    };

    this.activeSteps.set(stepId, state);
    this.toolCallStepMap.set(toolCallId, stepId);

    mainLog(TAG, `Tool call started: ${stepId} (tool: ${toolName}, kind: ${kind})`);

    return stepId;
  }

  /**
   * 结束工具调用追踪
   *
   * @param toolCallId - 工具调用 ID
   * @param status - 状态 (success/error)
   */
  public endToolCall(toolCallId: string, status: 'success' | 'error'): void {
    const stepId = this.toolCallStepMap.get(toolCallId);
    if (!stepId) {
      return;
    }

    const state = this.activeSteps.get(stepId);
    if (!state) {
      return;
    }

    state.status = status;
    this.finalizeStep(state);

    // 清理映射
    this.toolCallStepMap.delete(toolCallId);
  }

  // ============================================================
  // 权限请求追踪
  // ============================================================

  /**
   * 开始权限请求追踪
   *
   * @param sessionId - 会话 ID
   * @param turnId - Turn ID
   * @param permissionKind - 权限类型
   * @param agentType - Agent 类型 (sudocode, claude 等)
   * @returns stepId
   */
  public startPermissionRequest(sessionId: string, turnId: string, permissionKind: string, agentType?: AgentType): string {
    const stepId = `step_perm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const state: StepTrackingState = {
      stepId,
      turnId,
      sessionId,
      stepType: 'permission_request',
      agentType,
      permissionKind,
      startTime: Date.now(),
      status: 'pending',
    };

    this.activeSteps.set(stepId, state);

    mainLog(TAG, `Permission request started: ${stepId} (kind: ${permissionKind})`);

    return stepId;
  }

  /**
   * 结束权限请求追踪
   *
   * @param stepId - Step ID
   * @param approved - 是否批准
   */
  public endPermissionRequest(stepId: string, approved: boolean): void {
    const state = this.activeSteps.get(stepId);
    if (!state) {
      return;
    }

    state.status = approved ? 'success' : 'error';
    this.finalizeStep(state);
  }

  // ============================================================
  // 文件操作追踪
  // ============================================================

  /**
   * 记录文件操作 (直接上报)
   *
   * @param sessionId - 会话 ID
   * @param turnId - Turn ID
   * @param operation - 操作类型 (read/write/delete)
   * @param filePath - 文件路径
   * @param status - 状态
   * @param agentType - Agent 类型 (sudocode, claude 等)
   */
  public recordFileOperation(
    sessionId: string,
    turnId: string,
    operation: 'read' | 'write' | 'delete',
    filePath: string,
    status: 'success' | 'error' = 'success',
    agentType?: AgentType
  ): string {
    const stepId = `step_file_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // 直接上报，无需等待结束
    getTelemetryReporter().record('step', {
      step_id: stepId,
      turn_id: turnId,
      session_id: sessionId,
      step_type: 'file_operation',
      file_path: filePath,
      duration_ms: 0, // 文件操作通常很快，不追踪时长
      status,
    }, agentType);

    mainLog(TAG, `File operation recorded: ${stepId} (${operation}: ${filePath})`);

    return stepId;
  }

  // ============================================================
  // Thinking 追踪
  // ============================================================

  /**
   * 开始 Thinking 追踪
   *
   * @param sessionId - 会话 ID
   * @param turnId - Turn ID
   * @param agentType - Agent 类型 (sudocode, claude 等)
   * @returns stepId
   */
  public startThinking(sessionId: string, turnId: string, agentType?: AgentType): string {
    const stepId = `step_think_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const state: StepTrackingState = {
      stepId,
      turnId,
      sessionId,
      stepType: 'thinking',
      agentType,
      startTime: Date.now(),
      status: 'pending',
    };

    this.activeSteps.set(stepId, state);

    mainLog(TAG, `Thinking started: ${stepId}`);

    return stepId;
  }

  /**
   * 结束 Thinking 追踪
   *
   * @param stepId - Step ID
   * @param tokenCount - 思考 token 数量 (可选)
   */
  public endThinking(stepId: string, tokenCount?: number): void {
    const state = this.activeSteps.get(stepId);
    if (!state) {
      return;
    }

    state.status = 'success';
    this.finalizeStep(state, tokenCount);
  }

  // ============================================================
  // 通用方法
  // ============================================================

  /**
   * 完成 Step 并上报
   */
  private finalizeStep(state: StepTrackingState, thinkingTokens?: number): void {
    const duration = Date.now() - state.startTime;

    // 上报 Step 事件
    getTelemetryReporter().record('step', {
      step_id: state.stepId,
      turn_id: state.turnId,
      session_id: state.sessionId,
      step_type: state.stepType,
      tool_name: state.toolName,
      tool_kind: state.toolKind,
      file_path: state.filePath,
      permission_kind: state.permissionKind,
      thinking_tokens: thinkingTokens,
      duration_ms: duration,
      status: state.status,
    }, state.agentType);

    // 清理追踪状态
    this.activeSteps.delete(state.stepId);

    mainLog(TAG, `Step ended: ${state.stepId} (type: ${state.stepType}, status: ${state.status}, duration: ${duration}ms)`);
  }

  /**
   * 获取活跃 Step 数量
   */
  public getActiveCount(): number {
    return this.activeSteps.size;
  }

  /**
   * 获取工具调用的 Step ID
   */
  public getStepIdByToolCallId(toolCallId: string): string | undefined {
    return this.toolCallStepMap.get(toolCallId);
  }
}

// ============================================================
// 导出便捷方法
// ============================================================

/** 获取 Step 追踪器实例 */
export const getStepTracker = (): StepTracker => {
  return StepTracker.getInstance();
};

/** 开始工具调用追踪 */
export const startToolCallTracking = (
  sessionId: string,
  turnId: string,
  toolCallId: string,
  toolName: string,
  kind: 'read' | 'edit' | 'execute',
  agentType?: AgentType
): string => {
  return getStepTracker().startToolCall(sessionId, turnId, toolCallId, toolName, kind, agentType);
};

/** 结束工具调用追踪 */
export const endToolCallTracking = (toolCallId: string, status: 'success' | 'error'): void => {
  getStepTracker().endToolCall(toolCallId, status);
};

/** 开始权限请求追踪 */
export const startPermissionRequestTracking = (sessionId: string, turnId: string, permissionKind: string, agentType?: AgentType): string => {
  return getStepTracker().startPermissionRequest(sessionId, turnId, permissionKind, agentType);
};

/** 结束权限请求追踪 */
export const endPermissionRequestTracking = (stepId: string, approved: boolean): void => {
  getStepTracker().endPermissionRequest(stepId, approved);
};

/** 记录文件操作 */
export const recordFileOperationStep = (
  sessionId: string,
  turnId: string,
  operation: 'read' | 'write' | 'delete',
  filePath: string,
  status?: 'success' | 'error',
  agentType?: AgentType
): string => {
  return getStepTracker().recordFileOperation(sessionId, turnId, operation, filePath, status, agentType);
};

/** 开始 Thinking 追踪 */
export const startThinkingTracking = (sessionId: string, turnId: string, agentType?: AgentType): string => {
  return getStepTracker().startThinking(sessionId, turnId, agentType);
};

/** 结束 Thinking 追踪 */
export const endThinkingTracking = (stepId: string, tokenCount?: number): void => {
  getStepTracker().endThinking(stepId, tokenCount);
};