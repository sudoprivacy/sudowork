/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { buildVersion } from '@/common/buildInfo';
import { mapElectronArch } from '@/shared/types/telemetry';

type LogUploadErrorEntry = {
  tag: string;
  message: string;
  data?: unknown;
  logLine: string;
  timestampMs: number;
};

type SudoworkLogError = {
  name?: string;
  message?: string;
  stack: string;
};

type SudoworkLogEntry = {
  timestamp: string;
  tenant_id: string;
  product: string;
  topic: 'error';
  environment: 'development' | 'production';
  level: 'error';
  component: string;
  version: string;
  user_identifier_hash: string;
  user_id_hash?: string;
  device_id_hash?: string;
  session_id?: string;
  trace_id?: string;
  message: string;
  error: SudoworkLogError;
  attributes: Record<string, unknown>;
};

type SudoworkLogBatchRequest = {
  logs: SudoworkLogEntry[];
};

type SudoworkLogBatchResponse = {
  success: boolean;
  accepted?: boolean;
  received?: number;
  event_ids?: string[];
  error?: string;
  message?: string;
  retryable?: boolean;
};

type StoredLogEntry = {
  id: string;
  storedAt: number;
  retryCount: number;
  log: SudoworkLogEntry;
};

type PersonalConfigSnapshot = {
  appMode?: 'c' | 'e';
  userId?: string;
  userNickname?: string;
  userPhone?: string;
  installId?: string;
};

const SUDO_LOG_TENANT_ID = 'sudo';
const LOG_PRODUCT = 'sudowork';
const API_KEY_HEADER = 'X-API-Key';
const API_KEY = 'sk-8f3a2b1c9d5e7f6a4b3c2d1e8f9a0b7c';
const DEFAULT_BATCH_URL = 'http://127.0.0.1:8080/v1/logs/batch';
const CACHE_FILE_NAME = 'sudowork-log-error-cache.json';
const MAX_QUEUE_SIZE = 500;
const MAX_BATCH_SIZE = 50;
const MAX_RETRIES = 3;
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FLUSH_INTERVAL_MS = 30000;
const SEND_TIMEOUT_MS = 5000;
const MAX_STRING_LENGTH = 8000;
const MAX_ATTRIBUTE_STRING_LENGTH = 1000;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 40;
const MAX_OBJECT_DEPTH = 4;

function encodeConfigForRead(raw: string): Record<string, unknown> {
  const decoded = Buffer.from(raw, 'base64').toString('utf-8');
  return JSON.parse(decodeURIComponent(decoded)) as Record<string, unknown>;
}

function readEncodedJsonFile(filePath: string): Record<string, unknown> {
  try {
    if (!existsSync(filePath)) return {};
    const raw = readFileSync(filePath, 'utf-8');
    if (!raw.trim()) return {};
    return encodeConfigForRead(raw);
  } catch {
    return {};
  }
}

function getNexusDataDir(): string {
  return join(app.getPath('home'), '.nexus');
}

function getNexusConfigDir(): string {
  return join(getNexusDataDir(), 'config');
}

function getLogsDir(): string {
  const logsDir = join(getNexusDataDir(), 'logs');
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
  return logsDir;
}

function getCachePath(): string {
  return join(getLogsDir(), CACHE_FILE_NAME);
}

function scalarToString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return undefined;
}

function getConfigSnapshot(): PersonalConfigSnapshot {
  const envConfig = readEncodedJsonFile(join(getNexusConfigDir(), '.sudowork-env'));
  const dirConfig = envConfig['nexus.dir'] as { cacheDir?: string } | undefined;
  const cacheDir = dirConfig?.cacheDir || getNexusConfigDir();
  const config = readEncodedJsonFile(join(cacheDir, 'sudowork-config.txt'));
  const consumerUserInfo = config['consumer.userInfo'] as { id?: string; nickname?: string; phone?: string } | undefined;

  return {
    appMode: config['system.appMode'] as 'c' | 'e' | undefined,
    userId: scalarToString(consumerUserInfo?.id),
    userNickname: scalarToString(consumerUserInfo?.nickname),
    userPhone: scalarToString(consumerUserInfo?.phone),
    installId: scalarToString(config['telemetry.installId']),
  };
}

