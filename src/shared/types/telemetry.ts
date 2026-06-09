/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Telemetry Types - 遥测数据类型定义
 *
 * 定义客户端上报数据结构，与服务端 Schema 保持一致
 */

// ============================================================
// 基础类型
// ============================================================

/** 平台类型 */
export type TelemetryPlatform = 'darwin' | 'win32' | 'linux';

/** 架构类型 - 与 QMS 服务端聚合字段保持一致 */
export type TelemetryArch = 'x64' | 'arm64' | 'x86';

/**
 * 将 Electron process.arch 映射到 QMS 遥测 arch 字段
 *
 * 映射规则：
 * - 'x64' → 'x64' (Intel/x86_64)
 * - 'arm64' → 'arm64' (Apple Silicon)
 * - 'ia32' → 'x86' (32-bit Windows)
 */
export function mapElectronArch(arch: string): TelemetryArch {
  if (arch === 'ia32') {
    return 'x86';
  }
  return arch as TelemetryArch;
}

/** 遥测事件类型 */
export type TelemetryEventType = 'perf' | 'conversation' | 'install' | 'turn' | 'step';

/** 性能指标类型 */
export type PerfMetricType = 'cold_start' | 'first_screen' | 'first_token';

/** 对话状态 */
export type ConversationStatus = 'success' | 'error' | 'user_cancel';

/** Turn 状态 */
export type TurnStatus = 'success' | 'error';

/** Step 状态 */
export type StepStatus = 'success' | 'error' | 'pending';

/** Step 类型 */
export type StepType = 'tool_call' | 'permission_request' | 'file_operation' | 'thinking';

/** 安装状态 */
export type InstallStatus = 'success' | 'failed';

/** 安装类型 */
export type InstallType = 'fresh' | 'update';

/** 模型提供商 */
export type ModelProvider = 'openai' | 'anthropic' | 'google' | (string & {});

/** Agent 类型 - 数据来源标识 */
export type AgentType = 'sudocode' | 'claude' | 'qwen' | 'gemini' | 'codex' | 'scode' | (string & {});

/** 登录模式 */
export type LoginMode = 'enterprise' | 'personal';

// ============================================================
// 错误码定义 (E001-E010)
// ============================================================

/**
 * 错误码定义
 *
 * | 错误码 | 错误类型 | 定位代码 | 上游组件 |
 * |--------|----------|----------|----------|
 * | E001 | HTTP 5xx / 连接错 | RotatingApiClient.ts | nova-gateway |
 * | E002 | HTTP 超时 | RotatingApiClient.ts | nova-gateway |
 * | E003 | SSE 中断 | AcpConnection.ts | acp |
 * | E004 | 空响应 | AcpAgent.ts | acp |
 * | E005 | ACP 解析错 | AcpMessagePipeline.ts | acp |
 * | E006 | Gateway 鉴权 | AuthService.ts | nova-gateway |
 * | E007 | Gateway 余额 | BillingService.ts | nova-gateway |
 * | E008 | 渲染 crash | ConversationPage.tsx | client |
 * | E009 | Agent 内部错 | AcpAgent.ts | client |
 * | E010 | Gateway 断开 | (reserved) | sudoclaw |
 */
export type TelemetryErrorCode =
  | 'E001' // HTTP 5xx 错误 / 网络连接错误
  | 'E002' // HTTP 超时
  | 'E003' // SSE 中断
  | 'E004' // 空响应
  | 'E005' // ACP 解析错
  | 'E006' // Gateway 鉴权失败
  | 'E007' // Gateway 余额不足
  | 'E008' // 渲染 crash
  | 'E009' // Agent 内部错误
  | 'E010'; // Gateway 断开

/** 错误码描述映射 */
export const ERROR_CODE_DESCRIPTION: Record<TelemetryErrorCode, string> = {
  E001: 'HTTP 5xx server error or network connection error',
  E002: 'HTTP request timeout',
  E003: 'SSE stream interrupted',
  E004: 'Empty response received',
  E005: 'ACP protocol parse error',
  E006: 'Gateway authentication failed',
  E007: 'Gateway balance insufficient',
  E008: 'Renderer process crash',
  E009: 'Agent internal error',
  E010: 'Gateway disconnected',
};

// ============================================================
// 数据结构定义
// ============================================================

/** 性能数据 */
export interface PerfData {
  metric: PerfMetricType;
  value_ms: number;
  session_id?: string;
}

/** 对话数据 */
export interface ConversationData {
  session_id: string;
  model_id: string;
  model_provider?: ModelProvider;
  status: ConversationStatus;
  duration_ms: number;
  tokens_used?: number;
  input_tokens?: number;
  output_tokens?: number;
  error_code?: string; // 如果 status=error，错误码如 E001-E010
}

