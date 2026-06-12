/**
 * Tests for issue #854: main-process enforcement of the enterprise
 * client_cron_enabled tenant flag. Covers the policy resolver (TTL cache,
 * offline fallback, consumer-mode bypass) and the agent-facing refusal in
 * handleCronCommands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const isEnterpriseModeMock = vi.fn(() => true);
const getSyncMock = vi.fn((key: string): unknown => (key === 'eeclaw.serverUrl' ? 'http://moss.example' : undefined));
const setMock = vi.fn(async () => undefined);

vi.mock('@/common/enterpriseDebugConfig', () => ({
  isEnterpriseMode: () => isEnterpriseModeMock(),
}));

vi.mock('@process/initStorage', () => ({
  ProcessConfig: {
    getSync: (key: string) => getSyncMock(key),
    set: (key: string, value: unknown) => setMock(),
  },
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainError: vi.fn(),
  mainWarn: vi.fn(),
}));

function tenantResponse(cronEnabled: boolean | null) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: { client_cron_enabled: cronEnabled } }),
  };
}

describe('cronPolicy.getClientCronEnabled (issue #854)', () => {
  beforeEach(async () => {
    const { resetCronPolicyCache } = await import('@/process/services/cron/cronPolicy');
    resetCronPolicyCache();
    isEnterpriseModeMock.mockReturnValue(true);
    getSyncMock.mockImplementation((key: string) => (key === 'eeclaw.serverUrl' ? 'http://moss.example' : undefined));
    setMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('always enabled in consumer mode, without fetching', async () => {
    isEnterpriseModeMock.mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { getClientCronEnabled } = await import('@/process/services/cron/cronPolicy');
    expect(await getClientCronEnabled()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the flag from the tenant config and persists it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => tenantResponse(false))
    );

    const { getClientCronEnabled } = await import('@/process/services/cron/cronPolicy');
    expect(await getClientCronEnabled()).toBe(false);
    expect(setMock).toHaveBeenCalled();
  });

  it('caches the result within the TTL', async () => {
    const fetchMock = vi.fn(async () => tenantResponse(true));
    vi.stubGlobal('fetch', fetchMock);

    const { getClientCronEnabled } = await import('@/process/services/cron/cronPolicy');
    await getClientCronEnabled();
    await getClientCronEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the last persisted value when the server is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );
    getSyncMock.mockImplementation((key: string) => {
      if (key === 'eeclaw.serverUrl') return 'http://moss.example';
      if (key === 'eeclaw.tenantConfig') return { client_cron_enabled: false };
      return undefined;
    });

    const { getClientCronEnabled } = await import('@/process/services/cron/cronPolicy');
    expect(await getClientCronEnabled()).toBe(false);
  });

  it('defaults to enabled when unreachable with nothing persisted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );

    const { getClientCronEnabled } = await import('@/process/services/cron/cronPolicy');
    expect(await getClientCronEnabled()).toBe(true);
  });
});

describe('handleCronCommands org-policy refusal (issue #854)', () => {
  it('refuses all cron commands with an explicit message when disabled', async () => {
    vi.resetModules();
    const addJobMock = vi.fn();
    vi.doMock('@process/services/cron/CronService', () => ({
      cronService: { addJob: addJobMock, listJobs: vi.fn(async () => []), removeJob: vi.fn() },
    }));
    vi.doMock('@process/services/cron/cronPolicy', () => ({
      getClientCronEnabled: vi.fn(async () => false),
    }));
    vi.doMock('@/common', () => ({
      ipcBridge: { cron: { onJobCreated: { emit: vi.fn() }, onJobRemoved: { emit: vi.fn() } } },
    }));

    const { processAgentResponse } = await import('@/process/task/MessageMiddleware');
    const message = {
      id: 'msg-1',
      conversation_id: 'conv-1',
      type: 'content',
      status: 'finish',
      content: { content: '[CRON_CREATE]\nname: T\nschedule: 0 9 * * *\nschedule_description: daily\nmessage: hi\n[/CRON_CREATE]' },
    } as never;

    const result = await processAgentResponse('conv-1', 'scode', message);

    expect(result.systemResponses.join('\n')).toContain('disabled by your organization');
    expect(addJobMock).not.toHaveBeenCalled();
  });
});
