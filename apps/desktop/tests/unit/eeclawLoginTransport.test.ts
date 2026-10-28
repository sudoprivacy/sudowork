import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILoginResponse, LoginGrant } from '@sudowork/common/authLogin';

type LoginHandler = (request: { serverUrl: string; body: LoginGrant; deviceId: string }) => Promise<ILoginResponse>;
const state = vi.hoisted(() => ({
  providers: new Map<string, LoginHandler>(),
  values: new Map<string, unknown>(),
  chromiumFetch: vi.fn(),
  set: vi.fn(),
  runtime: vi.fn(),
  warn: vi.fn(),
  authRequired: vi.fn(),
  clearRuntime: vi.fn(),
  cachedToken: vi.fn(),
}));

vi.mock('electron', () => ({ net: { fetch: state.chromiumFetch } }));
vi.mock('@/common', () => ({
  ipcBridge: {
    hostedTasks: new Proxy({}, { get: () => ({ provider: vi.fn() }) }),
    externalProviders: new Proxy({}, { get: () => ({ provider: vi.fn() }) }),
    eeclaw: new Proxy({}, { get: (_target, name: string) => ({ provider: (handler: LoginHandler) => state.providers.set(name, handler), emit: name === 'authRequired' ? state.authRequired : vi.fn() }) }),
  },
}));
vi.mock('@process/initStorage', () => ({ ProcessConfig: { getSync: (key: string) => state.values.get(key), set: state.set } }));
vi.mock('@process/utils/mainLogger', () => ({ mainWarn: state.warn, mainLog: vi.fn(), mainError: vi.fn() }));
vi.mock('@/common/enterpriseDebugConfig', () => ({
  setCachedAuthToken: state.cachedToken,
  setCachedServerUrl: vi.fn(),
  setCachedAppMode: vi.fn(),
  setCachedLocalModeAvailable: vi.fn(),
  setCachedSessionMode: vi.fn(),
}));
vi.mock('@process/services/mossLocalRuntime', () => ({ applyMossLocalRuntime: state.runtime, prepareMossLocalRuntime: vi.fn(), clearMossLocalRuntime: state.clearRuntime }));
vi.mock('@process/providers', () => ({ resetConversationProvider: vi.fn() }));

import { getValidToken, initEeclawBridge } from '@process/bridge/eeclawBridge';

const auth = {
  access_token: 'private-test-token',
  refresh_token: 'private-test-refresh',
  expires_in: 3600,
  user: { id: 'user-1', name: 'User', role: 'USER', orgId: 'org-1', localAuth: false },
  execution: { isLocalAllowed: true, isRemoteAllowed: true, defaultTarget: 'local' },
  localRuntime: { userId: 'user-1', organizationId: 'org-1', status: 'ready' },
};
const phone: LoginGrant = { grant_type: 'phone', phone: '13800000000', code: '123456' };
const invoke = (body = phone) => state.providers.get('login')!({ serverUrl: 'https://moss.example', body, deviceId: 'test-device' });

beforeEach(() => {
  vi.resetAllMocks();
  state.values.clear();
  state.set.mockImplementation(async (key: string, value: unknown) => state.values.set(key, value));
  state.runtime.mockResolvedValue({ execution: auth.execution, localRuntime: auth.localRuntime });
  state.chromiumFetch.mockResolvedValue(new Response(JSON.stringify({ success: true, data: auth })));
  // Direct Node networking is unavailable when only the system proxy reaches Moss.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Direct connection unavailable')));
  initEeclawBridge();
});
afterEach(() => vi.unstubAllGlobals());