/** 安装数据 */
export interface InstallData {
  install_id: string;
  status: InstallStatus;
  duration_ms: number;
  install_type?: InstallType;
  previous_version?: string; // 如果是 update
  error_message?: string; // 如果是 failed
}

/** Turn 数据 - 单次用户输入到 AI 响应 */
export interface TurnData {
  turn_id: string;
  session_id: string;
  model_id: string;
  model_provider?: ModelProvider;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  duration_ms: number;
  status: TurnStatus;
  error_code?: string;
}

/** Step 数据 - Turn 内的具体操作 */
export interface StepData {
  step_id: string;
  turn_id: string;
  session_id: string;
  step_type: StepType;
  tool_name?: string; // tool_call 专用
  tool_kind?: 'read' | 'edit' | 'execute'; // tool_call 专用
  file_path?: string; // file_operation 专用
  permission_kind?: string; // permission_request 专用
  thinking_tokens?: number; // thinking 专用
  duration_ms?: number;
  status: StepStatus;
}

// ============================================================
// 遥测事件定义
// ============================================================

/** 遥测事件基础结构 */
export interface TelemetryEventBase {
  type: TelemetryEventType;
  timestamp: number; // Unix milliseconds
  version: string; // 客户端版本
  platform: TelemetryPlatform;
  arch: TelemetryArch;
  /** 组织 ID - 从 JWT Token 解析 */
  org_id?: string;
  /** 用户 ID - 从 JWT Token 解析 */
  user_id?: string;
  /** 租户 ID - 从 JWT Token 解析 (如果有) */
  tenant_id?: string;
  /** 登录模式 - 企业模式/个人模式 */
  login_mode?: LoginMode;
  /** Agent 类型 - 数据来源标识 (sudocode, claude, qwen 等) */
  agent_type?: AgentType;
  /** 用户昵称 */
  user_nickname?: string;
  /** 用户手机号 */
  user_phone?: string;
}

/** 性能事件 */
export interface PerfTelemetryEvent extends TelemetryEventBase {
  type: 'perf';
  data: PerfData;
}

/** 对话事件 */
export interface ConversationTelemetryEvent extends TelemetryEventBase {
  type: 'conversation';
  data: ConversationData;
}

/** 安装事件 */
export interface InstallTelemetryEvent extends TelemetryEventBase {
  type: 'install';
  data: InstallData;
}

/** Turn 事件 */
export interface TurnTelemetryEvent extends TelemetryEventBase {
  type: 'turn';
  data: TurnData;
}

/** Step 事件 */
export interface StepTelemetryEvent extends TelemetryEventBase {
  type: 'step';
  data: StepData;
}

/** 遥测事件联合类型 */
export type TelemetryEvent =
  | PerfTelemetryEvent
  | ConversationTelemetryEvent
  | InstallTelemetryEvent
  | TurnTelemetryEvent
  | StepTelemetryEvent;

// ============================================================
// 批量上报请求结构
// ============================================================

/** 批量上报请求 */
export interface TelemetryBatchRequest {
  events: TelemetryEvent[];
}

/** 批量上报响应 */
export interface TelemetryBatchResponse {
  success: boolean;
  received: number;
  message?: string;
  error?: string;
}

// ============================================================
// 遥测配置
// ============================================================

/** 遥测配置选项 */
export interface TelemetryConfig {
  enabled: boolean;
  serverUrl?: string;
  batchSize: number; // 批量上报大小
  flushInterval: number; // 上报间隔 (ms)
  maxRetries: number; // 最大重试次数
  retryDelay: number; // 重试延迟 (ms)
}

/** 默认遥测配置 */
export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  enabled: true,
  serverUrl: 'https://sudowork-qms.sudoprivacy.com/api/v1/telemetry/batch',
  batchSize: 50,
  flushInterval: 30000, // 30 秒
  maxRetries: 3,
  retryDelay: 5000, // 5 秒
};

// ============================================================
// 遥测存储结构 (用于离线缓存)
// ============================================================

/** 遥测存储事件 (带 ID) */
export interface StoredTelemetryEvent {
  id: string; // 本地存储 ID
  storedAt: number; // 存储时间
  retryCount: number; // 重试次数
  // Event fields
  type: TelemetryEventType;
  timestamp: number;
  version: string;
  platform: TelemetryPlatform;
  arch: TelemetryArch;
  org_id?: string;
  user_id?: string;
  tenant_id?: string;
  login_mode?: LoginMode;
  agent_type?: AgentType;
  user_nickname?: string;
  user_phone?: string;
  data: PerfData | ConversationData | InstallData | TurnData | StepData;
}