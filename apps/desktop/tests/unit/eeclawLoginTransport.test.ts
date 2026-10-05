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
}));

vi.mock('electron', () => ({ net: { fetch: state.chromiumFetch } }));
vi.mock('@/common', () => ({
  ipcBridge: {
    eeclaw: new Proxy({}, { get: (_target, name: string) => ({ provider: (handler: LoginHandler) => state.providers.set(name, handler), emit: vi.fn() }) }),
  },
}));
vi.mock('@process/initStorage', () => ({ ProcessConfig: { getSync: (key: string) => state.values.get(key), set: state.set } }));
vi.mock('@process/utils/mainLogger', () => ({ mainWarn: state.warn, mainLog: vi.fn(), mainError: vi.fn() }));
vi.mock('@/common/enterpriseDebugConfig', () => ({
  setCachedAuthToken: vi.fn(),
  setCachedServerUrl: vi.fn(),
  setCachedAppMode: vi.fn(),
  setCachedLocalModeAvailable: vi.fn(),
  setCachedSessionMode: vi.fn(),
}));
vi.mock('@process/services/mossLocalRuntime', () => ({ applyMossLocalRuntime: state.runtime, prepareMossLocalRuntime: vi.fn(), clearMossLocalRuntime: vi.fn() }));
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
