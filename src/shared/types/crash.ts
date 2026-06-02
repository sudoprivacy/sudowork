/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Crash Types - Crash/异常上报数据类型定义
 *
 * 用于 sudowork-qms 替代 Sentry 的 Crash 捕获功能
 */

// ============================================================
// 基础类型
// ============================================================

/** Crash 事件类型 */
export type CrashEventType = 'native_crash' | 'renderer_crash' | 'js_exception';

/** 进程类型 */
export type CrashProcessType = 'main' | 'renderer';

/** Crash 原因类型 (Electron Details.reason) */
export type CrashReason = 'clean-exit' | 'abnormal-exit' | 'killed' | 'crashed' | 'oom' | 'launch-failed' | 'integrity-failure';

/** 环境 */
export type CrashEnvironment = 'development' | 'production';

// ============================================================
// 面包屑类型
// ============================================================

/** 面包屑分类 */
export type BreadcrumbCategory = 'conversation' | 'api' | 'mcp' | 'file' | 'window' | 'navigation' | 'user' | 'system';

/** 面包屑记录 */
export interface Breadcrumb {
  /** 时间戳 (毫秒) */
  timestamp: number;
  /** 分类 */
  category: BreadcrumbCategory | string;
  /** 消息 */
  message: string;
  /** 额外数据 */
  data?: Record<string, unknown>;
  /** 日志级别 */
  level?: 'debug' | 'info' | 'warning' | 'error';
}

// ============================================================
// Crash 上下文
// ============================================================

/** Crash 上下文 */
export interface CrashContext {
  /** 出错组件 */
  component?: string;
  /** 正在执行的操作 */
  operation?: string;
  /** 关联会话 ID */
  session_id?: string;
  /** 面包屑追踪 */
  breadcrumbs?: Breadcrumb[];
  /** 其他上下文信息 */
  [key: string]: unknown;
}

// ============================================================
// Crash 事件结构
// ============================================================

/** Crash 事件基础结构 */
export interface CrashEventBase {
  /** 事件类型 */
  type: CrashEventType;
  /** 时间戳 (毫秒) */
  timestamp: number;
  /** 客户端版本 */
  version: string;
  /** 平台 */
  platform: TelemetryPlatform;
  /** 架构 */
  arch: TelemetryArch;
  /** 进程类型 */
  process_type: CrashProcessType;
  /** 版本号 */
  release?: string;
  /** 环境 */
  environment?: CrashEnvironment;
}

/** 原生 Crash 事件 */
export interface NativeCrashEvent extends CrashEventBase {
  type: 'native_crash';
  /** Crash 原因 */
  crash_reason: CrashReason | string;
  /** 退出码 */
  exit_code?: number;
  /** 信号 */
  signal?: string;
  /** 上下文 */
  context?: CrashContext;
}

/** 渲染进程 Crash 事件 */
export interface RendererCrashEvent extends CrashEventBase {
  type: 'renderer_crash';
  /** Crash 原因 */
  crash_reason: CrashReason | string;
  /** 退出码 */
  exit_code?: number;
  /** 信号 */
  signal?: string;
  /** 上下文 */
  context?: CrashContext;
}

/** JS 异常事件 */
export interface JsExceptionEvent extends CrashEventBase {
  type: 'js_exception';
  /** Error 类型名 */
  error_name: string;
  /** 错误消息 */
  error_message: string;
  /** 堆栈信息 */
  stack_trace?: string;
  /** 上下文 */
  context?: CrashContext;
}

/** Crash 事件联合类型 */
export type CrashEvent = NativeCrashEvent | RendererCrashEvent | JsExceptionEvent;

// ============================================================
// 批量上报结构
// ============================================================

/** 批量上报请求 */
export interface CrashBatchRequest {
  events: CrashEvent[];
}

/** 批量上报响应 */
export interface CrashBatchResponse {
  success: boolean;
  received: number;
  message?: string;
  error?: string;
}

// ============================================================
// IPC 数据结构
// ============================================================

/** IPC 上报异常数据 */
export interface CrashExceptionData {
  error_name: string;
  error_message: string;
  stack_trace?: string;
  process_type: 'renderer';
  context?: CrashContext;
}

/** IPC 面包屑数据 */
export interface CrashBreadcrumbData {
  category: string;
  message: string;
  data?: Record<string, unknown>;
  level?: 'debug' | 'info' | 'warning' | 'error';
}

/** Crash Reporter 状态 */
export interface CrashReporterStatus {
  enabled: boolean;
  queueSize: number;
  breadcrumbCount: number;
  isFlushing: boolean;
}

// ============================================================
// 存储结构 (用于离线缓存)
// ============================================================

/** 存储的 Crash 事件 */
export interface StoredCrashEvent {
  /** 本地存储 ID */
  id: string;
  /** 存储时间 */
  storedAt: number;
  /** 重试次数 */
  retryCount: number;
  /** 事件数据 */
  event: CrashEvent;
}

// ============================================================
// 配置
// ============================================================

/** CrashReporter 配置 */
export interface CrashReporterConfig {
  enabled: boolean;
  serverUrl?: string;
  batchSize: number;
  flushInterval: number;
  maxRetries: number;
  maxBreadcrumbs: number;
}

/** 默认 CrashReporter 配置 */
export const DEFAULT_CRASH_REPORTER_CONFIG: CrashReporterConfig = {
  enabled: true,
  serverUrl: 'https://sudowork-qms.sudoprivacy.com/api/v1/crash/events/batch',
  batchSize: 20,
  flushInterval: 60000, // 60 秒
  maxRetries: 3,
  maxBreadcrumbs: 50,
};

// ============================================================
// 类型导入 (复用 telemetry 平台/架构类型)
// ============================================================

import type { TelemetryPlatform, TelemetryArch } from './telemetry';
