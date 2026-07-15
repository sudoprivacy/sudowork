/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { isLogReportEnabled } from '@/common/systemConfig';
import { getLogReportKey } from '@/process/credentialsCache';
import type { CrashEvent } from '../../shared/types/crash';
import type { ConversationData, InstallData, PerfData, StepData, TelemetryEvent, TurnData } from '../../shared/types/telemetry';
import { mainError, mainLog, mainWarn } from '../utils/mainLogger';
import { SUDO_LOG_API_KEY_HEADER, SUDO_LOG_ENVIRONMENT, SUDO_LOG_PRODUCT, SUDO_LOG_TENANT_ID, getSudoworkLogBatchUrl } from '../utils/sudoworkLogUploader';
import { getUserContextSync } from './UserContext';

type SudoLogLevel = 'info' | 'warn' | 'error';

type SudoLogEntry = {
  timestamp: string;
  tenant_id: string;
  product: string;
  topic: 'app' | 'audit' | 'error' | 'perf';
  environment: 'development' | 'production';
  level: SudoLogLevel;
  component: string;
  version: string;
  platform: string;
  arch: string;
  user_identifier_hash: string;
  user_id_hash?: string;
  session_id?: string;
  trace_id?: string;
  message: string;
  error?: {
    name: string;
    message: string;
    stack: string;
  };
  tags: Record<string, string | number | boolean>;
  attributes: Record<string, unknown>;
};

type SudoLogBatchResponse = {
  success: boolean;
  accepted?: boolean;
  received?: number;
  error?: string;
  message?: string;
  retryable?: boolean;
};

type StoredSudoLogTelemetryEntry = {
  id: string;
  storedAt: number;
  retryCount: number;
  log: SudoLogEntry;
};

const CACHE_FILE_NAME = 'sudowork-log-telemetry-cache.json';
const MAX_QUEUE_SIZE = 500;
const MAX_BATCH_SIZE = 50;
const MAX_RETRIES = 3;
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FLUSH_INTERVAL_MS = 30000;
const SEND_TIMEOUT_MS = 5000;
const MAX_STRING_LENGTH = 8000;
const MAX_TAG_VALUE_LENGTH = 256;
const MAX_ATTRIBUTE_STRING_LENGTH = 2000;
const MAX_ARRAY_ITEMS = 30;
const MAX_OBJECT_KEYS = 80;
const MAX_OBJECT_DEPTH = 5;

function isPersonalMode(): boolean {
  return getUserContextSync().login_mode === 'personal';
}

