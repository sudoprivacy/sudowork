/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CrashReporter - Crash/异常上报器
 *
 * 功能:
 * - 原生 Crash 捕获 (主进程/渲染进程)
 * - JS 异常捕获 (uncaughtException, unhandledRejection)
 * - 面包屑追踪
 * - 批量上报到 sudowork-qms
 * - 离线缓存支持
 */

import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isProductImprovementEnabled } from '@/common/systemConfig';
import { ProcessConfig, getSudoworkServerBaseUrlSync } from '../initStorage';
import { buildVersion } from '@common/buildInfo';
import type { NativeCrashEvent, RendererCrashEvent, JsExceptionEvent, Breadcrumb, CrashContext, CrashEventBase, CrashBatchRequest, CrashBatchResponse, StoredCrashEvent, CrashReporterConfig, CrashProcessType, CrashReason } from '../../shared/types/crash';
import { DEFAULT_CRASH_REPORTER_CONFIG } from '../../shared/types/crash';
import { mapElectronArch } from '../../shared/types/telemetry';
import { mainLog, mainWarn, mainError } from '../utils/mainLogger';
import { getProductImprovementApiKey } from '../credentialsCache';
import { getTelemetryEncryptor, initTelemetryEncryptor } from './TelemetryEncryptor';
import { getUserContextSync } from './UserContext';
import { ENCRYPTION_CONFIG } from './keys';
import { getSudoLogTelemetryReporter } from './SudoLogTelemetryReporter';

// ============================================================
// 常量定义
// ============================================================

/** 本地存储文件名 */
const STORAGE_FILE_NAME = 'crash-cache.json';

/** 事件队列最大长度 */
const MAX_QUEUE_SIZE = 100;

/** 存储事件最大年龄 (毫秒) - 超过此时间的事件将被丢弃 */
const MAX_EVENT_AGE = 7 * 24 * 60 * 60 * 1000; // 7 天

const isPersonalMode = (): boolean => getUserContextSync().login_mode === 'personal';

function getPersonalCrashUserFields(): Pick<CrashEventBase, 'org_id' | 'user_id' | 'tenant_id' | 'login_mode' | 'user_nickname' | 'user_phone'> | null {
  const userContext = getUserContextSync();
  if (userContext.login_mode !== 'personal') {
    return null;
  }

  const userId = userContext.user_id;
  const tenantId = userContext.tenant_id;
  if (!userId) {
    mainWarn('CrashReporter', 'User ID not resolved in personal mode, skipping crash event');
    return null;
  }
  if (!tenantId) {
    mainWarn('CrashReporter', 'Tenant ID not resolved in personal mode, skipping crash event');
    return null;
  }

  return {
    org_id: userContext.org_id,
    user_id: userId,
    tenant_id: tenantId,
    login_mode: userContext.login_mode,
    user_nickname: userContext.user_nickname,
    user_phone: userContext.user_phone,
  };
}

function isReportableCrashEvent(event: StoredCrashEvent): boolean {
  return Boolean(event.event.user_id && event.event.tenant_id);
}

// ============================================================
// CrashReporter 类
// ============================================================

/**
 * Crash 上报器
 *
 * 单例模式，管理所有 Crash/异常事件的收集和上报
 *
 * 注意：由于全局异常处理器在应用启动早期注册，
 * Crash/异常可能在 CrashReporter 初始化前触发，
 * 因此采用缓存机制，初始化后再上报。
 */
export class CrashReporter {
  private static instance: CrashReporter | null = null;

