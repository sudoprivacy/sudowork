import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSystemConfigCache } from '@sudowork/common/systemConfig';
import type { StoredTelemetryEvent } from '@/shared/types/telemetry';
import type { StoredCrashEvent } from '@/shared/types/crash';

const state = vi.hoisted(() => ({
  config: new Map<string, unknown>(),
  tasks: new Map<string, { id: string; type: string; extra?: { executionTarget?: string; backend?: string } }>(),
  history: [] as Array<{ id: string; type: string }>,
  files: new Map<string, string>(),
  telemetryMirror: vi.fn(),
  crashMirror: vi.fn(),
}));
vi.mock('electron', () => ({ app: { isPackaged: true, getPath: () => '/quality-test' } }));
vi.mock('node:fs/promises', () => ({
  default: {
    stat: vi.fn(async (path: string) => {
      if (!state.files.has(path)) throw new Error('ENOENT');
      return {};
    }),
    readFile: vi.fn(async (path: string) => state.files.get(path) ?? ''),
    writeFile: vi.fn(async (path: string, content: string) => {
      state.files.set(path, content);
    }),
    unlink: vi.fn(async (path: string) => {
      state.files.delete(path);
    }),
  },
}));
vi.mock('@/process/initStorage', () => ({
  ProcessConfig: {
    get: async (key: string) => state.config.get(key),
    getSync: (key: string) => state.config.get(key),
    set: async (key: string, value: unknown) => {
      state.config.set(key, value);
    },
  },
  ProcessChat: { getSync: () => state.history },
  getSudoworkServerBaseUrlSync: () => 'https://moss.test',
}));
vi.mock('@/process/database', () => ({ getDatabase: () => ({ getConversation: (id: string) => ({ data: state.tasks.get(id) }) }) }));
vi.mock('@common/buildInfo', () => ({ buildVersion: 'test' }));
vi.mock('@/process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));
vi.mock('@/process/credentialsCache', () => ({ getProductImprovementApiKey: () => 'qms-test-key' }));
vi.mock('@/process/telemetry/SudoLogTelemetryReporter', () => ({ getSudoLogTelemetryReporter: () => ({ enqueueTelemetryEvent: state.telemetryMirror, enqueueCrashEvent: state.crashMirror, setEnabled: async () => {} }) }));

import { isLocalQualityContext, isLocalQualityEvent, isLocalQualityTask } from '@/process/telemetry/executionScope';
import { getUserContext } from '@/process/telemetry/UserContext';
import { TelemetryBatchReporter } from '@/process/telemetry/TelemetryBatchReporter';
import { CrashReporter } from '@/process/telemetry/CrashReporter';

const jwt = (claims: Record<string, unknown>) => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
const localConversation = { session_id: 'local', status: 'success' as const, duration_ms: 10, model_id: 'test-model', tokens_used: 3 };
const telemetry = () => TelemetryBatchReporter.getInstance();
const crash = () => CrashReporter.getInstance();

beforeEach(() => {
  vi.clearAllMocks();
  state.config.clear();
  state.tasks.clear();
  state.history = [];
  state.files.clear();
  state.config.set('system.appMode', 'e');
  state.config.set('guid.sessionMode', 'remote');
  state.config.set('eeclaw.authStorage', { access_token: jwt({ sub: 'moss-user', org_id: 'org-uuid' }) });
  state.config.set('eeclaw.userInfo', { id: 'moss-user', username: 'Moss User', orgId: 'org-uuid' });
  state.config.set('consumer.userInfo', { id: 'stale-user', tenant_id: 'stale-tenant' });
  state.tasks.set('local', { id: 'local', type: 'acp', extra: { executionTarget: 'local' } });
  state.tasks.set('remote', { id: 'remote', type: 'remote-agent', extra: { executionTarget: 'remote' } });
  setSystemConfigCache({ product_improvement: { enabled: 1, tenant_id: 'ORG-CODE' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ success: true, received: 1 }) }))
  );
});