function hashIdentifier(value?: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const normalized = String(value).trim();
  if (!normalized) return undefined;
  return createHash('sha256').update(normalized).digest('hex');
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...[truncated]`;
}

function limitString(value: unknown, maxLength = MAX_STRING_LENGTH): string {
  if (value === undefined || value === null) return '';
  return truncate(String(value), maxLength);
}

function addTag(tags: Record<string, string | number | boolean>, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) tags[key] = value;
    return;
  }
  if (typeof value === 'boolean') {
    tags[key] = value;
    return;
  }
  const normalized = String(value).trim();
  if (!normalized) return;
  tags[key] = truncate(normalized, MAX_TAG_VALUE_LENGTH);
}

function maskedPhone(value?: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 7) return undefined;
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

function userLabel(event: Pick<TelemetryEvent | CrashEvent, 'user_id' | 'user_nickname' | 'user_phone'>): string | undefined {
  const nickname = typeof event.user_nickname === 'string' ? event.user_nickname.trim() : '';
  if (nickname) return nickname;

  const masked = maskedPhone(event.user_phone);
  if (masked) return masked;

  const userKey = hashIdentifier(event.user_id);
  return userKey ? `user_${userKey.slice(0, 8)}` : undefined;
}

function addUserTags(tags: Record<string, string | number | boolean>, event: Pick<TelemetryEvent | CrashEvent, 'user_id' | 'user_nickname' | 'user_phone'>): void {
  const userKey = hashIdentifier(event.user_id) || hashIdentifier(event.user_phone);
  addTag(tags, 'sw_user_key', userKey);
  addTag(tags, 'sw_user', userLabel(event));
}

function limitValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_OBJECT_DEPTH) return '[MaxDepth]';
  if (value === null || value === undefined) return value;
  if (value instanceof Error) {
    return {
      name: limitString(value.name, MAX_ATTRIBUTE_STRING_LENGTH),
      message: limitString(value.message, MAX_ATTRIBUTE_STRING_LENGTH),
      stack: value.stack ? limitString(value.stack, MAX_STRING_LENGTH) : undefined,
    };
  }
  if (typeof value === 'string') return limitString(value, MAX_ATTRIBUTE_STRING_LENGTH);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map((item) => limitValue(item, depth + 1));

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    let count = 0;
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      if (count >= MAX_OBJECT_KEYS) {
        result.__truncated_keys = true;
        break;
      }
      result[key] = limitValue(nestedValue, depth + 1);
      count += 1;
    }
    return result;
  }
  return String(value);
}

function getCachePath(): string {
  return path.join(app.getPath('userData'), CACHE_FILE_NAME);
}

function timestampToIso(value: number): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function dataSessionId(data: TelemetryEvent['data']): string | undefined {
  return 'session_id' in data ? data.session_id : undefined;
}

function dataTraceId(data: TelemetryEvent['data']): string | undefined {
  if ('turn_id' in data && typeof data.turn_id === 'string') return data.turn_id;
  if ('step_id' in data && typeof data.step_id === 'string') return data.step_id;
  if ('install_id' in data && typeof data.install_id === 'string') return data.install_id;
  return undefined;
}

function telemetryLevel(event: TelemetryEvent): SudoLogLevel {
  const data = event.data as { status?: unknown };
  if (data.status === 'error' || data.status === 'failed') return 'error';
  return 'info';
}

function telemetryTopic(event: TelemetryEvent): SudoLogEntry['topic'] {
  if (event.type === 'perf') return 'perf';
  if (event.type === 'install') return 'audit';
  if (telemetryLevel(event) === 'error') return 'error';
  return 'app';
}

function telemetryError(event: TelemetryEvent): SudoLogEntry['error'] | undefined {
  if (telemetryLevel(event) !== 'error') return undefined;
  const data = event.data as { error_code?: unknown; error_message?: unknown; status?: unknown };
  const name = limitString(data.error_code || `${event.type}_error`, MAX_ATTRIBUTE_STRING_LENGTH);
  const message = limitString(data.error_message || `QMS telemetry ${event.type} reported ${data.status || 'error'}`, MAX_STRING_LENGTH);
  return {
    name,
    message,
    stack: `${name}: ${message}\n    at qms.telemetry.${event.type}`,
  };
}

function buildTelemetryTags(event: TelemetryEvent): Record<string, string | number | boolean> {
  const tags: Record<string, string | number | boolean> = {};
  addTag(tags, 'sw_signal', 'telemetry');
  addTag(tags, 'sw_event_type', event.type);
  addTag(tags, 'sw_login_mode', event.login_mode);
  addTag(tags, 'sw_agent_type', event.agent_type);
  addUserTags(tags, event);

  if (event.type === 'perf') {
    const data = event.data as PerfData;
    addTag(tags, 'sw_perf_metric', data.metric);
    addTag(tags, 'value_ms', data.value_ms);
  } else if (event.type === 'conversation') {
    const data = event.data as ConversationData;
    addTag(tags, 'sw_status', data.status);
    addTag(tags, 'sw_model_id', data.model_id);
    addTag(tags, 'sw_model_provider', data.model_provider);
    addTag(tags, 'sw_error_code', data.error_code);
    addTag(tags, 'duration_ms', data.duration_ms);
    addTag(tags, 'tokens_used', data.tokens_used);
    addTag(tags, 'input_tokens', data.input_tokens);
    addTag(tags, 'output_tokens', data.output_tokens);
  } else if (event.type === 'install') {
    const data = event.data as InstallData;
    addTag(tags, 'sw_install_status', data.status);
    addTag(tags, 'sw_install_type', data.install_type);
    addTag(tags, 'duration_ms', data.duration_ms);
  } else if (event.type === 'turn') {
    const data = event.data as TurnData;
    addTag(tags, 'sw_status', data.status);
    addTag(tags, 'sw_model_id', data.model_id);
    addTag(tags, 'sw_model_provider', data.model_provider);
    addTag(tags, 'sw_error_code', data.error_code);
    addTag(tags, 'duration_ms', data.duration_ms);
    addTag(tags, 'input_tokens', data.input_tokens);
    addTag(tags, 'output_tokens', data.output_tokens);
    addTag(tags, 'total_tokens', data.total_tokens);
  } else {
    const data = event.data as StepData;
    addTag(tags, 'sw_step_type', data.step_type);
    addTag(tags, 'sw_step_status', data.status);
    addTag(tags, 'sw_tool_name', data.tool_name);
    addTag(tags, 'sw_tool_kind', data.tool_kind);
    addTag(tags, 'sw_permission_kind', data.permission_kind);
    addTag(tags, 'duration_ms', data.duration_ms);
    addTag(tags, 'thinking_tokens', data.thinking_tokens);
  }

  return tags;
}

function toTelemetryLog(event: TelemetryEvent): SudoLogEntry | null {
  const userIdentifierHash = hashIdentifier(event.user_phone) || hashIdentifier(event.user_id);
  if (!userIdentifierHash) return null;

  const level = telemetryLevel(event);
  return {
    timestamp: timestampToIso(event.timestamp),
    tenant_id: SUDO_LOG_TENANT_ID,
    product: SUDO_LOG_PRODUCT,
    topic: telemetryTopic(event),
    environment: SUDO_LOG_ENVIRONMENT,
    level,
    component: `qms.telemetry.${event.type}`,
    version: event.version,
    platform: event.platform,
    arch: event.arch,
    user_identifier_hash: userIdentifierHash,
    user_id_hash: hashIdentifier(event.user_id),
    session_id: dataSessionId(event.data),
    trace_id: dataTraceId(event.data),
    message: `QMS telemetry ${event.type}`,
    error: telemetryError(event),
    tags: buildTelemetryTags(event),
    attributes: {
      qms_event: limitValue(event),
    },
  };
}

function crashError(event: CrashEvent): SudoLogEntry['error'] {
  if (event.type === 'js_exception') {
    return {
      name: limitString(event.error_name || 'JsException', MAX_ATTRIBUTE_STRING_LENGTH),
      message: limitString(event.error_message || 'JavaScript exception', MAX_STRING_LENGTH),
      stack: limitString(event.stack_trace || `${event.error_name}: ${event.error_message}`, MAX_STRING_LENGTH),
    };
  }

  const message = `Crash reason: ${event.crash_reason}`;
  return {
    name: limitString(event.crash_reason || event.type, MAX_ATTRIBUTE_STRING_LENGTH),
    message,
    stack: `${event.type}: ${message}\n    at qms.crash.${event.process_type}`,
  };
}

function buildCrashTags(event: CrashEvent): Record<string, string | number | boolean> {
  const tags: Record<string, string | number | boolean> = {};
  addTag(tags, 'sw_signal', 'crash');
  addTag(tags, 'sw_event_type', event.type);
  addTag(tags, 'sw_login_mode', event.login_mode);
  addTag(tags, 'sw_agent_type', event.agent_type);
  addUserTags(tags, event);
  addTag(tags, 'sw_process_type', event.process_type);
  if (event.type === 'js_exception') {
    addTag(tags, 'sw_error_name', event.error_name);
  } else {
    addTag(tags, 'sw_crash_reason', event.crash_reason);
    addTag(tags, 'exit_code', event.exit_code);
  }
  return tags;
}

function toCrashLog(event: CrashEvent): SudoLogEntry | null {
  const userIdentifierHash = hashIdentifier(event.user_phone) || hashIdentifier(event.user_id);
  if (!userIdentifierHash) return null;

  return {
    timestamp: timestampToIso(event.timestamp),
    tenant_id: SUDO_LOG_TENANT_ID,
    product: SUDO_LOG_PRODUCT,
    topic: 'error',
    environment: SUDO_LOG_ENVIRONMENT,
    level: 'error',
    component: `qms.crash.${event.type}`,
    version: event.version,
    platform: event.platform,
    arch: event.arch,
    user_identifier_hash: userIdentifierHash,
    user_id_hash: hashIdentifier(event.user_id),
    session_id: event.context?.session_id,
    message: `QMS crash ${event.type}`,
    error: crashError(event),
    tags: buildCrashTags(event),
    attributes: {
      qms_event: limitValue(event),
    },
  };
}

export class SudoLogTelemetryReporter {
  private static instance: SudoLogTelemetryReporter | null = null;

  private queue: StoredSudoLogTelemetryEntry[] = [];
  private initialized = false;
  private enabled = false;
  private cacheLoaded = false;
  private isFlushing = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private enqueueChain: Promise<void> = Promise.resolve();

  private constructor() {}

  public static getInstance(): SudoLogTelemetryReporter {
    if (!SudoLogTelemetryReporter.instance) {
      SudoLogTelemetryReporter.instance = new SudoLogTelemetryReporter();
    }
    return SudoLogTelemetryReporter.instance;
  }

  public async initialize(enabled: boolean): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.enabled = enabled && isPersonalMode() && isLogReportEnabled();

    if (!this.enabled) {
      await this.dropAndClear();
      return;
    }

    await this.loadCachedQueue();
    if (this.queue.length > 0) {
      this.startFlushTimer();
      void this.flush();
    }
    mainLog('SudoLogTelemetry', `Initialized, queue: ${this.queue.length}, endpoint: ${getSudoworkLogBatchUrl()}`);
  }

  public async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled && isPersonalMode() && isLogReportEnabled();
    if (!this.enabled) {
      await this.dropAndClear();
      return;
    }
    this.startFlushTimer();
  }

  public enqueueTelemetryEvent(event: TelemetryEvent): void {
    this.enqueueLog(toTelemetryLog(event));
  }

  public enqueueCrashEvent(event: CrashEvent): void {
    this.enqueueLog(toCrashLog(event));
  }

  public async flushAll(): Promise<void> {
    await this.flush();
  }

  public resetForTest(): void {
    this.queue = [];
    this.initialized = false;
    this.enabled = false;
    this.cacheLoaded = false;
    this.isFlushing = false;
    this.stopFlushTimer();
    this.enqueueChain = Promise.resolve();
  }

  private enqueueLog(log: SudoLogEntry | null): void {
    if (!log) return;
    if (this.initialized && (!this.enabled || !isPersonalMode() || !isLogReportEnabled())) return;

    this.enqueueChain = this.enqueueChain
      .then(async () => {
        await this.loadCachedQueue();
        await this.addToQueue({
          id: this.generateId(),
          storedAt: Date.now(),
          retryCount: 0,
          log,
        });
        if (this.enabled) {
          this.startFlushTimer();
          if (this.queue.length >= MAX_BATCH_SIZE) {
            void this.flush();
          }
        }
      })
      .catch((error) => {
        mainWarn('SudoLogTelemetry', 'Failed to enqueue event:', error);
      });
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private async addToQueue(entry: StoredSudoLogTelemetryEntry): Promise<void> {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      this.queue.shift();
    }
    this.queue.push(entry);
    await this.persistCache();
  }

  private async loadCachedQueue(): Promise<void> {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;
    try {
      const content = await fs.readFile(getCachePath(), 'utf-8').catch(() => '');
      if (!content.trim()) return;
      const cached = JSON.parse(content) as StoredSudoLogTelemetryEntry[];
      const now = Date.now();
      this.queue = cached.filter((entry) => entry.retryCount < MAX_RETRIES && now - entry.storedAt < MAX_EVENT_AGE_MS);
      if (this.queue.length !== cached.length) {
        await this.persistOrClearCache();
      }
    } catch (error) {
      mainWarn('SudoLogTelemetry', 'Failed to load cache:', error);
      this.queue = [];
    }
  }

  private async persistCache(): Promise<void> {
    try {
      await fs.writeFile(getCachePath(), JSON.stringify(this.queue), 'utf-8');
    } catch (error) {
      mainWarn('SudoLogTelemetry', 'Failed to persist cache:', error);
    }
  }

  private async clearCacheFile(): Promise<void> {
    await fs.unlink(getCachePath()).catch(() => {});
  }

  private async persistOrClearCache(): Promise<void> {
    if (this.queue.length === 0) {
      await this.clearCacheFile();
    } else {
      await this.persistCache();
    }
  }

  private async dropAndClear(): Promise<void> {
    this.queue = [];
    this.cacheLoaded = true;
    this.stopFlushTimer();
    await this.clearCacheFile();
  }

  private startFlushTimer(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
    this.flushTimer.unref?.();
  }

  private stopFlushTimer(): void {
    if (!this.flushTimer) return;
    clearInterval(this.flushTimer);
    this.flushTimer = null;
  }

  private async flush(): Promise<void> {
    if (!this.enabled || !isPersonalMode() || !isLogReportEnabled()) {
      await this.dropAndClear();
      return;
    }

    await this.enqueueChain;
    await this.loadCachedQueue();
    if (this.isFlushing || this.queue.length === 0) return;

    this.isFlushing = true;
    try {
      const batch = this.queue.slice(0, MAX_BATCH_SIZE);
      const response = await this.sendBatch(batch.map((entry) => entry.log));

      if (response.success && response.accepted !== false) {
        this.queue = this.queue.slice(batch.length);
        await this.persistOrClearCache();
        if (this.queue.length === 0) this.stopFlushTimer();
        mainLog('SudoLogTelemetry', `Flushed ${response.received ?? batch.length} event(s), pending: ${this.queue.length}`);
        return;
      }

      const reason = response.error || response.message || 'Upload rejected';
      if (response.retryable === false) {
        this.queue = this.queue.slice(batch.length);
        await this.persistOrClearCache();
        mainWarn('SudoLogTelemetry', `Dropped non-retryable batch: ${reason}, pending: ${this.queue.length}`);
        return;
      }

      await this.markBatchFailed(batch, reason);
    } catch (error) {
      mainError('SudoLogTelemetry', 'Flush error:', error);
    } finally {
      this.isFlushing = false;
    }
  }

  private async markBatchFailed(batch: StoredSudoLogTelemetryEntry[], reason: string): Promise<void> {
    for (const entry of batch) {
      entry.retryCount += 1;
    }
    const now = Date.now();
    this.queue = this.queue.filter((entry) => entry.retryCount < MAX_RETRIES && now - entry.storedAt < MAX_EVENT_AGE_MS);
    await this.persistOrClearCache();
    mainWarn('SudoLogTelemetry', `Upload failed: ${reason}, pending: ${this.queue.length}`);
  }

  private async sendBatch(logs: SudoLogEntry[]): Promise<SudoLogBatchResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const apiKey = getLogReportKey();
      if (!apiKey) {
        mainError('SudoLogTelemetry', 'log_report key not provisioned, skip sendBatch');
        return { success: false, received: 0, error: 'log_report key missing', retryable: false };
      }

      const response = await fetch(getSudoworkLogBatchUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [SUDO_LOG_API_KEY_HEADER]: apiKey,
        },
        body: JSON.stringify({ logs }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          success: false,
          received: 0,
          error: `HTTP ${response.status}: ${response.statusText}`,
          retryable: response.status >= 500,
        };
      }

      return (await response.json()) as SudoLogBatchResponse;
    } catch (error) {
      return {
        success: false,
        received: 0,
        error: error instanceof Error ? error.message : 'Network error',
        retryable: true,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const getSudoLogTelemetryReporter = (): SudoLogTelemetryReporter => {
  return SudoLogTelemetryReporter.getInstance();
};

export const initSudoLogTelemetryReporter = async (enabled: boolean): Promise<void> => {
  await getSudoLogTelemetryReporter().initialize(enabled);
};

export const flushSudoLogTelemetryReporter = async (): Promise<void> => {
  await getSudoLogTelemetryReporter().flushAll();
};

export const resetSudoLogTelemetryReporterForTest = (): void => {
  getSudoLogTelemetryReporter().resetForTest();
};
