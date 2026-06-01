/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Telemetry Batch Reporter - 批量上报器
 *
 * 功能：
 * - 事件队列管理
 * - 定时批量上报
 * - 离线缓存支持
 * - 失败重试机制
 */

import { app } from 'electron';
import { ProcessConfig } from '../initStorage';
import { buildVersion } from '../../common/buildInfo';
import { TelemetryEvent, TelemetryBatchRequest, TelemetryBatchResponse, TelemetryConfig, StoredTelemetryEvent, PerfTelemetryEvent, ConversationTelemetryEvent, InstallTelemetryEvent, TurnTelemetryEvent, StepTelemetryEvent, PerfData, ConversationData, InstallData, TurnData, StepData, mapElectronArch } from '../../shared/types/telemetry';
import { DEFAULT_TELEMETRY_CONFIG } from '../../shared/types/telemetry';
import { mainLog, mainWarn, mainError } from '../utils/mainLogger';
import { getTelemetryEncryptor, initTelemetryEncryptor, isEncryptionAvailable, EncryptedPayload } from './TelemetryEncryptor';
import { ENCRYPTION_CONFIG } from './keys';
import { getUserContextSync } from './UserContext';

// ============================================================
// 类型定义
// ============================================================

type TelemetryEventType = 'perf' | 'conversation' | 'install' | 'turn' | 'step';

interface TelemetryEventPayloadMap {
  perf: import('../../shared/types/telemetry').PerfData;
  conversation: import('../../shared/types/telemetry').ConversationData;
  install: import('../../shared/types/telemetry').InstallData;
  turn: import('../../shared/types/telemetry').TurnData;
  step: import('../../shared/types/telemetry').StepData;
}

// ============================================================
// 常量定义
// ============================================================

/** sudowork-qms API Key - 用于认证上报请求 */
const API_KEY = 'sk-8f3a2b1c9d5e7f6a4b3c2d1e8f9a0b7c';

/** 本地存储文件名 */
const STORAGE_FILE_NAME = 'telemetry-cache.json';

/** 事件队列最大长度 */
const MAX_QUEUE_SIZE = 500;

/** 存储事件最大年龄 (毫秒) - 超过此时间的事件将被丢弃 */
const MAX_EVENT_AGE = 7 * 24 * 60 * 60 * 1000; // 7 天

const isPersonalMode = (): boolean => getUserContextSync().login_mode === 'personal';

// ============================================================
// TelemetryBatchReporter 类
// ============================================================

/**
 * 遥测批量上报器
 *
 * 单例模式，管理所有遥测事件的收集和上报
 */
export class TelemetryBatchReporter {
  private static instance: TelemetryBatchReporter | null = null;

  private config: TelemetryConfig;
  private eventQueue: StoredTelemetryEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private initialized = false;
  private enabled = false;

  /** 私有构造函数 */
  private constructor() {
    this.config = DEFAULT_TELEMETRY_CONFIG;
  }

  /** 获取单例实例 */
  public static getInstance(): TelemetryBatchReporter {
    if (!TelemetryBatchReporter.instance) {
      TelemetryBatchReporter.instance = new TelemetryBatchReporter();
    }
    return TelemetryBatchReporter.instance;
  }