describe('desktop authentication transport', () => {
  it.each(['runtime', 'identity-persistence', 'runtime-cleanup'])('requires reauthentication after a partially applied enterprise selection fails at %s', async (scenario) => {
    await invoke();
    const selected = { ...auth, access_token: 'company-access', user: { ...auth.user, id: 'company-member', orgId: 'company' } };
    state.chromiumFetch.mockResolvedValueOnce(new Response(JSON.stringify({ organizations: [{ id: 'company', name: 'Company', userId: 'company-member', role: 'user' }] }))).mockResolvedValueOnce(new Response(JSON.stringify(selected)));
    if (scenario === 'identity-persistence') {
      state.set.mockImplementation(async (key: string, value: unknown) => {
        if (key === 'eeclaw.userInfo' && value) throw new Error('Storage write failed');
        state.values.set(key, value);
      });
    } else state.runtime.mockRejectedValueOnce(new Error('Local runtime unavailable'));
    if (scenario === 'runtime-cleanup') state.clearRuntime.mockRejectedValueOnce(new Error('Cleanup failed'));
    expect(await invoke({ grant_type: 'organization', orgId: 'company' })).toMatchObject({ success: false, error: 'local_setup_failed' });
    expect(state.values.get('eeclaw.authStorage')).toBeNull();
    expect(state.values.get('eeclaw.userInfo')).toBeNull();
    expect(state.values.get('eeclaw.localModeAvailable')).toBeNull();
    expect(state.cachedToken).toHaveBeenLastCalledWith('');
    expect(state.clearRuntime).toHaveBeenCalledTimes(1);
    expect(state.authRequired).toHaveBeenCalledWith({ reason: 'organization_switch_failed' });
  });

  it('selects a verified membership on the saved host and persists its independent identity', async () => {
    await invoke();
    const selected = {
      ...auth,
      access_token: 'company-access',
      refresh_token: 'company-refresh',
      user: { ...auth.user, id: 'company-member', orgId: 'company', role: 'user' },
      execution: { ...auth.execution, isLocalAllowed: false },
      localRuntime: { ...auth.localRuntime, userId: 'company-member', organizationId: 'company', status: 'policy_denied' },
    };
    state.runtime.mockResolvedValue({ execution: selected.execution, localRuntime: selected.localRuntime });
    state.chromiumFetch
      .mockClear()
      .mockResolvedValueOnce(new Response(JSON.stringify({ organizations: [{ id: 'company', name: 'Company', userId: 'company-member', role: 'user' }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify(selected)));
    const result = await state.providers.get('login')!({ serverUrl: 'https://attacker.example', body: { grant_type: 'organization', orgId: 'company' }, deviceId: 'test-device' });
    expect(result).toMatchObject({ success: true, data: { user: selected.user } });
    expect(state.chromiumFetch.mock.calls.map((call) => call[0])).toEqual(['https://moss.example/api/v1/auth/organizations', 'https://moss.example/api/v1/auth/switch-org']);
    expect(state.chromiumFetch.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${auth.access_token}`);
    expect(JSON.parse(state.chromiumFetch.mock.calls[1][1].body)).toEqual({ org_id: 'company' });
    expect(state.values.get('eeclaw.userInfo')).toMatchObject({ id: 'company-member', orgId: 'company', role: 'user' });
    expect(state.values.get('eeclaw.authStorage')).toMatchObject({ access_token: 'company-access', refresh_token: 'company-refresh' });
  });

  it.each(['missing-membership', 'wrong-returned-identity'])('rejects %s without replacing the saved identity', async (scenario) => {
    await invoke();
    state.set.mockClear();
    state.chromiumFetch
      .mockClear()
      .mockResolvedValueOnce(new Response(JSON.stringify({ organizations: scenario === 'missing-membership' ? [] : [{ id: 'company', name: 'Company', userId: 'company-member', role: 'user' }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify(auth)));
    expect(await invoke({ grant_type: 'organization', orgId: 'company' })).toMatchObject({ success: false, error: 'auth_request_rejected' });
    expect(state.set).not.toHaveBeenCalled();
    expect(state.values.get('eeclaw.authStorage')).toMatchObject({ access_token: auth.access_token });
  });

  it('does not overwrite a newer login when enterprise selection finishes late', async () => {
    await invoke();
    state.set.mockClear();
    let finish!: (response: Response) => void;
    state.chromiumFetch
      .mockClear()
      .mockResolvedValueOnce(new Response(JSON.stringify({ organizations: [{ id: 'company', name: 'Company', userId: 'company-member', role: 'user' }] })))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
    const pending = invoke({ grant_type: 'organization', orgId: 'company' });
    await vi.waitFor(() => expect(state.chromiumFetch).toHaveBeenCalledTimes(2));
    state.values.set('eeclaw.authStorage', { access_token: 'newer-login' });
    finish(new Response(JSON.stringify({ ...auth, user: { ...auth.user, id: 'company-member', orgId: 'company' } })));
    expect(await pending).toMatchObject({ success: false });
    expect(state.values.get('eeclaw.authStorage')).toEqual({ access_token: 'newer-login' });
    expect(state.set).not.toHaveBeenCalled();
  });
  it.each<LoginGrant>([
    phone,
    { ...phone, grant_type: 'phone_register', nickname: 'User', invitation_code: 'INVITE' },
    { grant_type: 'password', username: 'test', password: 'private-test-password' },
    { grant_type: 'api_key', api_key: 'private-test-key' },
    { grant_type: 'oauth2', params: { code: 'private-test-code' } },
  ])('authenticates $grant_type through the renderer-compatible Chromium network stack', async (body) => {
    expect(await invoke(body)).toMatchObject({ success: true, data: { user: auth.user } });
    const [url, options] = state.chromiumFetch.mock.calls[0];
    expect(url).toBe(`https://moss.example/api/v1/auth/${body.grant_type === 'phone_register' ? 'register' : 'login'}`);
    expect(options).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'test-device' }, signal: expect.any(AbortSignal) });
    expect(JSON.parse(options.body)).toEqual(body);
    expect(fetch).not.toHaveBeenCalled();
    expect(state.values.get('eeclaw.authStorage')).toMatchObject({ access_token: auth.access_token });
  });

  it('refreshes the saved identity through the same network stack', async () => {
    await invoke();
    state.chromiumFetch.mockResolvedValue(new Response(JSON.stringify({ ...auth, access_token: 'refreshed-token' })));
    expect(await getValidToken(true)).toBe('refreshed-token');
    expect(state.chromiumFetch).toHaveBeenLastCalledWith('https://moss.example/api/v1/auth/token', expect.objectContaining({ method: 'POST' }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps credential rejection distinct from connection failure', async () => {
    state.chromiumFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_code', msg: 'Code expired' }), { status: 401 }));
    expect(await invoke()).toMatchObject({ success: false, error: 'invalid_code', msg: 'Code expired' });
    expect(state.set).not.toHaveBeenCalled();
  });

  it('surfaces a native Moss policy rejection instead of the invalid-credentials fallback', async () => {
    const message = 'Current organization does not allow phone code login';
    state.chromiumFetch.mockResolvedValue(new Response(JSON.stringify({ error: message }), { status: 403 }));
    expect(await invoke({ ...phone, grant_type: 'phone_register', nickname: 'User', invitation_code: 'INVITE' })).toMatchObject({
      success: false,
      error: 'auth_request_rejected',
      msg: message,
    });
    expect(state.set).not.toHaveBeenCalled();
  });

  it('keeps an error-only machine code out of the user-facing message', async () => {
    state.chromiumFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_code' }), { status: 401 }));
    expect(await invoke()).toEqual({ success: false, error: 'invalid_code', data: undefined });
    expect(state.set).not.toHaveBeenCalled();
  });

  it('identifies a transport failure without logging credentials or arbitrary error text', async () => {
    state.chromiumFetch.mockRejectedValue(new Error('net::ERR_PROXY_CONNECTION_FAILED private-test-token'));
    expect(await invoke()).toMatchObject({ success: false, error: 'network_error' });
    expect(state.warn).toHaveBeenCalledWith('eeclawBridge', 'login error:', { stage: 'request', name: 'Error', networkCode: 'ERR_PROXY_CONNECTION_FAILED' });
    expect(JSON.stringify(state.warn.mock.calls)).not.toContain('private-test-token');
    expect(state.set).not.toHaveBeenCalled();
  });

  it.each(['TimeoutError', 'AbortError'])('preserves HTTP deadline failure (%s) for the shared login flow', async (name) => {
    state.chromiumFetch.mockRejectedValue(new DOMException('Request deadline exceeded', name));
    expect(await invoke()).toMatchObject({ success: false, error: 'request_timeout' });
  });

  it('identifies a non-JSON response before writing authentication state', async () => {
    state.chromiumFetch.mockResolvedValue(new Response('<html>Upstream unavailable</html>', { status: 502 }));
    expect(await invoke()).toMatchObject({ success: false, error: 'invalid_response' });
    expect(state.set).not.toHaveBeenCalled();
  });

  it('rejects a retired consumer response before persisting an unusable session', async () => {
    state.chromiumFetch.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { ...auth, user: { id: 123, nickname: 'Legacy User' } } })));
    expect(await invoke()).toMatchObject({ success: false, error: 'invalid_response' });
    expect(state.set).not.toHaveBeenCalled();
    expect(state.warn).toHaveBeenCalledWith('eeclawBridge', 'login error:', { stage: 'response', name: 'InvalidLoginIdentity' });
  });

  it('does not label a local persistence failure as a network problem', async () => {
    state.set.mockRejectedValue(new Error('Read-only filesystem'));
    expect(await invoke()).toMatchObject({ success: false, error: 'local_setup_failed' });
    expect(state.warn).toHaveBeenCalledWith('eeclawBridge', 'login error:', expect.objectContaining({ stage: 'persistence' }));
  });

  it('identifies a local runtime failure after the server has authenticated', async () => {
    state.runtime.mockRejectedValue(new Error('Invalid local model configuration'));
    expect(await invoke()).toMatchObject({ success: false, error: 'local_setup_failed' });
    expect(state.warn).toHaveBeenCalledWith('eeclawBridge', 'login error:', expect.objectContaining({ stage: 'local-runtime' }));
  });
});
