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

  it('offline + persisted confirmed-true → enabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );
    getSyncMock.mockImplementation((key: string) => {
      if (key === 'eeclaw.serverUrl') return 'http://moss.example';
      if (key === 'eeclaw.tenantConfig') return { client_cron_enabled: true, cron_confirmed: true };
      return undefined;
    });

    const { getClientCronEnabled } = await import('@/process/services/cron/cronPolicy');
    expect(await getClientCronEnabled()).toBe(true);
  });

  it('offline + persisted confirmed-false → disabled (honors prior disable)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );
    getSyncMock.mockImplementation((key: string) => {
      if (key === 'eeclaw.serverUrl') return 'http://moss.example';
      if (key === 'eeclaw.tenantConfig') return { client_cron_enabled: false, cron_confirmed: true };
      return undefined;
    });

    const { getClientCronEnabled } = await import('@/process/services/cron/cronPolicy');
    expect(await getClientCronEnabled()).toBe(false);
  });

  it('FAIL-CLOSED: offline with nothing persisted → disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );

    const { getClientCronEnabled } = await import('@/process/services/cron/cronPolicy');
    expect(await getClientCronEnabled()).toBe(false);
  });

  it('FAIL-CLOSED: offline with a stale config lacking the confirmed marker → disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );
    getSyncMock.mockImplementation((key: string) => {
      if (key === 'eeclaw.serverUrl') return 'http://moss.example';
      // legacy/stale record with no cron_confirmed marker, flag defaulted true
      if (key === 'eeclaw.tenantConfig') return { client_cron_enabled: true };
      return undefined;
    });

    const { getClientCronEnabled } = await import('@/process/services/cron/cronPolicy');
    expect(await getClientCronEnabled()).toBe(false);
  });
});

describe('cronPolicy admin capability (isCronAdminUser / isCronSkillAllowed)', () => {
  beforeEach(async () => {
    const { resetCronPolicyCache } = await import('@/process/services/cron/cronPolicy');
    resetCronPolicyCache();
    isEnterpriseModeMock.mockReturnValue(true);
    getSyncMock.mockImplementation((key: string) => (key === 'eeclaw.serverUrl' ? 'http://moss.example' : undefined));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubUserRole(role: string | undefined) {
    getSyncMock.mockImplementation((key: string) => {
      if (key === 'eeclaw.serverUrl') return 'http://moss.example';
      if (key === 'eeclaw.userInfo') return role ? { id: 'u1', username: 'u', role } : undefined;
      return undefined;
    });
  }

  it('isCronAdminUser: true for the moss admin/super_admin roles, false otherwise (fail closed)', async () => {
    const { isCronAdminUser } = await import('@/process/services/cron/cronPolicy');

    stubUserRole('admin');
    expect(isCronAdminUser()).toBe(true);
    stubUserRole('super_admin');
    expect(isCronAdminUser()).toBe(true);
    stubUserRole('dept_admin');
    expect(isCronAdminUser()).toBe(false);
    stubUserRole('user');
    expect(isCronAdminUser()).toBe(false);
    stubUserRole(undefined);
    expect(isCronAdminUser()).toBe(false);
  });

  it('isCronSkillAllowed: admin keeps the full cron skill while the org flag is off', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => tenantResponse(false))
    );
    stubUserRole('admin');

    const { isCronSkillAllowed } = await import('@/process/services/cron/cronPolicy');
    expect(await isCronSkillAllowed()).toBe(true);
  });

  it('isCronSkillAllowed: non-admin loses the full skill while the org flag is off', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => tenantResponse(false))
    );
    stubUserRole('user');

    const { isCronSkillAllowed } = await import('@/process/services/cron/cronPolicy');
    expect(await isCronSkillAllowed()).toBe(false);
  });
});