  /**
   * 初始化上报器
   *
   * 必须在 app.whenReady() 之后调用
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      mainWarn('Telemetry', 'Already initialized, skipping');
      return;
    }

    if (!isPersonalMode()) {
      this.enabled = false;
      this.initialized = true;
      this.eventQueue = [];
      await this.clearCacheFile();
      mainLog('Telemetry', 'Telemetry disabled outside personal mode');
      return;
    }

    // 检查用户授权状态
    const enabled = await ProcessConfig.get('telemetry.enabled').catch(() => undefined as unknown as boolean | undefined);
    this.enabled = enabled ?? true; // 默认启用

    if (!this.enabled) {
      mainLog('Telemetry', 'Telemetry disabled by user configuration');
      this.initialized = true;
      return;
    }

    // 获取自定义服务器地址 (可选)，否则使用默认地址
    const customServerUrl = await ProcessConfig.get('telemetry.serverUrl').catch(() => undefined as unknown as string | undefined);
    const serverUrl = customServerUrl || DEFAULT_TELEMETRY_CONFIG.serverUrl!;

    this.config = {
      ...DEFAULT_TELEMETRY_CONFIG,
      serverUrl,
    };

    // 加载离线缓存
    await this.loadCachedEvents();

    // 初始化加密器
    if (ENCRYPTION_CONFIG.enabled) {
      try {
        await initTelemetryEncryptor();
        if (isEncryptionAvailable()) {
          mainLog('Telemetry', 'Encryption enabled (hybrid-v1)');
        } else {
          mainLog('Telemetry', 'Encryption disabled (no valid public key)');
        }
      } catch (error) {
        mainWarn('Telemetry', 'Failed to initialize encryptor, fallback to plaintext:', error);
      }
    }

    // 启动定时上报
    this.startFlushTimer();

    this.initialized = true;
    mainLog('Telemetry', `Initialized, server: ${this.config.serverUrl}, queue: ${this.eventQueue.length}`);
  }

  /**
   * 记录遥测事件
   *
   * @param type - 事件类型
   * @param data - 事件数据
   * @param agentType - Agent 类型 (sudocode, claude 等)
   */
  public record<K extends TelemetryEventType>(type: K, data: TelemetryEventPayloadMap[K], agentType?: string): void {
    if (!isPersonalMode() || !this.enabled || !this.initialized) {
      return;
    }

    // 获取用户上下文
    const userContext = getUserContextSync();

    const storedEvent: StoredTelemetryEvent = {
      id: this.generateEventId(),
      storedAt: Date.now(),
      retryCount: 0,
      type,
      timestamp: Date.now(),
      version: buildVersion,
      platform: process.platform as 'darwin' | 'win32',
      arch: mapElectronArch(process.arch),
      org_id: userContext.org_id,
      user_id: userContext.user_id,
      tenant_id: userContext.tenant_id,
      login_mode: userContext.login_mode,
      agent_type: agentType,
      user_nickname: userContext.user_nickname,
      user_phone: userContext.user_phone,
      data,
    };

    // 添加到队列
    this.addToQueue(storedEvent);

    // 如果队列满了，立即上报
    if (this.eventQueue.length >= this.config.batchSize) {
      void this.flush();
    }
  }

  /**
   * 立即上报所有事件
   *
   * 用于应用退出前上报剩余事件
   */
  public async flushAll(): Promise<void> {
    if (!isPersonalMode()) {
      this.eventQueue = [];
      await this.clearCacheFile();
      return;
    }

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
      await this.clearCacheFile();
      await ProcessConfig.set('telemetry.enabled', false);
      mainLog('Telemetry', 'Telemetry remains disabled outside personal mode');
      return;
    }

    this.enabled = enabled;

    if (enabled && !this.flushTimer) {
      this.startFlushTimer();
    } else if (!enabled && this.flushTimer) {
      this.stopFlushTimer();
      // 禁用时清空队列但不上报
      this.eventQueue = [];
      await this.clearCacheFile();
    }

