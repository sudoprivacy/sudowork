/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Telemetry Module Entry - 遥测模块入口
 *
 * 导出所有遥测相关模块和便捷方法
 */

// ============================================================
// 内部导入 (用于 initializeTelemetry/shutdownTelemetry)
// ============================================================

import { getTelemetryReporter } from './TelemetryBatchReporter';
import { markAppStart } from './PerfTracker';
import { initInstallTracking, markInstallSuccess } from './InstallTracker';
import { flushTelemetry } from './TelemetryBatchReporter';

// ============================================================
// 类型导出
// ============================================================

export type {
  TelemetryPlatform,
  TelemetryArch,
  TelemetryEventType,
  PerfMetricType,
  ConversationStatus,
  TurnStatus,
  StepStatus,
  StepType,
  InstallStatus,
  InstallType,
  ModelProvider,
  AgentType,
  LoginMode,
  TelemetryErrorCode,
  PerfData,
  ConversationData,
  TurnData,
  StepData,
  InstallData,
  TelemetryEventBase,
  PerfTelemetryEvent,
  ConversationTelemetryEvent,
  TurnTelemetryEvent,
  StepTelemetryEvent,
  InstallTelemetryEvent,
  TelemetryEvent,
  TelemetryBatchRequest,
  TelemetryBatchResponse,
  TelemetryConfig,
  StoredTelemetryEvent,
} from '../../shared/types/telemetry';

export { DEFAULT_TELEMETRY_CONFIG, ERROR_CODE_DESCRIPTION, mapElectronArch } from '../../shared/types/telemetry';

// ============================================================
// 模块导出
// ============================================================

export { TelemetryBatchReporter, getTelemetryReporter, initTelemetry, recordTelemetry, flushTelemetry } from './TelemetryBatchReporter';

export { PerfTracker, getPerfTracker, markAppStart, markFirstWindowShow, markRendererReady, startPerfTiming, endPerfTiming, recordFirstToken, flushPerfCachedMetrics, PERF_METRICS } from './PerfTracker';

export { ConversationTracker, getConversationTracker, startConversationTracking, updateConversationTokens, endConversationSuccess, endConversationError, endConversationUserCancel } from './ConversationTracker';

export { InstallTracker, getInstallTracker, initInstallTracking, markInstallSuccess, markInstallFailed, getInstallId, getInstallType } from './InstallTracker';

// ============================================================
// 统一初始化方法
// ============================================================

import { initTelemetryEncryptor } from './TelemetryEncryptor';
import { getPerfTracker } from './PerfTracker';

/**
 * 初始化所有遥测模块
 *
 * 在 app.whenReady() 之后调用
 */
export async function initializeTelemetry(): Promise<void> {
  // 初始化加密器 (如果公钥可用)
  await initTelemetryEncryptor();

  // 初始化批量上报器
  await getTelemetryReporter().initialize();

  // 初始化安装追踪器
  await initInstallTracking();

  // 上报缓存的性能指标（启动过程中缓存的 cold_start/first_screen）
  getPerfTracker().flushCachedMetrics();
}

/**
 * 应用退出时上报剩余事件
 *
 * 在 app.before-quit 中调用
 */
export async function shutdownTelemetry(): Promise<void> {
  // 标记安装成功 (如果还没标记)
  await markInstallSuccess();

  // 上报剩余遥测事件
  await flushTelemetry();

  // 上报剩余 crash 事件
  const { flushCrashReporter } = await import('./CrashReporter');
  await flushCrashReporter();
}

// ============================================================
// 加密器导出
// ============================================================

export { TelemetryEncryptor, getTelemetryEncryptor, initTelemetryEncryptor, encryptTelemetryPayload, isEncryptionAvailable } from './TelemetryEncryptor';

export type { EncryptedPayload } from './TelemetryEncryptor';

export { TELEMETRY_PUBLIC_KEY_PEM, ENCRYPTION_CONFIG, DEFAULT_ENCRYPTION_OPTIONS } from './keys';

export type { TelemetryEncryptionOptions } from './keys';

// ============================================================
// CrashReporter 导出
// ============================================================

export { CrashReporter, getCrashReporter, initCrashReporter, captureNativeCrash, captureRendererCrash, captureException, addCrashBreadcrumb, flushCrashReporter } from './CrashReporter';

export { breadcrumbTracker, conversationBreadcrumbs, apiBreadcrumbs, mcpBreadcrumbs, fileBreadcrumbs, windowBreadcrumbs, userBreadcrumbs, systemBreadcrumbs, trackBreadcrumb } from './BreadcrumbTracker';

// ============================================================
// UserContext 导出
// ============================================================

export { getUserContext, getUserContextSync, hasUserContext } from './UserContext';

export type { UserContext } from './UserContext';

// ============================================================
// TurnTracker 导出
// ============================================================

export { TurnTracker, getTurnTracker, startTurnTracking, updateTurnTokens, endTurnSuccess, endTurnError, getCurrentTurnId } from './TurnTracker';

// ============================================================
// StepTracker 导出
// ============================================================

export { StepTracker, getStepTracker, startToolCallTracking, endToolCallTracking, startPermissionRequestTracking, endPermissionRequestTracking, recordFileOperationStep, startThinkingTracking, endThinkingTracking } from './StepTracker';