afterEach(async () => {
  await telemetry().setEnabled(false);
  await crash().setEnabled(false);
  // Reset singleton lifecycle to exercise actual initialization in every test.
  (TelemetryBatchReporter as unknown as { instance: null }).instance = null;
  (CrashReporter as unknown as { instance: null }).instance = null;
  setSystemConfigCache(null);
  vi.unstubAllGlobals();
});

describe('local task reporting scope', () => {
  it('uses the persisted task target and fails closed for unknown task IDs', () => {
    expect(isLocalQualityTask('local')).toBe(true);
    expect(isLocalQualityTask('remote')).toBe(false);
    expect(isLocalQualityTask('unknown')).toBe(false);
    state.tasks.set('local', { id: 'local', type: 'remote-agent', extra: { executionTarget: 'local' } });
    state.tasks.set('remote', { id: 'remote', type: 'acp', extra: { executionTarget: 'remote' } });
    expect(isLocalQualityTask('local')).toBe(true);
    expect(isLocalQualityTask('remote')).toBe(false);
    state.history = [
      { id: 'legacy-local', type: 'acp' },
      { id: 'legacy-remote', type: 'remote-agent' },
    ];
    expect(isLocalQualityTask('legacy-local')).toBe(true);
    expect(isLocalQualityTask('legacy-remote')).toBe(false);
    expect(isLocalQualityContext({ session_id: 'local', conversationId: 'remote' })).toBe(false);
  });

  it('reports all local task event types under unified login even when the homepage selects cloud', async () => {
    await telemetry().initialize();
    expect(telemetry().getStatus().enabled).toBe(true);
    for (const session_id of ['local', 'remote', 'unknown']) {
      telemetry().record('conversation', { ...localConversation, session_id });
      telemetry().record('turn', { session_id, turn_id: 'turn', status: 'success', duration_ms: 10 });
      telemetry().record('step', { session_id, turn_id: 'turn', step_id: 'step', step_type: 'thinking', status: 'success', duration_ms: 3 });
      telemetry().record('perf', { session_id, metric: 'first_token', value_ms: 4 });
    }
    expect(telemetry().getStatus().queueSize).toBe(4);
    expect(state.telemetryMirror).toHaveBeenCalledTimes(4);
    state.config.set('guid.sessionMode', 'local');
    telemetry().record('conversation', { ...localConversation, session_id: 'remote' });
    await telemetry().flushAll();
    const request = vi.mocked(fetch).mock.calls[0][1]!;
    const batch = JSON.parse(String(request.body));
    expect(batch.events).toHaveLength(4);
    expect(batch.events.every((event: StoredTelemetryEvent) => 'session_id' in event.data && event.data.session_id === 'local' && event.execution_target === 'local' && event.user_id === 'moss-user' && event.tenant_id === 'ORG-CODE')).toBe(true);
    expect(batch.events.every((event: StoredTelemetryEvent) => event.login_mode === undefined)).toBe(true);
  });

  it('keeps captured local events reportable after deletion but rejects cached cloud events', async () => {
    await telemetry().initialize();
    telemetry().record('conversation', localConversation);
    const snapshot = state.telemetryMirror.mock.calls[0][0];
    state.tasks.delete('local');
    expect(isLocalQualityEvent(snapshot)).toBe(true);
    const reporter = telemetry() as unknown as { eventQueue: StoredTelemetryEvent[] };
    reporter.eventQueue.push({ ...reporter.eventQueue[0], id: 'remote-cache', execution_target: undefined, data: { ...localConversation, session_id: 'remote' } });
    reporter.eventQueue.push({ ...reporter.eventQueue[0], id: 'explicit-remote-cache', execution_target: 'remote' });
    await telemetry().flushAll();
    const batch = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(batch.events).toHaveLength(1);
    expect(batch.events[0].id).toBe(snapshot.id);
  });

  it('filters old offline cache before reporting on restart', async () => {
    const common = { id: 'cached-local', storedAt: Date.now(), retryCount: 0, type: 'conversation', timestamp: Date.now(), user_id: 'moss-user', tenant_id: 'ORG-CODE', data: localConversation };
    state.files.set('/quality-test/telemetry-cache.json', JSON.stringify([common, { ...common, id: 'cached-cloud', data: { ...localConversation, session_id: 'remote' } }]));
    await telemetry().initialize();
    expect(telemetry().getStatus().queueSize).toBe(1);
    await telemetry().flushAll();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).events[0].id).toBe('cached-local');
  });

  it('preserves device startup metrics and respects user and server switches', async () => {
    state.config.set('telemetry.enabled', false);
    await telemetry().initialize();
    telemetry().record('conversation', localConversation);
    expect(telemetry().getStatus().queueSize).toBe(0);
    await telemetry().setEnabled(true);
    telemetry().record('perf', { metric: 'cold_start', value_ms: 20 });
    expect(telemetry().getStatus().queueSize).toBe(1);
    setSystemConfigCache({ product_improvement: { enabled: 0 } });
    telemetry().record('conversation', localConversation);
    await telemetry().flushAll();
    expect(fetch).not.toHaveBeenCalled();
    expect(telemetry().getStatus().queueSize).toBe(0);
  });
});

