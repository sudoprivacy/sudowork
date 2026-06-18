/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BATCH_URL = 'https://logs.test/v1/logs/batch';
const TEST_LOG_REPORT_KEY = 'test-log-report-key';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('SudoLogTelemetryReporter', () => {
  let userDataDir: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    userDataDir = mkdtempSync(join(tmpdir(), 'sudowork-log-telemetry-test-'));
    process.env.SUDOWORK_LOG_BATCH_URL = BATCH_URL;

    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn((name: string) => {
          if (name === 'userData') return userDataDir;
          return userDataDir;
        }),
        isPackaged: true,
      },
    }));
    vi.doMock('@/common/buildInfo', () => ({ buildVersion: '9.9.9-test' }));
    vi.doMock('@/process/initStorage', () => ({
      ProcessConfig: {
        getSync: vi.fn((key: string) => {
          if (key === 'system.appMode') return 'c';
          if (key === 'consumer.userInfo') return { id: 'user-123', phone: '13800138000', tenant_id: 'sudo' };
          return undefined;
        }),
      },
    }));
    vi.doMock('@/common/systemConfig', () => ({
      getLogReportBaseUrl: vi.fn(() => 'https://sudolog.sudoprivacy.com'),
      isLogReportEnabled: vi.fn(() => true),
    }));
    vi.doMock('@/process/credentialsCache', () => ({
      getLogReportKey: vi.fn(() => TEST_LOG_REPORT_KEY),
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
    const { resetSudoLogTelemetryReporterForTest } = await import('@/process/telemetry/SudoLogTelemetryReporter');
    resetSudoLogTelemetryReporterForTest();
    vi.unstubAllGlobals();
    vi.unmock('electron');
    vi.unmock('@/common/buildInfo');
    vi.unmock('@/process/initStorage');
    vi.unmock('@/common/systemConfig');
    vi.unmock('@/process/credentialsCache');
    delete process.env.SUDOWORK_LOG_BATCH_URL;
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it('converts QMS turn telemetry into a sudolog batch with metric-like numeric tags', async () => {
    mkdirSync(userDataDir, { recursive: true });
    const { getSudoLogTelemetryReporter } = await import('@/process/telemetry/SudoLogTelemetryReporter');
    const reporter = getSudoLogTelemetryReporter();

    await reporter.initialize(true);
    reporter.enqueueTelemetryEvent({
      type: 'turn',
      timestamp: 1781654400000,
      version: '9.9.9-test',
      platform: 'darwin',
      arch: 'arm64',
      user_id: 'user-123',
      tenant_id: 'sudo',
      login_mode: 'personal',
      agent_type: 'codex',
      user_nickname: 'Alice',
      user_phone: '13800138000',
      data: {
        turn_id: 'turn_1',
        session_id: 'session_1',
        model_id: 'gpt-4.1',
        model_provider: 'openai',
        input_tokens: 100,
        output_tokens: 800,
        total_tokens: 900,
        duration_ms: 1234,
        status: 'success',
      },
    });
    await reporter.flushAll();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(BATCH_URL);
    expect(fetchMock.mock.calls[0][1].headers['X-API-Key']).toBe(TEST_LOG_REPORT_KEY);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const [log] = body.logs;

    expect(log).toMatchObject({
      tenant_id: 'sudo',
      product: 'sudowork',
      topic: 'app',
      level: 'info',
      component: 'qms.telemetry.turn',
      session_id: 'session_1',
      trace_id: 'turn_1',
    });
    expect(log.tags).toMatchObject({
      sw_signal: 'telemetry',
      sw_event_type: 'turn',
      sw_agent_type: 'codex',
      sw_user_key: hash('user-123'),
      sw_user: 'Alice',
      sw_status: 'success',
      sw_model_id: 'gpt-4.1',
      sw_model_provider: 'openai',
      duration_ms: 1234,
      input_tokens: 100,
      output_tokens: 800,
      total_tokens: 900,
    });
    expect(log.attributes.qms_event.data.total_tokens).toBe(900);
  });

  it('keeps failed uploads in the telemetry cache without using the error-log cache', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: async () => ({ success: false }),
    });
    const { getSudoLogTelemetryReporter } = await import('@/process/telemetry/SudoLogTelemetryReporter');
    const reporter = getSudoLogTelemetryReporter();
    await reporter.initialize(true);
    reporter.enqueueTelemetryEvent({
      type: 'perf',
      timestamp: 1781654400000,
      version: '9.9.9-test',
      platform: 'darwin',
      arch: 'arm64',
      user_id: 'user-123',
      tenant_id: 'sudo',
      login_mode: 'personal',
      user_phone: '13800138000',
      data: { metric: 'first_token', value_ms: 456, session_id: 'session_1' },
    });
    await reporter.flushAll();

    const telemetryCache = readFileSync(join(userDataDir, 'sudowork-log-telemetry-cache.json'), 'utf-8');
    expect(JSON.parse(telemetryCache)).toHaveLength(1);
  });
});