function isPersonalMode(): boolean {
  return getConfigSnapshot().appMode === 'c';
}

function getBatchUrl(): string {
  const explicitUrl = process.env.SUDOWORK_LOG_BATCH_URL?.trim();
  if (explicitUrl) return explicitUrl;

  const baseUrl = process.env.SUDOWORK_LOG_BASE_URL?.trim();
  if (baseUrl) {
    return new URL('/v1/logs/batch', baseUrl).toString();
  }

  return DEFAULT_BATCH_URL;
}

function hashIdentifier(value?: unknown): string | undefined {
  const normalized = scalarToString(value)?.trim();
  if (!normalized) return undefined;
  return createHash('sha256').update(normalized).digest('hex');
}

function isHashIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...[truncated]`;
}

function limitString(value: unknown, maxLength = MAX_STRING_LENGTH): string {
  return truncate(scalarToString(value) ?? String(value), maxLength);
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

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => limitValue(item, depth + 1));
  }

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

function getErrorPayload(entry: LogUploadErrorEntry): SudoworkLogError {
  if (entry.data instanceof Error) {
    return {
      name: limitString(entry.data.name || 'Error', MAX_ATTRIBUTE_STRING_LENGTH),
      message: limitString(entry.data.message || entry.message, MAX_STRING_LENGTH),
      stack: limitString(entry.data.stack || `${entry.data.name}: ${entry.data.message}`, MAX_STRING_LENGTH),
    };
  }

  const maybeError = entry.data as { name?: unknown; message?: unknown; stack?: unknown } | undefined;
  const dataName = typeof maybeError?.name === 'string' ? maybeError.name : undefined;
  const dataMessage = typeof maybeError?.message === 'string' ? maybeError.message : undefined;
  const dataStack = typeof maybeError?.stack === 'string' ? maybeError.stack : undefined;
  const message = dataMessage || entry.message;

  return {
    name: limitString(dataName || 'Error', MAX_ATTRIBUTE_STRING_LENGTH),
    message: limitString(message, MAX_STRING_LENGTH),
    stack: limitString(dataStack || new Error(message).stack || `Error: ${message}`, MAX_STRING_LENGTH),
  };
}

function toLogEntry(entry: LogUploadErrorEntry, config: PersonalConfigSnapshot): SudoworkLogEntry {
  const error = getErrorPayload(entry);
  const attributes: Record<string, unknown> = {
    log_tag: limitString(entry.tag, MAX_ATTRIBUTE_STRING_LENGTH),
    process_type: 'main',
    platform: process.platform,
    arch: mapElectronArch(process.arch),
    source: 'mainLogger',
    log_line: limitString(entry.logLine, MAX_STRING_LENGTH),
  };

  if (config.userId) attributes.user_id = limitString(config.userId, MAX_ATTRIBUTE_STRING_LENGTH);
  if (config.userNickname) attributes.user_nickname = limitString(config.userNickname, MAX_ATTRIBUTE_STRING_LENGTH);
  if (config.userPhone) attributes.user_phone = limitString(config.userPhone, MAX_ATTRIBUTE_STRING_LENGTH);

  if (entry.data !== undefined) {
    attributes.data = limitValue(entry.data);
  }

  return {
    timestamp: new Date(entry.timestampMs).toISOString(),
    tenant_id: SUDO_LOG_TENANT_ID,
    product: LOG_PRODUCT,
    topic: 'error',
    environment: app.isPackaged ? 'production' : 'development',
    level: 'error',
    component: limitString(entry.tag || 'main', MAX_ATTRIBUTE_STRING_LENGTH),
    version: buildVersion,
    user_identifier_hash: hashIdentifier(config.userPhone) || '',
    user_id_hash: hashIdentifier(config.userId),
    device_id_hash: hashIdentifier(config.installId),
    message: limitString(entry.message, MAX_STRING_LENGTH),
    error,
    attributes,
  };
}

function normalizeStoredLogEntry(entry: StoredLogEntry, config: PersonalConfigSnapshot): StoredLogEntry | null {
  const userIdentifierHash = isHashIdentifier(entry.log.user_identifier_hash) ? entry.log.user_identifier_hash : hashIdentifier(config.userPhone);
  if (!userIdentifierHash) return null;

  const attributes = entry.log.attributes && typeof entry.log.attributes === 'object' && !Array.isArray(entry.log.attributes) ? { ...(entry.log.attributes as Record<string, unknown>) } : {};

  if (config.userId && attributes.user_id === undefined) attributes.user_id = limitString(config.userId, MAX_ATTRIBUTE_STRING_LENGTH);
  if (config.userNickname && attributes.user_nickname === undefined) attributes.user_nickname = limitString(config.userNickname, MAX_ATTRIBUTE_STRING_LENGTH);
  if (config.userPhone && attributes.user_phone === undefined) attributes.user_phone = limitString(config.userPhone, MAX_ATTRIBUTE_STRING_LENGTH);

  return {
    ...entry,
    log: {
      ...entry.log,
      tenant_id: SUDO_LOG_TENANT_ID,
      product: LOG_PRODUCT,
      user_identifier_hash: userIdentifierHash,
      attributes,
    },
  };
}

class SudoworkLogUploader {
  private queue: StoredLogEntry[] = [];
  private cacheLoaded = false;
  private isFlushing = false;
  private initialized = false;
  private flushTimer: NodeJS.Timeout | null = null;

  public initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    if (!isPersonalMode()) {
      this.dropAndClear();
      return;
    }

    this.loadCachedQueue();
    if (this.queue.length > 0) {
      this.startFlushTimer();
      void this.flush();
    }
  }

  public enqueue(entry: LogUploadErrorEntry): void {
    const config = getConfigSnapshot();
    if (config.appMode !== 'c') {
      this.dropAndClear();
      return;
    }

    if (!config.userPhone?.trim()) {
      console.warn('[SudoworkLog] Missing personal user phone, skip log upload');
      return;
    }

    this.loadCachedQueue();
    this.addToQueue({
      id: this.generateId(),
      storedAt: Date.now(),
      retryCount: 0,
      log: toLogEntry(entry, config),
    });
    this.startFlushTimer();

    if (this.queue.length >= MAX_BATCH_SIZE) {
      void this.flush();
    }
  }

  public async flushAll(): Promise<void> {
    await this.flush();
  }

  public resetForTest(): void {
    this.queue = [];
    this.cacheLoaded = false;
    this.isFlushing = false;
    this.initialized = false;
    this.stopFlushTimer();
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private addToQueue(entry: StoredLogEntry): void {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      this.queue.shift();
    }
    this.queue.push(entry);
    this.persistCache();
  }

  private loadCachedQueue(): void {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;

    try {
      const cachePath = getCachePath();
      if (!existsSync(cachePath)) return;
      const cached = JSON.parse(readFileSync(cachePath, 'utf-8')) as StoredLogEntry[];
      const now = Date.now();
      let changed = false;
      this.queue = cached
        .filter((entry) => entry.retryCount < MAX_RETRIES && now - entry.storedAt < MAX_EVENT_AGE_MS)
        .map((entry) => {
          const normalized = normalizeStoredLogEntry(entry, getConfigSnapshot());
          if (!normalized) {
            changed = true;
            return null;
          }
          const normalizedChanged = normalized.log !== entry.log || (['tenant_id', 'product', 'user_identifier_hash'] as const).some((key) => normalized.log[key] !== entry.log[key]);
          if (normalizedChanged) {
            changed = true;
          }
          return normalized;
        })
        .filter((entry): entry is StoredLogEntry => entry !== null);
      if (changed) {
        if (this.queue.length === 0) {
          this.clearCacheFile();
        } else {
          this.persistCache();
        }
      }
    } catch (error) {
      console.warn('[SudoworkLog] Failed to load cache:', error);
      this.queue = [];
    }
  }

  private persistCache(): void {
    try {
      writeFileSync(getCachePath(), JSON.stringify(this.queue), 'utf-8');
    } catch (error) {
      console.warn('[SudoworkLog] Failed to persist cache:', error);
    }
  }

  private clearCacheFile(): void {
    try {
      const cachePath = getCachePath();
      if (existsSync(cachePath)) {
        unlinkSync(cachePath);
      }
    } catch {
      // Ignore cache cleanup failures.
    }
  }

  private dropAndClear(): void {
    this.queue = [];
    this.cacheLoaded = true;
    this.stopFlushTimer();
    this.clearCacheFile();
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
    if (!isPersonalMode()) {
      this.dropAndClear();
      return;
    }

    this.loadCachedQueue();
    if (this.isFlushing || this.queue.length === 0) return;

    this.isFlushing = true;
    try {
      const batch = this.queue.slice(0, MAX_BATCH_SIZE);
      const flushedCount = batch.length;
      const response = await this.sendBatch({ logs: batch.map((entry) => entry.log) });

      if (response.success && response.accepted !== false) {
        this.queue = this.queue.slice(batch.length);
        if (this.queue.length === 0) {
          this.clearCacheFile();
          this.stopFlushTimer();
        } else {
          this.persistCache();
        }
        console.info(`[SudoworkLog] Flush succeeded: flushed=${flushedCount}, received=${response.received ?? flushedCount}, pending=${this.queue.length}`);
        return;
      }

      const reason = response.error || response.message || 'Upload rejected';
      if (response.retryable === false) {
        this.dropBatch(batch, reason);
        return;
      }

      this.markBatchFailed(batch, reason);
    } catch (error) {
      console.warn('[SudoworkLog] Flush failed:', error);
    } finally {
      this.isFlushing = false;
    }
  }

  private markBatchFailed(batch: StoredLogEntry[], reason: string): void {
    for (const entry of batch) {
      entry.retryCount += 1;
    }

    const now = Date.now();
    this.queue = this.queue.filter((entry) => entry.retryCount < MAX_RETRIES && now - entry.storedAt < MAX_EVENT_AGE_MS);
    this.persistCache();
    console.warn(`[SudoworkLog] Upload failed: ${reason}, pending=${this.queue.length}`);
  }

  private dropBatch(batch: StoredLogEntry[], reason: string): void {
    this.queue = this.queue.slice(batch.length);
    if (this.queue.length === 0) {
      this.clearCacheFile();
      this.stopFlushTimer();
    } else {
      this.persistCache();
    }
    console.warn(`[SudoworkLog] Dropped non-retryable batch: ${reason}, pending=${this.queue.length}`);
  }

  private async sendBatch(request: SudoworkLogBatchRequest): Promise<SudoworkLogBatchResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

    try {
      const response = await fetch(getBatchUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [API_KEY_HEADER]: API_KEY,
        },
        body: JSON.stringify(request),
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

      return (await response.json()) as SudoworkLogBatchResponse;
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

const uploader = new SudoworkLogUploader();

export function initializeSudoworkLogUploader(): void {
  uploader.initialize();
}

export function enqueueSudoworkLogError(entry: LogUploadErrorEntry): void {
  uploader.enqueue(entry);
}

export async function flushSudoworkLogUploader(): Promise<void> {
  await uploader.flushAll();
}

export function resetSudoworkLogUploaderForTest(): void {
  uploader.resetForTest();
}
