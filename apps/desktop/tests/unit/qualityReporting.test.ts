import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getQualityReportUrl, getLogReportBaseUrl, fetchSystemConfig, bootstrapClientReporting, getSystemConfigCache, setSystemConfigCache } from '@sudowork/common/systemConfig';
import { setCredentialsCache } from '@/process/credentialsCache';

vi.mock('@/process/database', () => ({ getDatabase: () => ({ getConversation: () => ({ success: false }) }) }));
vi.mock('@/process/initStorage', () => ({
  ProcessConfig: { get: vi.fn(async () => undefined), getSync: vi.fn((key: string) => (key === 'system.appMode' ? 'c' : key === 'consumer.userInfo' ? { id: 'client-user', tenant_id: 'legacy-tenant' } : undefined)) },
  getSudoworkServerBaseUrlSync: () => 'https://legacy.invalid',
}));
vi.mock('@common/buildInfo', () => ({ buildVersion: '0.2.19' }));
vi.mock('@/process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));
vi.mock('@/process/telemetry/SudoLogTelemetryReporter', () => ({ getSudoLogTelemetryReporter: () => ({ enqueueTelemetryEvent: vi.fn(), enqueueCrashEvent: vi.fn() }) }));

let server: Server | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  setCredentialsCache(null);
  setSystemConfigCache(null);
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});
beforeEach(() => setSystemConfigCache(null));