describe('handleCronCommands org-policy refusal + provider routing (issues #854/#835)', () => {
  const createMessage = () =>
    ({
      id: 'msg-1',
      conversation_id: 'conv-1',
      type: 'content',
      status: 'finish',
      content: { content: '[CRON_CREATE]\nname: T\nschedule: 0 9 * * *\nschedule_description: daily\nmessage: hi\n[/CRON_CREATE]' },
    }) as never;

  function mockCommon() {
    vi.doMock('@/common', () => ({
      ipcBridge: { cron: { onJobCreated: { emit: vi.fn() }, onJobRemoved: { emit: vi.fn() } } },
    }));
  }

  function mockCronPolicy({ enabled, admin = false }: { enabled: boolean; admin?: boolean }) {
    vi.doMock('@process/services/cron/cronPolicy', () => ({
      getClientCronEnabled: vi.fn(async () => enabled),
      isCronAdminUser: vi.fn(() => admin),
    }));
  }

  it('refuses all cron commands with an explicit message when disabled on a non-remote provider', async () => {
    vi.resetModules();
    const addJobMock = vi.fn();
    vi.doMock('@process/providers/cron', () => ({
      getCronProvider: () => ({ type: 'local', addJob: addJobMock, listJobs: vi.fn(async () => []), removeJob: vi.fn() }),
    }));
    mockCronPolicy({ enabled: false });
    mockCommon();

    const { processAgentResponse } = await import('@/process/task/MessageMiddleware');
    const result = await processAgentResponse('conv-1', 'scode', createMessage());

    expect(result.systemResponses.join('\n')).toContain('disabled by your organization');
    expect(addJobMock).not.toHaveBeenCalled();
  });

  it('routes create through getCronProvider (not the local cronService) when enabled', async () => {
    vi.resetModules();
    const addJobMock = vi.fn(async () => ({ id: 'cron_x', name: 'T' }));
    vi.doMock('@process/providers/cron', () => ({
      getCronProvider: () => ({ addJob: addJobMock, listJobs: vi.fn(async () => []), removeJob: vi.fn() }),
    }));
    mockCronPolicy({ enabled: true });
    mockCommon();

    const { processAgentResponse } = await import('@/process/task/MessageMiddleware');
    const result = await processAgentResponse('conv-1', 'scode', createMessage());

    expect(addJobMock).toHaveBeenCalledTimes(1);
    expect(result.systemResponses.join('\n')).toContain('Scheduled task created');
  });

  it('with the remote provider and cron disabled: refuses CREATE only, without touching the provider', async () => {
    vi.resetModules();
    const addJobMock = vi.fn();
    vi.doMock('@process/providers/cron', () => ({
      getCronProvider: () => ({ type: 'remote', addJob: addJobMock, listJobs: vi.fn(async () => []), removeJob: vi.fn() }),
    }));
    mockCronPolicy({ enabled: false });
    mockCommon();

    const { processAgentResponse } = await import('@/process/task/MessageMiddleware');
    const result = await processAgentResponse('conv-1', 'scode', createMessage());

    const text = result.systemResponses.join('\n');
    expect(text).toContain('Creating scheduled tasks is disabled by your organization');
    expect(addJobMock).not.toHaveBeenCalled();
  });

  it('with the remote provider and cron disabled: an admin-capable user may still CREATE (moss allows it)', async () => {
    vi.resetModules();
    const addJobMock = vi.fn(async () => ({ id: 'cron_admin', name: 'T' }));
    vi.doMock('@process/providers/cron', () => ({
      getCronProvider: () => ({ type: 'remote', addJob: addJobMock, listJobs: vi.fn(async () => []), removeJob: vi.fn() }),
    }));
    mockCronPolicy({ enabled: false, admin: true });
    mockCommon();

    const { processAgentResponse } = await import('@/process/task/MessageMiddleware');
    const result = await processAgentResponse('conv-1', 'scode', createMessage());

    expect(addJobMock).toHaveBeenCalledTimes(1);
    expect(result.systemResponses.join('\n')).toContain('Scheduled task created');
  });

  it('with the remote provider and cron disabled: CRON_LIST still lists the user-scoped jobs', async () => {
    vi.resetModules();
    const listJobsMock = vi.fn(async () => [
      {
        id: 'cron_own',
        name: 'My report',
        enabled: true,
        schedule: { kind: 'cron', expr: '0 9 * * *', description: 'daily' },
        target: { payload: { kind: 'message', text: 'go' } },
        metadata: { conversationId: 'conv-9', agentType: 'remote-agent', createdBy: 'user', createdAt: 0, updatedAt: 0 },
        state: { runCount: 0 },
      },
    ]);
    vi.doMock('@process/providers/cron', () => ({
      getCronProvider: () => ({ type: 'remote', addJob: vi.fn(), listJobs: listJobsMock, removeJob: vi.fn() }),
    }));
    mockCronPolicy({ enabled: false });
    mockCommon();

    const { processAgentResponse } = await import('@/process/task/MessageMiddleware');
    const result = await processAgentResponse('conv-1', 'scode', {
      id: 'msg-1',
      conversation_id: 'conv-1',
      type: 'content',
      status: 'finish',
      content: { content: '[CRON_LIST]' },
    } as never);

    expect(listJobsMock).toHaveBeenCalledTimes(1);
    const text = result.systemResponses.join('\n');
    expect(text).toContain('My report');
    expect(text).toContain('cron_own');
  });

  it('with the remote provider and cron disabled: CRON_DELETE reaches the server, which enforces ownership', async () => {
    vi.resetModules();
    const removeJobMock = vi.fn(async (jobId: string) => {
      if (jobId !== 'cron_own') {
        throw new Error('Failed to delete cron job: 403 Access denied');
      }
    });
    vi.doMock('@process/providers/cron', () => ({
      getCronProvider: () => ({ type: 'remote', addJob: vi.fn(), listJobs: vi.fn(async () => []), removeJob: removeJobMock }),
    }));
    mockCronPolicy({ enabled: false });
    mockCommon();

    const { processAgentResponse } = await import('@/process/task/MessageMiddleware');
    const deleteMessage = (jobId: string) =>
      ({
        id: 'msg-1',
        conversation_id: 'conv-1',
        type: 'content',
        status: 'finish',
        content: { content: `[CRON_DELETE: ${jobId}]` },
      }) as never;

    const owned = await processAgentResponse('conv-1', 'scode', deleteMessage('cron_own'));
    expect(owned.systemResponses.join('\n')).toContain('Task deleted: cron_own');

    const foreign = await processAgentResponse('conv-1', 'scode', deleteMessage('cron_other'));
    const text = foreign.systemResponses.join('\n');
    expect(text).toContain('Access denied');
    expect(text).not.toContain('Task deleted: cron_other');
  });

  it('surfaces a provider failure (e.g. moss 403) as an error, not a false success', async () => {
    vi.resetModules();
    const addJobMock = vi.fn(async () => {
      throw new Error('Failed to create cron jobs: 403 {"error":"cron_disabled_by_org"}');
    });
    vi.doMock('@process/providers/cron', () => ({
      getCronProvider: () => ({ addJob: addJobMock, listJobs: vi.fn(async () => []), removeJob: vi.fn() }),
    }));
    // Gate enabled (e.g. stale-true locally) so we exercise the provider path.
    mockCronPolicy({ enabled: true });
    mockCommon();

    const { processAgentResponse } = await import('@/process/task/MessageMiddleware');
    const result = await processAgentResponse('conv-1', 'scode', createMessage());

    const text = result.systemResponses.join('\n');
    expect(text).toContain('cron_disabled_by_org');
    expect(text).not.toContain('Scheduled task created');
  });
});
