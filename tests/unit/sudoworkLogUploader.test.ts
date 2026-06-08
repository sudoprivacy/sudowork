/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BATCH_URL = 'https://logs.test/v1/logs/batch';

function encodeConfig(data: Record<string, unknown>): string {
  return Buffer.from(encodeURIComponent(JSON.stringify(data)), 'utf-8').toString('base64');
}

function writeConfig(homeDir: string, config: Record<string, unknown>): void {
  const configDir = join(homeDir, '.nexus', 'config');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'sudowork-config.txt'), encodeConfig(config), 'utf-8');
}

function getLogPath(homeDir: string): string {
  return join(homeDir, '.nexus', 'logs', 'sudowork.log');
}

function getCachePath(homeDir: string): string {
  return join(homeDir, '.nexus', 'logs', 'sudowork-log-error-cache.json');
}

function hash(value: string): string {
  return createHash('sha256').update(value.trim()).digest('hex');
}

describe('Sudowork Log personal error upload sink', () => {
  let homeDir: string;
  let fetchMock: ReturnType<typeof vi.fn>;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    homeDir = mkdtempSync(join(tmpdir(), 'sudowork-log-test-'));
    process.env.SUDOWORK_LOG_BATCH_URL = BATCH_URL;
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn((name: string) => {
          if (name === 'home') return homeDir;
          return homeDir;
        }),
        isPackaged: true,
      },
    }));

    vi.doMock('@/common', () => ({
      ipcBridge: {
        application: {
          logStream: {
            emit: vi.fn(),
          },
        },
      },
    }));

    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ success: true, accepted: true, received: 1, event_ids: ['evt_1'] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    const uploader = await import('@/process/utils/sudoworkLogUploader');
    uploader.resetSudoworkLogUploaderForTest();
    consoleInfoSpy.mockRestore();
    vi.unstubAllGlobals();
    delete process.env.SUDOWORK_LOG_BATCH_URL;
    delete process.env.SUDOWORK_LOG_BASE_URL;
    rmSync(homeDir, { recursive: true, force: true });
  });

  it('uses the development Sudowork Log endpoint by default', async () => {
    delete process.env.SUDOWORK_LOG_BATCH_URL;
    writeConfig(homeDir, {
      'system.appMode': 'c',
      'consumer.userInfo': { id: 'user-123', phone: '13800138000' },
      'telemetry.installId': 'device-abc',
    });

    const uploader = await import('@/process/utils/sudoworkLogUploader');
    uploader.enqueueSudoworkLogError({
      tag: 'DefaultEndpointTest',
      message: 'default endpoint error',
      logLine: '[ERROR] 2026-06-04 00:00:00 [DefaultEndpointTest] default endpoint error',
      timestampMs: Date.now(),
    });
    await uploader.flushSudoworkLogUploader();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8080/v1/logs/batch');
  });

  it('logs successful flush counts', async () => {
    writeConfig(homeDir, {
      'system.appMode': 'c',
      'consumer.userInfo': { id: 'user-123', phone: '13800138000' },
      'telemetry.installId': 'device-abc',
    });

    const uploader = await import('@/process/utils/sudoworkLogUploader');
    uploader.enqueueSudoworkLogError({
      tag: 'FlushCountTest',
      message: 'count uploaded logs',
      logLine: '[ERROR] 2026-06-04 00:00:00 [FlushCountTest] count uploaded logs',
      timestampMs: Date.now(),
    });
    await uploader.flushSudoworkLogUploader();

    expect(consoleInfoSpy).toHaveBeenCalledWith(expect.stringContaining('[SudoworkLog] Flush succeeded: flushed=1, received=1, pending=0'));
  });

  it('normalizes scalar config identifiers before building upload payloads', async () => {
    writeConfig(homeDir, {
      'system.appMode': 'c',
      'consumer.userInfo': { id: 12345, nickname: 67890, phone: 13800138000 },
      'telemetry.installId': 98765,
    });

    const uploader = await import('@/process/utils/sudoworkLogUploader');
    uploader.enqueueSudoworkLogError({
      tag: 'ScalarConfigTest',
      message: 'numeric config identifiers should not crash enqueue',
      logLine: '[ERROR] 2026-06-04 00:00:00 [ScalarConfigTest] numeric config identifiers should not crash enqueue',
      timestampMs: Date.now(),
    });
    await uploader.flushSudoworkLogUploader();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const [log] = body.logs;

    expect(log.user_identifier_hash).toBe(hash('13800138000'));
    expect(log.user_id_hash).toBe(hash('12345'));
    expect(log.device_id_hash).toBe(hash('98765'));
    expect(log.attributes.user_id).toBe('12345');
    expect(log.attributes.user_nickname).toBe('67890');
    expect(log.attributes.user_phone).toBe('13800138000');
  });

  it('keeps local logging intact and uploads only ERROR entries in personal mode', async () => {
    writeConfig(homeDir, {
      'system.appMode': 'c',
      'consumer.userInfo': { id: ' user-123 ', nickname: 'Alice Zhang', phone: '13800138000', tenant_id: 'tenant-a' },
      'telemetry.installId': ' device-abc ',
    });

    const { mainLog, mainWarn, mainError } = await import('@/process/utils/mainLogger');
    const { flushSudoworkLogUploader } = await import('@/process/utils/sudoworkLogUploader');

    mainLog('LoggerTest', 'info message');
    mainWarn('LoggerTest', 'warn message');
    mainError('CheckoutService', 'checkout failed with Authorization: Bearer secret-token', {
      name: 'PaymentProviderError',
      message: 'provider returned sk-1234567890123456 for user@example.com',
      stack: 'PaymentProviderError: provider returned sk-1234567890123456 for user@example.com',
      authorization: 'Bearer nested-token',
      requestBody: 'card=4111111111111111',
    });
    await flushSudoworkLogUploader();

    const localLog = readFileSync(getLogPath(homeDir), 'utf-8');
    expect(localLog).toContain('[INFO]');
    expect(localLog).toContain('[WARN]');
    expect(localLog).toContain('[ERROR]');
    expect(localLog).toContain('checkout failed with Authorization: Bearer secret-token');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe(BATCH_URL);
    expect(request.headers['X-API-Key']).toBeTruthy();

    const body = JSON.parse(request.body);
    expect(body.logs).toHaveLength(1);
    const [log] = body.logs;

    expect(log).toMatchObject({
      tenant_id: 'sudo',
      product: 'sudowork',
      topic: 'error',
      environment: 'production',
      level: 'error',
      component: 'CheckoutService',
      message: 'checkout failed with Authorization: Bearer secret-token',
    });
    expect(log.user_identifier_hash).toBe(hash('13800138000'));
    expect(log.user_id_hash).toBe(hash('user-123'));
    expect(log.device_id_hash).toBe(hash('device-abc'));
    expect(log.error.message).toContain('sk-1234567890123456');
    expect(log.error.message).toContain('user@example.com');
    expect(log.error.stack).toBeTruthy();
    expect(log.error.stack).toContain('sk-1234567890123456');
    expect(log.attributes.source).toBe('mainLogger');
    expect(log.attributes.user_id).toBe(' user-123 ');
    expect(log.attributes.user_nickname).toBe('Alice Zhang');
    expect(log.attributes.user_phone).toBe('13800138000');
    expect(log.attributes.log_line).toContain('secret-token');
    expect(log.attributes.data.authorization).toBe('Bearer nested-token');
    expect(log.attributes.data.requestBody).toBe('card=4111111111111111');
  });

  it('skips upload when required personal phone identifier is unavailable', async () => {
    writeConfig(homeDir, {
      'system.appMode': 'c',
      'consumer.userInfo': { id: 'user-without-phone' },
      'telemetry.installId': 'device-abc',
    });

    const uploader = await import('@/process/utils/sudoworkLogUploader');
    uploader.enqueueSudoworkLogError({
      tag: 'MissingPhoneTest',
      message: 'phone missing',
      logLine: '[ERROR] 2026-06-04 00:00:00 [MissingPhoneTest] phone missing',
      timestampMs: Date.now(),
    });
    await uploader.flushSudoworkLogUploader();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(getCachePath(homeDir))).toBe(false);
  });

  it('keeps upload payload plaintext while still enforcing length limits', async () => {
    writeConfig(homeDir, {
      'system.appMode': 'c',
      'consumer.userInfo': { id: 'user-123', phone: '13800138000', tenant_id: 'tenant-a' },
      'telemetry.installId': 'device-abc',
    });

    const longMessage = `secret:${'x'.repeat(9000)}`;
    const longAttribute = `token:${'y'.repeat(1200)}`;
    const uploader = await import('@/process/utils/sudoworkLogUploader');

    uploader.enqueueSudoworkLogError({
      tag: 'LimitTest',
      message: longMessage,
      data: { apiKey: longAttribute },
      logLine: `[ERROR] 2026-06-04 00:00:00 [LimitTest] ${longMessage}`,
      timestampMs: Date.now(),
    });
    await uploader.flushSudoworkLogUploader();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const [log] = body.logs;

    expect(log.message).toHaveLength(8014);
    expect(log.message).toContain('secret:');
    expect(log.message).toContain('[truncated]');
    expect(log.attributes.data.apiKey).toHaveLength(1014);
    expect(log.attributes.data.apiKey).toContain('token:');
    expect(log.attributes.data.apiKey).toContain('[truncated]');
  });

  it('drops and clears upload state in enterprise mode without network calls', async () => {
    writeConfig(homeDir, {
      'system.appMode': 'e',
      'consumer.userInfo': { id: 'personal-user', tenant_id: 'tenant-a' },
      'telemetry.installId': 'device-abc',
    });
    mkdirSync(join(homeDir, '.nexus', 'logs'), { recursive: true });
    writeFileSync(getCachePath(homeDir), '[]', 'utf-8');

    const { mainError } = await import('@/process/utils/mainLogger');
    const { flushSudoworkLogUploader } = await import('@/process/utils/sudoworkLogUploader');

    mainError('EnterprisePath', 'enterprise error should stay local', new Error('enterprise failure'));
    await flushSudoworkLogUploader();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(getCachePath(homeDir))).toBe(false);
    expect(readFileSync(getLogPath(homeDir), 'utf-8')).toContain('enterprise error should stay local');
  });

  it('persists failed uploads and retries cached entries later', async () => {
    writeConfig(homeDir, {
      'system.appMode': 'c',
      'consumer.userInfo': { id: 'user-123', phone: '13800138000', tenant_id: 'tenant-a' },
      'telemetry.installId': 'device-abc',
    });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: async () => ({ success: false, received: 0 }),
    });

    const uploader = await import('@/process/utils/sudoworkLogUploader');
    uploader.enqueueSudoworkLogError({
      tag: 'RetryTest',
      message: 'first upload fails',
      logLine: '[ERROR] 2026-06-04 00:00:00 [RetryTest] first upload fails',
      timestampMs: Date.now(),
    });
    await uploader.flushSudoworkLogUploader();

    const cacheAfterFailure = JSON.parse(readFileSync(getCachePath(homeDir), 'utf-8'));
    expect(cacheAfterFailure).toHaveLength(1);
    expect(cacheAfterFailure[0].retryCount).toBe(1);

    uploader.resetSudoworkLogUploaderForTest();
    uploader.initializeSudoworkLogUploader();

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(existsSync(getCachePath(homeDir))).toBe(false);
    });
  });

  it('normalizes legacy cached entries with the required phone identifier hash', async () => {
    writeConfig(homeDir, {
      'system.appMode': 'c',
      'consumer.userInfo': { id: 'user-123', nickname: 'Alice Zhang', phone: '13800138000', tenant_id: 'tenant-a' },
      'telemetry.installId': 'device-abc',
    });
    mkdirSync(join(homeDir, '.nexus', 'logs'), { recursive: true });
    writeFileSync(
      getCachePath(homeDir),
      JSON.stringify([
        {
          id: 'legacy-entry',
          storedAt: Date.now(),
          retryCount: 0,
          log: {
            timestamp: new Date().toISOString(),
            tenant_id: 'tenant-a',
            product: 'legacy-product',
            topic: 'error',
            environment: 'production',
            level: 'error',
            component: 'LegacyUploader',
            version: '0.0.0',
            user_id_hash: hash('user-123'),
            device_id_hash: hash('device-abc'),
            message: 'legacy cached error',
            error: {
              name: 'Error',
              message: 'legacy cached error',
              stack: 'Error: legacy cached error',
            },
            attributes: {
              source: 'legacy',
            },
          },
        },
      ]),
      'utf-8'
    );

    const uploader = await import('@/process/utils/sudoworkLogUploader');
    uploader.initializeSudoworkLogUploader();

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(existsSync(getCachePath(homeDir))).toBe(false);
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const [log] = body.logs;

    expect(log.tenant_id).toBe('sudo');
    expect(log.product).toBe('sudowork');
    expect(log.user_identifier_hash).toBe(hash('13800138000'));
    expect(log.attributes.user_id).toBe('user-123');
    expect(log.attributes.user_nickname).toBe('Alice Zhang');
    expect(log.attributes.user_phone).toBe('13800138000');
  });

  it('drops non-retryable client errors instead of caching them', async () => {
    writeConfig(homeDir, {
      'system.appMode': 'c',
      'consumer.userInfo': { id: 'user-123', phone: '13800138000', tenant_id: 'tenant-a' },
      'telemetry.installId': 'device-abc',
    });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ success: false, received: 0 }),
    });

    const uploader = await import('@/process/utils/sudoworkLogUploader');
    uploader.enqueueSudoworkLogError({
      tag: 'ClientErrorTest',
      message: 'bad payload should not retry',
      logLine: '[ERROR] 2026-06-04 00:00:00 [ClientErrorTest] bad payload should not retry',
      timestampMs: Date.now(),
    });
    await uploader.flushSudoworkLogUploader();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(existsSync(getCachePath(homeDir))).toBe(false);
  });
});