describe('quality reporting cutover', () => {
  it('keeps organization login discovery separate from authenticated reporting and its cache', async () => {
    const existing = { product_improvement: { enabled: 1, tenant_id: 'SIGNED-IN-ORG' } };
    setSystemConfigCache(existing);
    const discovered = { login_method: 0, product_improvement: { enabled: 0 } };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => ({ success: true, data: discovered }) }))
    );
    expect(await fetchSystemConfig('https://moss.test', 'https://custom.test', ' ORG-B ')).toEqual(discovered);
    const [request, options] = vi.mocked(fetch).mock.calls[0];
    expect((request as URL).searchParams.get('organization_code')).toBe('ORG-B');
    expect((request as URL).searchParams.get('mossBaseUrl')).toBe('https://custom.test');
    expect(options).toBeUndefined();
    expect(getSystemConfigCache()).toEqual(existing);
    const controller = new AbortController();
    await fetchSystemConfig('https://moss.test', undefined, undefined, { accessToken: 'session-token', signal: controller.signal });
    expect((vi.mocked(fetch).mock.calls[1][0] as URL).searchParams.has('organization_code')).toBe(false);
    expect(vi.mocked(fetch).mock.calls[1][1]).toEqual({ headers: { Authorization: 'Bearer session-token' }, signal: controller.signal });
    expect(getSystemConfigCache()).toEqual(discovered);
  });

  it('bootstraps reporting with the current login token and applies policy before credentials', async () => {
    const calls: string[] = [];
    const config = { product_improvement: { enabled: 1 as const, tenant_id: 'MOSS-ORG' } };
    const fetchMock = vi.fn(async (url: URL) => ({ ok: true, json: async () => (url.pathname.endsWith('/credentials') ? { success: true, nonce: 'encrypted-nonce', ciphertext: 'encrypted-keys' } : { success: true, data: config }) }));
    vi.stubGlobal('fetch', fetchMock);
    const bridge = {
      syncConfig: vi.fn(async (data) => {
        expect(data).toEqual(config);
        calls.push('policy');
      }),
      cacheCredentials: vi.fn(async (envelope) => {
        expect(envelope).toEqual({ nonce: 'encrypted-nonce', ciphertext: 'encrypted-keys' });
        calls.push('credentials');
      }),
    };
    for (const accessToken of ['login-token', 'restored-token']) {
      await bootstrapClientReporting('https://moss.test', accessToken, bridge);
    }
    expect(calls).toEqual(['policy', 'credentials', 'policy', 'credentials']);
    expect(vi.mocked(fetch).mock.calls.map((call) => (call[1]?.headers as Record<string, string>).Authorization)).toEqual(['Bearer login-token', 'Bearer login-token', 'Bearer restored-token', 'Bearer restored-token']);
  });

  it('does not install credentials when the authenticated organization policy is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) => ({ ok: true, json: async () => (url.pathname.endsWith('/credentials') ? { success: true, nonce: 'nonce', ciphertext: 'keys' } : { success: false }) }))
    );
    const bridge = { syncConfig: vi.fn(), cacheCredentials: vi.fn() };
    await bootstrapClientReporting('https://moss.test', 'session-token', bridge);
    expect(bridge.syncConfig).not.toHaveBeenCalled();
    expect(bridge.cacheCredentials).not.toHaveBeenCalled();
  });

  it('switches telemetry and Crash together without changing ordinary logs or explicit local overrides', () => {
    setSystemConfigCache({ product_improvement: { enabled: 1, baseurl: 'https://moss.example.test/' }, log_report: { enabled: 1, baseurl: 'https://logs.example.test' } });
    expect(getQualityReportUrl('telemetry', 'https://legacy.test')).toBe('https://moss.example.test/api/v1/telemetry/batch');
    expect(getQualityReportUrl('crash', 'https://legacy.test')).toBe('https://moss.example.test/api/v1/crash/events/batch');
    expect(getLogReportBaseUrl()).toBe('https://logs.example.test');
    expect(getQualityReportUrl('crash', 'https://legacy.test', 'https://custom.test/api/v1/telemetry/batch')).toBe('https://custom.test/api/v1/crash/events/batch');
    setSystemConfigCache({ product_improvement: { enabled: 1 } });
    expect(getQualityReportUrl('telemetry', 'https://legacy.test/')).toBe('https://legacy.test/api/v1/telemetry/batch');
  });

  it('fetches the authenticated organization policy and uses its tenant code for native Moss accounts', async () => {
    const fetchMock = vi.fn(async (_url: unknown, _options?: unknown) => ({ json: async () => ({ success: true, data: { product_improvement: { enabled: 1, baseurl: 'https://moss.test', tenant_id: 'ORG-CODE' } } }) }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchSystemConfig('https://moss.test', undefined, undefined, { accessToken: 'session-token' });
    expect(fetchMock.mock.calls[0]).toEqual([new URL('https://moss.test/api/v1/system-config'), { headers: { Authorization: 'Bearer session-token' } }]);
    const { getUserContext } = await import('@/process/telemetry/UserContext');
    expect(getUserContext().tenant_id).toBe('ORG-CODE');
  });

  it('sends JSON with API key authentication even when an older policy requires hybrid encryption', async () => {
    const received: Array<{ path: string; key: string; encryptionHeader?: string; body: unknown }> = [];
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      received.push({ path: req.url!, key: String(req.headers['x-api-key']), encryptionHeader: req.headers['x-encryption'] as string | undefined, body: JSON.parse(Buffer.concat(chunks).toString()) });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, received: 1 }));
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test listener');
    const baseurl = `http://127.0.0.1:${address.port}`;
    const legacyCredentials = { product_improvement: { api_key: 'dispatched-test-key', public_key: 'unused-rsa-public-key' } };
    setCredentialsCache(legacyCredentials);
    const { TelemetryBatchReporter } = await import('@/process/telemetry/TelemetryBatchReporter');
    const { CrashReporter } = await import('@/process/telemetry/CrashReporter');
    interface Sender {
      sendBatch(value: unknown): Promise<{ success: boolean }>;
    }
    const telemetry = TelemetryBatchReporter.getInstance() as unknown as Sender;
    const crash = CrashReporter.getInstance() as unknown as Sender;
    const payload = { events: [{ type: 'perf', timestamp: Date.now(), data: { metric: 'cold_start', value_ms: 100 } }] };
    for (const isEncrypted of [false, true]) {
      const legacyPolicy = { product_improvement: { enabled: 1 as const, baseurl, encryption_required: isEncrypted } };
      setSystemConfigCache(legacyPolicy);
      expect((await telemetry.sendBatch(payload)).success).toBe(true);
      expect((await crash.sendBatch(payload)).success).toBe(true);
    }
    expect(received.map((row) => row.path)).toEqual(['/api/v1/telemetry/batch', '/api/v1/crash/events/batch', '/api/v1/telemetry/batch', '/api/v1/crash/events/batch']);
    expect(received.every((row) => row.encryptionHeader === undefined)).toBe(true);
    expect(received.every((row) => row.key === 'dispatched-test-key')).toBe(true);
    expect(received.every((row) => JSON.stringify(row.body) === JSON.stringify(payload))).toBe(true);
    setCredentialsCache(null);
    expect((await telemetry.sendBatch(payload)).success).toBe(false);
    expect((await crash.sendBatch(payload)).success).toBe(false);
    expect(received).toHaveLength(4);
  });

  it('preserves the telemetry event ID across retries', async () => {
    const { TelemetryBatchReporter } = await import('@/process/telemetry/TelemetryBatchReporter');
    const reporter = TelemetryBatchReporter.getInstance() as unknown as { toTelemetryEvent(value: unknown): { id: string } };
    const stored = { id: 'persistent-event', type: 'perf', timestamp: Date.now(), version: '1', platform: 'darwin', user_id: 'user', tenant_id: 'tenant', data: { metric: 'startup', value_ms: 1 } };
    expect(reporter.toTelemetryEvent(stored).id).toBe('persistent-event');
    expect(reporter.toTelemetryEvent(stored).id).toBe('persistent-event');
  });
});

