import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runLogin, type IAuthenticatedLogin, type ILoginPort, type ILoginResponse, type LoginRequest } from '@sudowork/common/authLogin';

const mocks = vi.hoisted(() => ({ login: vi.fn(), server: vi.fn() }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ eeclaw: { login: { invoke: mocks.login } } }));
vi.mock('@sudowork/host-bridge/authServer', () => ({ getAuthServerBaseUrl: mocks.server }));
import { desktopLoginPort, webLoginPort } from '@sudowork/host-bridge/authLogin';

const data: IAuthenticatedLogin = {
  access_token: 'test-token',
  refresh_token: 'test-refresh',
  expires_in: 3600,
  user: { id: 'user-1', name: 'User', role: 'USER', orgId: 'org-1', localAuth: true },
  models: ['model'],
  sudorouter_key: 'test-model-key',
  model_service_url: 'https://models.example/v1',
};
const phone: LoginRequest = { grant_type: 'phone', phone: '13800138000', code: '123456' };
const grants: Array<{ request: LoginRequest; path: string; body: Record<string, string>; sessionType: string }> = [
  { request: phone, path: '/api/auth/login/phone', body: { phone: '13800138000', code: '123456' }, sessionType: 'phone' },
  { request: { ...phone, grant_type: 'phone_register', nickname: 'New User', invitation_code: 'INVITE' }, path: '/api/auth/register/phone', body: { phone: '13800138000', code: '123456', nickname: 'New User', invitationCode: 'INVITE' }, sessionType: 'phone' },
  { request: { grant_type: 'password', username: 'user', password: 'secret' }, path: '/api/auth/login/password', body: { username: 'user', password: 'secret' }, sessionType: 'password' },
  { request: { grant_type: 'api_key', api_key: 'key' }, path: '/api/auth/login/api-key', body: { apiKey: 'key' }, sessionType: 'api_key' },
];

it.each(['desktop', 'web'])('enterprise selection reuses the %s login transaction with the selected identity', async (host) => {
  const selected = { ...data, user: { ...data.user, id: 'company-member', orgId: 'company', role: 'user' } };
  mocks.login.mockResolvedValue({ success: true, data: selected });
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response('{"ok":true}'))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          user: { id: 'company-member', name: 'Human' },
          role: 'user',
          organization: { id: 'company' },
        })
      )
    );
  vi.stubGlobal('fetch', fetch);
  const commit = vi.fn();
  const request: LoginRequest = { grant_type: 'organization', orgId: 'company', mossBaseUrl: 'https://other.example' };
  expect(await runLogin(request, 'device', host === 'web' ? webLoginPort : desktopLoginPort, commit)).toEqual({ success: true });
  expect(commit.mock.calls[0][0]).toMatchObject({ sessionType: 'phone', data: { user: { id: 'company-member', orgId: 'company', role: 'user' } } });
  if (host === 'web') {
    expect(fetch.mock.calls[0][0]).toBe('/api/auth/switch-org');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ orgId: 'company' });
    expect(commit.mock.calls[0][0].data.access_token).toBe('web-session');
  } else {
    expect(mocks.login).toHaveBeenCalledWith({ serverUrl: 'https://moss.example', body: { grant_type: 'organization', orgId: 'company' }, deviceId: 'device' });
  }
});