  private config: CrashReporterConfig;
  private eventQueue: StoredCrashEvent[] = [];
  private breadcrumbs: Breadcrumb[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private initialized = false;
  private enabled = false;

  /** 缓存的 Crash 事件（等待初始化后上报） */
  private cachedEvents: StoredCrashEvent[] = [];

  /** 私有构造函数 */
  private constructor() {
    this.config = DEFAULT_CRASH_REPORTER_CONFIG;
  }

  /** 获取单例实例 */
  public static getInstance(): CrashReporter {
    if (!CrashReporter.instance) {
      CrashReporter.instance = new CrashReporter();
    }
    return CrashReporter.instance;
  }

  /**
   * 初始化 CrashReporter
   *
   * 必须在 app.whenReady() 之后调用
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      mainWarn('CrashReporter', 'Already initialized, skipping');
      return;
    }

    if (!isPersonalMode()) {
      this.enabled = false;
      this.initialized = true;
      this.eventQueue = [];
      this.cachedEvents = [];
      this.breadcrumbs = [];
      await this.clearCacheFile();
      mainLog('CrashReporter', 'Crash reporting disabled outside personal mode');
      return;
    }

    // 检查遥测授权状态 (Crash 上报与遥测共享授权)
    const telemetryEnabled = await ProcessConfig.get('telemetry.enabled').catch(() => undefined as unknown as boolean | undefined);
    this.enabled = telemetryEnabled ?? true; // 默认启用

    if (!this.enabled) {
      mainLog('CrashReporter', 'Crash reporting disabled by user configuration');
      this.initialized = true;
      return;
    }

    // 获取自定义服务器地址 (可选)
    const customServerUrl = await ProcessConfig.get('telemetry.serverUrl').catch(() => undefined as unknown as string | undefined);
    if (customServerUrl) {
      // 将 telemetry 地址转换为 crash 地址
      this.config = {
        ...DEFAULT_CRASH_REPORTER_CONFIG,
        serverUrl: customServerUrl.replace('/telemetry/batch', '/crash/events/batch'),
      };
    } else {
      this.config = {
        ...DEFAULT_CRASH_REPORTER_CONFIG,
        serverUrl: `${getSudoworkServerBaseUrlSync()}/api/v1/crash/events/batch`,
      };
    }

    // 加载离线缓存
    await this.loadCachedEvents();

    // 检查加密状态 (加密器在 Telemetry 模块初始化时已初始化)
    if (ENCRYPTION_CONFIG.enabled) {
      try {
        // 确保 encryptor 已初始化
        await initTelemetryEncryptor();
        if (getTelemetryEncryptor().isEnabled()) {
          mainLog('CrashReporter', 'Encryption enabled (hybrid-v1)');
        }
      } catch (error) {
        mainWarn('CrashReporter', 'Encryptor not available, fallback to plaintext');
      }
    }

    // 启动定时上报
    this.startFlushTimer();

    this.initialized = true;
    mainLog('CrashReporter', `Initialized, server: ${this.config.serverUrl}, queue: ${this.eventQueue.length}`);

    // 上报缓存的事件（启动过程中捕获的 crash/异常）
    this.flushCachedEvents();
  }

  /**
   * 捕获原生 Crash
   *
   * @param details - Electron Details 对象
   * @param processType - 进程类型
   */
  public captureNativeCrash(details: { reason: string; exitCode?: number; signal?: string | number }, processType: CrashProcessType): void {
    // 开发环境不上报
    if (!app.isPackaged) {
      return;
    }

    const crashReason = details.reason as CrashReason | string;

    // 忽略正常退出
    if (crashReason === 'clean-exit' || crashReason === 'killed') {
      return;
    }

    const userFields = getPersonalCrashUserFields();
    if (!userFields) {
      return;
    }

    const event: NativeCrashEvent = {
      type: 'native_crash',
      timestamp: Date.now(),
      version: buildVersion,
      platform: process.platform as 'darwin' | 'win32',
      arch: mapElectronArch(process.arch),
      ...userFields,
      process_type: processType,
      crash_reason: crashReason,
      exit_code: details.exitCode,
      signal: details.signal?.toString(),
      context: {
        breadcrumbs: this.getBreadcrumbsSnapshot(),
      },
      release: buildVersion,
      environment: 'production',
    };

    const storedEvent: StoredCrashEvent = {
      id: this.generateEventId(),
      storedAt: Date.now(),
      retryCount: 0,
      event,
    };

    // 缓存事件（如果未初始化）或直接添加到队列
    this.cacheOrAddEvent(storedEvent);
    getSudoLogTelemetryReporter().enqueueCrashEvent(event);
    mainError('CrashReporter', `Native crash captured: ${crashReason} (process: ${processType})`);
  }

  /**
   * 捕获渲染进程 Crash
   *
   * @param details - Electron RenderProcessGoneDetails 对象
   */
  public captureRendererCrash(details: Electron.RenderProcessGoneDetails): void {
    // 开发环境不上报
    if (!app.isPackaged) {
      return;
    }

    const crashReason = details.reason as CrashReason | string;

    // 忽略正常退出
    if (crashReason === 'clean-exit' || crashReason === 'killed') {
      return;
    }

    const userFields = getPersonalCrashUserFields();
    if (!userFields) {
      return;
    }

    const event: RendererCrashEvent = {
      type: 'renderer_crash',
      timestamp: Date.now(),
      version: buildVersion,
      platform: process.platform as 'darwin' | 'win32',
      arch: mapElectronArch(process.arch),
      ...userFields,
      process_type: 'renderer',
      crash_reason: crashReason,
      exit_code: details.exitCode,
      context: {
        breadcrumbs: this.getBreadcrumbsSnapshot(),
      },
      release: buildVersion,
      environment: 'production',
    };

    const storedEvent: StoredCrashEvent = {
      id: this.generateEventId(),
      storedAt: Date.now(),
      retryCount: 0,
      event,
    };

    // 缓存事件（如果未初始化）或直接添加到队列
    this.cacheOrAddEvent(storedEvent);
    getSudoLogTelemetryReporter().enqueueCrashEvent(event);
    mainError('CrashReporter', `Renderer crash captured: ${crashReason}`);
  }

  /**
   * 捕获 JS 异常
   *
   * @param error - Error 对象
   * @param context - 额外上下文
   */
  public captureException(error: Error, context?: Partial<CrashContext>): void {
    // 开发环境不上报
    if (!app.isPackaged) {
      return;
    }

    const userFields = getPersonalCrashUserFields();
    if (!userFields) {
      return;
    }

    const event: JsExceptionEvent = {
      type: 'js_exception',
      timestamp: Date.now(),
      version: buildVersion,
      platform: process.platform as 'darwin' | 'win32',
      arch: mapElectronArch(process.arch),
      ...userFields,
      process_type: (context?.process_type as CrashProcessType) || 'main',
      error_name: error.name,
      error_message: error.message,
      stack_trace: error.stack,
      context: {
        ...context,
        breadcrumbs: this.getBreadcrumbsSnapshot(),
      },
      release: buildVersion,
      environment: 'production',
    };

    const storedEvent: StoredCrashEvent = {
      id: this.generateEventId(),
      storedAt: Date.now(),
      retryCount: 0,
      event,
    };

    // 缓存事件（如果未初始化）或直接添加到队列
    this.cacheOrAddEvent(storedEvent);
    getSudoLogTelemetryReporter().enqueueCrashEvent(event);
    mainError('CrashReporter', `Exception captured: ${error.name}: ${error.message}`);
  }

  /**
   * 捕获渲染进程 JS 异常 (通过 IPC)
   *
   * @param data - IPC 上报数据
   */
  public captureRendererException(data: { error_name: string; error_message: string; stack_trace?: string; context?: CrashContext }): void {
    // 开发环境不上报
    if (!app.isPackaged) {
      return;
    }

    const userFields = getPersonalCrashUserFields();
    if (!userFields) {
      return;
    }

    const event: JsExceptionEvent = {
      type: 'js_exception',
      timestamp: Date.now(),
      version: buildVersion,
      platform: process.platform as 'darwin' | 'win32',
      arch: mapElectronArch(process.arch),
      ...userFields,
      process_type: 'renderer',
      error_name: data.error_name,
      error_message: data.error_message,
      stack_trace: data.stack_trace,
      context: {
        ...data.context,
        breadcrumbs: this.getBreadcrumbsSnapshot(),
      },
      release: buildVersion,
      environment: 'production',
    };

    const storedEvent: StoredCrashEvent = {
      id: this.generateEventId(),
      storedAt: Date.now(),
      retryCount: 0,
      event,
    };

    // 缓存事件（如果未初始化）或直接添加到队列
    this.cacheOrAddEvent(storedEvent);
    getSudoLogTelemetryReporter().enqueueCrashEvent(event);
    mainError('CrashReporter', `Renderer exception captured: ${data.error_name}: ${data.error_message}`);
  }

  /**
   * 添加面包屑
   *
   * @param category - 分类
   * @param message - 消息
   * @param data - 额外数据
   * @param level - 日志级别
   */
  public addBreadcrumb(category: string, message: string, data?: Record<string, unknown>, level?: 'debug' | 'info' | 'warning' | 'error'): void {
    if (!isPersonalMode() || !this.enabled) {
      return;
    }

    const breadcrumb: Breadcrumb = {
      timestamp: Date.now(),
      category,
      message,
      data,
      level,
    };

    this.breadcrumbs.push(breadcrumb);

    // 限制面包屑数量
    if (this.breadcrumbs.length > this.config.maxBreadcrumbs) {
      this.breadcrumbs.shift();
    }
  }

  /**
   * 清空面包屑
   */
  public clearBreadcrumbs(): void {
    this.breadcrumbs = [];
  }

  /**
   * 立即上报所有事件
   *
   * 用于应用退出前上报剩余事件
   */
  public async flushAll(): Promise<void> {
    if (!isPersonalMode() || !isProductImprovementEnabled()) {
      this.eventQueue = [];
      this.cachedEvents = [];
      this.breadcrumbs = [];
      await this.clearCacheFile();
      return;
    }

    await this.dropUnreportableQueuedEvents();

    if (this.eventQueue.length === 0) {
      return;
    }

    await this.flush();
  }

  /**
   * 更新启用状态
   */
  public async setEnabled(enabled: boolean): Promise<void> {
    if (!isPersonalMode()) {
      this.enabled = false;
      this.stopFlushTimer();
      this.eventQueue = [];
      this.cachedEvents = [];
      this.breadcrumbs = [];
      await this.clearCacheFile();
      mainLog('CrashReporter', 'Crash reporting remains disabled outside personal mode');
      return;
    }

    this.enabled = enabled;

    if (enabled && !this.flushTimer) {
      this.startFlushTimer();
    } else if (!enabled && this.flushTimer) {
      this.stopFlushTimer();
      // 禁用时清空队列但不上报
      this.eventQueue = [];
      this.breadcrumbs = [];
      await this.clearCacheFile();
    }

    mainLog('CrashReporter', `Enabled state changed to: ${enabled}`);
  }

  /**
   * 获取当前状态
   */
  public getStatus(): {
    enabled: boolean;
    queueSize: number;
    breadcrumbCount: number;
    isFlushing: boolean;
  } {
    return {
      enabled: this.enabled,
      queueSize: this.eventQueue.length,
      breadcrumbCount: this.breadcrumbs.length,
      isFlushing: this.isFlushing,
    };
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /** 生成事件 ID */
  private generateEventId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /** 获取面包屑快照 */
  private getBreadcrumbsSnapshot(): Breadcrumb[] {
    return [...this.breadcrumbs];
  }

  /**
   * 缓存或添加事件
   *
   * 如果 CrashReporter 已初始化且启用，直接添加到队列
   * 否则缓存事件，等待初始化后上报
   */
  private cacheOrAddEvent(event: StoredCrashEvent): void {
    if (!isPersonalMode() || !isProductImprovementEnabled()) {
      this.cachedEvents = [];
      return;
    }

    if (!isReportableCrashEvent(event)) {
      mainWarn('CrashReporter', 'Crash event missing user_id or tenant_id, dropping event');
      return;
    }

    if (this.initialized && this.enabled) {
      // 已初始化，直接添加到队列
      this.addToQueue(event);

      // Crash 事件优先上报
      void this.flush();
    } else {
      // 未初始化，缓存事件
      this.cachedEvents.push(event);
    }
  }

  /**
   * 上报缓存的事件
   *
   * 在初始化后调用，将缓存的事件添加到队列
   */
  private flushCachedEvents(): void {
    if (!isPersonalMode()) {
      this.cachedEvents = [];
      return;
    }

    if (this.cachedEvents.length === 0) {
      return;
    }

    const validCachedEvents = this.cachedEvents.filter(isReportableCrashEvent);
    const droppedCount = this.cachedEvents.length - validCachedEvents.length;
    if (droppedCount > 0) {
      mainWarn('CrashReporter', `Dropped ${droppedCount} cached crash event(s) without user_id/tenant_id`);
    }

    for (const event of validCachedEvents) {
      if (this.enabled) {
        this.addToQueue(event);
      }
    }

    this.cachedEvents = [];

    // 立即上报缓存的事件
    if (this.eventQueue.length > 0) {
      void this.flush();
    }
  }

  /** 添加事件到队列 */
  private addToQueue(event: StoredCrashEvent): void {
    if (!isReportableCrashEvent(event)) {
      mainWarn('CrashReporter', 'Crash event missing user_id or tenant_id, dropping event');
      return;
    }

    // 队列满时移除最老的事件
    if (this.eventQueue.length >= MAX_QUEUE_SIZE) {
      this.eventQueue.shift();
    }

    this.eventQueue.push(event);

    // 持久化到本地
    void this.persistToCache();
  }

  /** 启动定时上报 */
  private startFlushTimer(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.config.flushInterval);
  }

  /** 停止定时上报 */
  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /** 执行批量上报 */
  private async flush(): Promise<void> {
    if (!isPersonalMode() || !isProductImprovementEnabled()) {
      this.eventQueue = [];
      this.cachedEvents = [];
      this.breadcrumbs = [];
      await this.clearCacheFile();
      return;
    }

    if (this.isFlushing) {
      return;
    }

    await this.dropUnreportableQueuedEvents();
    if (this.eventQueue.length === 0) {
      return;
    }

    this.isFlushing = true;

    try {
      // 取出一批事件
      const batch = this.eventQueue.slice(0, this.config.batchSize);
      const events = batch.map((stored) => stored.event);

      const request: CrashBatchRequest = { events };

      // 发送请求
      const response = await this.sendBatch(request);

      if (response.success) {
        // 成功时移除已上报的事件
        this.eventQueue = this.eventQueue.slice(batch.length);
        const flushedCount = response.received ?? batch.length;
        mainLog('CrashReporter', `Flushed ${flushedCount} events, remaining: ${this.eventQueue.length}`);

        // 清理缓存文件
        if (this.eventQueue.length === 0) {
          await this.clearCacheFile();
        } else {
          await this.persistToCache();
        }
      } else {
        // 失败时增加重试计数
        batch.forEach((event) => {
          event.retryCount++;
        });

        // 超过最大重试次数的事件将被丢弃
        this.eventQueue = this.eventQueue.filter((event) => event.retryCount < this.config.maxRetries && Date.now() - event.storedAt < MAX_EVENT_AGE);

        mainWarn('CrashReporter', `Flush failed: ${response.error}, retries pending: ${this.eventQueue.length}`);
      }
    } catch (error) {
      mainError('CrashReporter', 'Flush error:', error);
    } finally {
      this.isFlushing = false;
    }
  }

  /** 发送批量请求 */
  private async sendBatch(request: CrashBatchRequest): Promise<CrashBatchResponse> {
    // 现读：用户自定义 telemetry.serverUrl 优先（转换 /telemetry/batch → /crash/events/batch）；
    // 否则用现读的 sudowork-server baseUrl 派生 crash 上报地址
    const customServerUrl = await ProcessConfig.get('telemetry.serverUrl').catch(() => undefined as unknown as string | undefined);
    const url = customServerUrl ? customServerUrl.replace('/telemetry/batch', '/crash/events/batch') : `${getSudoworkServerBaseUrlSync()}/api/v1/crash/events/batch`;
    const encryptor = getTelemetryEncryptor();

    try {
      const apiKey = getProductImprovementApiKey();
      if (!apiKey) {
        // D8: product_improvement api_key not provisioned — skip upload.
        mainError('CrashReporter', 'product_improvement api_key not provisioned, skip sendBatch');
        return { success: false, received: 0, error: 'product_improvement api_key missing' };
      }
      // 构建请求体
      let body: string;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      };

      // 如果加密器可用，使用加密请求
      if (encryptor.isEnabled()) {
        const encryptedPayload = encryptor.encrypt(request);
        if (encryptedPayload) {
          body = JSON.stringify(encryptedPayload);
          headers['X-Encryption'] = 'hybrid-v1';
        } else {
          // 加密失败，降级为明文上报
          body = JSON.stringify(request);
          mainWarn('CrashReporter', 'Encryption failed, fallback to plaintext');
        }
      } else {
        // 未启用加密，明文上报
        body = JSON.stringify(request);
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
      });

      if (!response.ok) {
        return {
          success: false,
          received: 0,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const data = await response.json();
      return data as CrashBatchResponse;
    } catch (error) {
      return {
        success: false,
        received: 0,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  /** 持久化到本地缓存 */
  private async persistToCache(): Promise<void> {
    try {
      const userDataPath = app.getPath('userData');
      const cachePath = path.join(userDataPath, STORAGE_FILE_NAME);

      await fs.writeFile(cachePath, JSON.stringify(this.eventQueue), 'utf-8');
    } catch (error) {
      // 忽略缓存写入错误
    }
  }

  /** 加载离线缓存 */
  private async loadCachedEvents(): Promise<void> {
    try {
      const userDataPath = app.getPath('userData');
      const cachePath = path.join(userDataPath, STORAGE_FILE_NAME);

      const exists = await fs
        .stat(cachePath)
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        return;
      }

      const content = await fs.readFile(cachePath, 'utf-8');
      const cachedEvents: StoredCrashEvent[] = JSON.parse(content);

      // 过滤过期事件和缺少 user_id 的旧缓存事件
      const validEvents = cachedEvents.filter((event) => isReportableCrashEvent(event) && Date.now() - event.storedAt < MAX_EVENT_AGE && event.retryCount < this.config.maxRetries);

      this.eventQueue = validEvents;
      const droppedCount = cachedEvents.length - validEvents.length;
      if (droppedCount > 0) {
        mainWarn('CrashReporter', `Dropped ${droppedCount} cached crash event(s) without user_id/tenant_id or past retry/age limits`);
        if (validEvents.length === 0) {
          await this.clearCacheFile();
        } else {
          await this.persistToCache();
        }
      }

      mainLog('CrashReporter', `Loaded ${validEvents.length} cached events`);
    } catch (error) {
      // 忽略缓存加载错误
      mainWarn('CrashReporter', 'Failed to load cache:', error);
    }
  }

  /** 清理缓存文件 */
  private async clearCacheFile(): Promise<void> {
    try {
      const userDataPath = app.getPath('userData');
      const cachePath = path.join(userDataPath, STORAGE_FILE_NAME);

      await fs.unlink(cachePath).catch(() => {});
    } catch (error) {
      // 忽略删除错误
    }
  }

  /** 丢弃队列中没有 user_id 的事件，确保不会上报匿名 crash */
  private async dropUnreportableQueuedEvents(): Promise<void> {
    const originalLength = this.eventQueue.length;
    this.eventQueue = this.eventQueue.filter(isReportableCrashEvent);
    const droppedCount = originalLength - this.eventQueue.length;
    if (droppedCount === 0) {
      return;
    }

    mainWarn('CrashReporter', `Dropped ${droppedCount} queued crash event(s) without user_id/tenant_id`);
    if (this.eventQueue.length === 0) {
      await this.clearCacheFile();
    } else {
      await this.persistToCache();
    }
  }
}

// ============================================================
// 导出便捷方法
// ============================================================

/** 获取 CrashReporter 实例 */
export const getCrashReporter = (): CrashReporter => {
  return CrashReporter.getInstance();
};

/** 初始化 CrashReporter */
export const initCrashReporter = async (): Promise<void> => {
  await getCrashReporter().initialize();
};

/** 捕获原生 Crash */
export const captureNativeCrash = (details: { reason: string; exitCode?: number; signal?: string | number }, processType: CrashProcessType): void => {
  getCrashReporter().captureNativeCrash(details, processType);
};

/** 捕获渲染进程 Crash */
export const captureRendererCrash = (details: Electron.RenderProcessGoneDetails): void => {
  getCrashReporter().captureRendererCrash(details);
};

/** 捕获 JS 异常 */
export const captureException = (error: Error, context?: Partial<CrashContext>): void => {
  getCrashReporter().captureException(error, context);
};

/** 添加面包屑 */
export const addCrashBreadcrumb = (category: string, message: string, data?: Record<string, unknown>, level?: 'debug' | 'info' | 'warning' | 'error'): void => {
  getCrashReporter().addBreadcrumb(category, message, data, level);
};

/** 立即上报所有事件 */
export const flushCrashReporter = async (): Promise<void> => {
  await getCrashReporter().flushAll();
};