it.skipIf(!process.env.QMS_CLIENT_TEST_URL)('runs the actual desktop reporters against the Moss QMS runtime and reads persisted quality data', async () => {
  const base = process.env.QMS_CLIENT_TEST_URL!;
  const { decryptCredentials } = await import('@sudowork/common/systemConfig');
  const config = await fetchSystemConfig(base, undefined, undefined, { accessToken: 'fixture-token' });
  expect(config?.product_improvement?.baseurl).toBe(base);
  const envelope = await (await fetch(`${base}/api/v1/system-config/credentials`, { headers: { Authorization: 'Bearer fixture-token' } })).json();
  setCredentialsCache(await decryptCredentials(envelope.nonce, envelope.ciphertext));
  const { TelemetryBatchReporter } = await import('@/process/telemetry/TelemetryBatchReporter');
  const { CrashReporter } = await import('@/process/telemetry/CrashReporter');
  interface Sender {
    sendBatch(value: unknown): Promise<{ success: boolean }>;
  }
  const telemetry = TelemetryBatchReporter.getInstance() as unknown as Sender;
  const crash = CrashReporter.getInstance() as unknown as Sender;
  const id = `desktop-integration-${Date.now()}`;
  const common = { timestamp: Date.now(), version: '0.2.19', platform: 'darwin', arch: 'arm64', user_id: id, tenant_id: config!.product_improvement!.tenant_id, login_mode: 'personal' };
  const batch = { events: [{ ...common, id, type: 'conversation', data: { session_id: id, model_id: 'desktop-test-model', status: 'success', duration_ms: 100, tokens_used: 42 } }] };
  expect((await telemetry.sendBatch(batch)).success).toBe(true);
  expect((await telemetry.sendBatch(batch)).success).toBe(true);
  expect((await crash.sendBatch({ events: [{ ...common, type: 'js_exception', process_type: 'renderer', error_name: 'DesktopIntegration', error_message: id, stack_trace: 'DesktopIntegration at app.js:1:1', context: { event_id: `${id}-crash` } }] })).success).toBe(true);
  const read = async (resource: string) => (await fetch(`${base}/api/moss/v1/operations/qms/${resource}`, { headers: { Authorization: 'Bearer fixture-token' } })).json();
  await vi.waitFor(
    async () => {
      const detail = await read(`user-stats/users/${id}`);
      expect(detail.data.conversations.conversation_count).toBe(1);
    },
    { timeout: 10000, interval: 200 }
  );
  const issues = await read('crash/issues');
  expect(issues.data.some((issue: { title: string }) => issue.title.includes(id))).toBe(true);
});