it('does not reopen the previous enterprise Agent workspace after selecting a different enterprise', async () => {
  vi.stubGlobal('window', { location: { hash: '#/conversation/opc-session?org_id=opc' }, history: { state: null } });
  const fetch = vi.fn().mockImplementation(async (path: string) => {
    if (path === '/api/auth/switch-org') return new Response('{"ok":true}');
    if (path === '/api/auth/session') return new Response(JSON.stringify({ user: { id: 'company-member', name: 'Human' }, role: 'user', organization: { id: 'company' } }));
    throw new Error('Unexpected workspace request: ' + path);
  });
  vi.stubGlobal('fetch', fetch);
  const commit = vi.fn();
  expect(await runLogin({ grant_type: 'organization', orgId: 'company' }, 'device', webLoginPort, commit)).toEqual({ success: true });
  expect(fetch.mock.calls.map(([path]) => path)).toEqual(['/api/auth/switch-org', '/api/auth/session']);
  expect(commit.mock.calls[0][0].data.user).toMatchObject({ id: 'company-member', orgId: 'company' });
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.server.mockResolvedValue('https://moss.example');
  mocks.login.mockResolvedValue({ success: true, data });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each(['web', 'desktop'] as const)('%s login through the shared flow', (host) => {
  it.each(grants)('authenticates $request.grant_type and commits one complete session', async ({ request, path, body, sessionType }) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'user-1', name: 'User' }, role: 'USER', organization: { id: 'org-1' } })));
    vi.stubGlobal('fetch', fetch);
    const commit = vi.fn();
    expect(await runLogin({ ...request, mossBaseUrl: 'https://moss.example' }, 'device', host === 'web' ? webLoginPort : desktopLoginPort, commit)).toEqual({ success: true });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][0]).toMatchObject({ deviceId: 'device', sessionType, data: { user: { id: 'user-1', orgId: 'org-1' } } });
    if (host === 'web') {
      expect(fetch.mock.calls[0][0]).toBe(path);
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ ...body, mossBaseUrl: 'https://moss.example' });
      expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'include', signal: expect.any(AbortSignal) });
      expect(commit.mock.calls[0][0].data.access_token).toBe('web-session');
      expect(commit.mock.calls[0][0].data.refresh_token).toBe('');
      expect(mocks.login).not.toHaveBeenCalled();
    } else {
      expect(mocks.login).toHaveBeenCalledWith({ serverUrl: 'https://moss.example', body: request, deviceId: 'device' });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it('returns a rejection without persisting an authenticated session', async () => {
    mocks.login.mockResolvedValue({ success: false, error: 'phone_not_registered', msg: 'Please register' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'phone_not_registered', message: 'Please register' }), { status: 401 })));
    const commit = vi.fn();
    expect(await runLogin(phone, 'device', host === 'web' ? webLoginPort : desktopLoginPort, commit)).toMatchObject({ success: false, code: 'invalidCredentials', error: 'phone_not_registered', message: 'Please register' });
    expect(commit).not.toHaveBeenCalled();
  });

  it('ends a stalled transport and never commits its late result', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    if (host === 'desktop')
      mocks.login.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = () => resolve({ success: true, data });
          })
      );
    else
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              finish = () => resolve(new Response(JSON.stringify({ ok: true })));
            })
        )
      );
    const commit = vi.fn(),
      onFailure = vi.fn();
    const result = runLogin(phone, 'device', host === 'web' ? webLoginPort : desktopLoginPort, commit, { timeoutMs: 100, onFailure });
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toMatchObject({ success: false, code: 'timeout' });
    expect(onFailure).toHaveBeenCalledWith('timeout', `${host}-authenticate`);
    finish();
    await vi.advanceTimersByTimeAsync(1);
    expect(commit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

it('does not manufacture a successful web identity when the cookie session is absent', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(new Response('{"ok":true}'))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
  );
  const commit = vi.fn();
  expect(await runLogin(phone, 'device', webLoginPort, commit)).toMatchObject({ success: false, code: 'invalidResponse' });
  expect(commit).not.toHaveBeenCalled();
});

it('keeps a web authentication policy rejection distinct from invalid credentials', async () => {
  const message = 'Current organization does not allow phone code login';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'AUTH_REQUEST_REJECTED', message }), { status: 403 })));
  const commit = vi.fn();
  expect(await runLogin(phone, 'device', webLoginPort, commit)).toMatchObject({ success: false, code: 'authRejected', error: 'AUTH_REQUEST_REJECTED', message });
  expect(commit).not.toHaveBeenCalled();
});

it('uses the same flow for desktop OAuth2 callbacks', async () => {
  const commit = vi.fn();
  expect(await runLogin({ grant_type: 'oauth2', params: { code: 'test' } }, 'device', desktopLoginPort, commit)).toEqual({ success: true });
  expect(commit.mock.calls[0][0].sessionType).toBe('oauth2');
});

it('prevents further setup writes when a local initialization step times out', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const save = vi.fn(),
    commit = vi.fn();
  const port: ILoginPort = {
    authenticate: async () => ({ success: true, data }),
    prepareSession: async (_session, attempt) => {
      await attempt.step(
        'local-config',
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      );
      await attempt.step('save', save);
    },
  };
  const result = runLogin(phone, 'device', port, commit, { timeoutMs: 100 });
  await vi.advanceTimersByTimeAsync(100);
  expect(await result).toMatchObject({ success: false, code: 'timeout' });
  finish();
  await vi.advanceTimersByTimeAsync(1);
  expect(save).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});

it.each([undefined, { ...data, access_token: '' }, { ...data, user: { ...data.user, id: '' } }])('rejects an incomplete authenticated response before setup', async (payload) => {
  const prepareSession = vi.fn(),
    commit = vi.fn();
  const result = await runLogin(phone, 'device', { authenticate: async (): Promise<ILoginResponse> => ({ success: true, data: payload }), prepareSession }, commit);
  expect(result).toMatchObject({ success: false, code: 'invalidResponse' });
  expect(prepareSession).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});

it('honors the managed execution policy over legacy local credentials', async () => {
  const commit = vi.fn();
  await runLogin(phone, 'device', { authenticate: async () => ({ success: true, data: { ...data, execution: { isLocalAllowed: false, isRemoteAllowed: true, defaultTarget: 'remote' } } }) }, commit);
  expect(commit.mock.calls[0][0].isLocalAvailable).toBe(false);
});

it.each([
  ['network_error', 'networkError'],
  ['request_timeout', 'timeout'],
  ['invalid_response', 'invalidResponse'],
  ['local_setup_failed', 'setupError'],
  ['auth_request_rejected', 'authRejected'],
])('preserves the desktop failure category %s through the shared flow', async (error, code) => {
  mocks.login.mockResolvedValue({ success: false, error });
  const commit = vi.fn();
  expect(await runLogin(phone, 'device', desktopLoginPort, commit)).toMatchObject({ success: false, code });
  expect(commit).not.toHaveBeenCalled();
});