describe('unified reporting identity', () => {
  it.each(['e', 'c', undefined])('uses the Moss principal regardless of obsolete app mode %s', (mode) => {
    state.config.set('system.appMode', mode);
    expect(getUserContext()).toEqual({ user_id: 'moss-user', org_id: 'org-uuid', tenant_id: 'ORG-CODE', user_nickname: 'Moss User' });
  });

  it('does not combine a current JWT with a stale profile or consumer identity', () => {
    state.config.set('eeclaw.userInfo', { id: 'old-user', username: 'Old User', orgId: 'old-org' });
    expect(getUserContext()).toMatchObject({ user_id: 'moss-user', org_id: 'org-uuid', tenant_id: 'ORG-CODE' });
    expect(getUserContext().user_nickname).toBeUndefined();
    state.config.delete('eeclaw.authStorage');
    expect(getUserContext()).toEqual({});
  });
});

describe('local crash reporting', () => {
  it('filters cloud exceptions and breadcrumbs before both the QMS queue and log mirror', async () => {
    await crash().initialize();
    crash().addBreadcrumb('task', 'cloud', { conversationId: 'remote' });
    crash().addBreadcrumb('task', 'local', { conversation_id: 'local' });
    crash().captureException(new Error('remote failure'), { session_id: 'remote' });
    crash().captureRendererException({ error_name: 'Remote', error_message: 'remote', context: { conversationId: 'remote' } });
    crash().captureException(new Error('unknown task'), { session_id: 'unknown' });
    expect(state.crashMirror).not.toHaveBeenCalled();
    crash().captureException(new Error('local failure'), { session_id: 'local' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(state.crashMirror).toHaveBeenCalledTimes(1);
    expect(state.crashMirror.mock.calls[0][0].context.breadcrumbs.map((item: { message: string }) => item.message)).toEqual(['local']);
    expect(state.crashMirror.mock.calls[0][0].execution_target).toBe('local');
  });

  it('retains client process crashes but never captures after opt-out', async () => {
    await crash().initialize();
    crash().captureNativeCrash({ reason: 'crashed' }, 'main');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await crash().setEnabled(false);
    crash().captureException(new Error('opted out'), { session_id: 'local' });
    crash().captureRendererCrash({ reason: 'crashed', exitCode: 1 });
    expect(state.crashMirror).toHaveBeenCalledTimes(1);
    expect((crash() as unknown as { cachedEvents: StoredCrashEvent[] }).cachedEvents).toHaveLength(0);
  });
});