    mainLog('Telemetry', `Enabled state changed to: ${enabled}`);
  }

  /**
   * 获取当前队列状态
   */
  public getStatus(): {
    initialized: boolean;
    enabled: boolean;
    queueSize: number;
    isFlushing: boolean;
  } {
    return {
      initialized: this.initialized,
      enabled: this.enabled,
      queueSize: this.eventQueue.length,
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

  /** 添加事件到队列 */
  private addToQueue(event: StoredTelemetryEvent): void {
    // 队列满时移除最老的事件
    if (this.eventQueue.length >= MAX_QUEUE_SIZE) {
      this.eventQueue.shift();
    }

    this.eventQueue.push(event);

    // 持久化到本地 (用于离线缓存)
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
    if (!isPersonalMode()) {
      this.eventQueue = [];
      await this.clearCacheFile();
      return;
    }

    if (this.isFlushing || this.eventQueue.length === 0) {
      return;
    }

    this.isFlushing = true;

    try {
      // 取出一批事件
      const batch = this.eventQueue.slice(0, this.config.batchSize);
      // Convert stored events to TelemetryEvent format
      const events: TelemetryEvent[] = batch.map((stored): TelemetryEvent => {
        // 基础字段
        const baseEvent = {
          timestamp: stored.timestamp,
          version: stored.version,
          platform: stored.platform,
          arch: stored.arch,
          org_id: stored.org_id,
          user_id: stored.user_id,
          tenant_id: stored.tenant_id,
          login_mode: stored.login_mode,
          agent_type: stored.agent_type,
          user_nickname: stored.user_nickname,
          user_phone: stored.user_phone,
        };

        // Create specific event type based on stored.type
        if (stored.type === 'perf') {
          return {
            type: 'perf',
            ...baseEvent,
            data: stored.data as PerfData,
          } as PerfTelemetryEvent;
        } else if (stored.type === 'conversation') {
          return {
            type: 'conversation',
            ...baseEvent,
            data: stored.data as ConversationData,
          } as ConversationTelemetryEvent;
        } else if (stored.type === 'install') {
          return {
            type: 'install',
            ...baseEvent,
            data: stored.data as InstallData,
          } as InstallTelemetryEvent;
        } else if (stored.type === 'turn') {
          return {
            type: 'turn',
            ...baseEvent,
            data: stored.data as TurnData,
          } as TurnTelemetryEvent;
        } else {
          return {
            type: 'step',
            ...baseEvent,
            data: stored.data as StepData,
          } as StepTelemetryEvent;
        }
      });

      const request: TelemetryBatchRequest = { events };

      // 发送请求
      const response = await this.sendBatch(request);

      if (response.success) {
        // 成功时移除已上报的事件
        this.eventQueue = this.eventQueue.slice(batch.length);
        const flushedCount = response.received ?? batch.length;
        mainLog('Telemetry', `Flushed ${flushedCount} events, remaining: ${this.eventQueue.length}`);

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

        mainWarn('Telemetry', `Flush failed: ${response.error}, retries pending: ${this.eventQueue.length}`);
      }
    } catch (error) {
      mainError('Telemetry', 'Flush error:', error);
    } finally {
      this.isFlushing = false;
    }
  }

  /** 发送批量请求 */
  private async sendBatch(request: TelemetryBatchRequest): Promise<TelemetryBatchResponse> {
    const url = this.config.serverUrl!;
    const encryptor = getTelemetryEncryptor();

    try {
      let body: string;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
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
          mainWarn('Telemetry', 'Encryption failed, fallback to plaintext');
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
      return data as TelemetryBatchResponse;
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
      const { app } = require('electron');
      const fs = require('fs/promises');
      const path = require('path');

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
      const { app } = require('electron');
      const fs = require('fs/promises');
      const path = require('path');

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
      const cachedEvents: StoredTelemetryEvent[] = JSON.parse(content);

      // 过滤过期事件
      const validEvents = cachedEvents.filter((event) => Date.now() - event.storedAt < MAX_EVENT_AGE && event.retryCount < this.config.maxRetries);

      this.eventQueue = validEvents;

      mainLog('Telemetry', `Loaded ${validEvents.length} cached events`);
    } catch (error) {
      // 忽略缓存加载错误
      mainWarn('Telemetry', 'Failed to load cache:', error);
    }
  }

  /** 清理缓存文件 */
  private async clearCacheFile(): Promise<void> {
    try {
      const { app } = require('electron');
      const fs = require('fs/promises');
      const path = require('path');

      const userDataPath = app.getPath('userData');
      const cachePath = path.join(userDataPath, STORAGE_FILE_NAME);

      await fs.unlink(cachePath).catch(() => {});
    } catch (error) {
      // 忽略删除错误
    }
  }
}

// ============================================================
// 导出便捷方法
// ============================================================

/** 获取上报器实例 */
export const getTelemetryReporter = (): TelemetryBatchReporter => {
  return TelemetryBatchReporter.getInstance();
};

/** 初始化遥测 */
export const initTelemetry = async (): Promise<void> => {
  await getTelemetryReporter().initialize();
};

/** 记录事件 */
export const recordTelemetry = <K extends TelemetryEventType>(type: K, data: TelemetryEventPayloadMap[K]): void => {
  getTelemetryReporter().record(type, data);
};

/** 立即上报所有事件 */
export const flushTelemetry = async (): Promise<void> => {
  await getTelemetryReporter().flushAll();
};
