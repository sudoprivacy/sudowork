import { LoginError, type IAuthenticatedLogin, type ILoginPort, type LoginRequest } from '@sudowork/common/authLogin';
import { getAuthServerBaseUrl } from './authServer.js';
import { eeclaw } from './ipcBridge.js';

export const WEB_SESSION_TOKEN = 'web-session';

/** Translate a grant once, at the cookie-session boundary. */
function webRequest(request: LoginRequest): { path: string; body: Record<string, unknown> } {
  const { mossBaseUrl } = request;
  const server = mossBaseUrl ? { mossBaseUrl } : {};
  switch (request.grant_type) {
    case 'phone':
      return { path: '/api/auth/login/phone', body: { phone: request.phone, code: request.code, ...server } };
    case 'phone_register':
      return { path: '/api/auth/register/phone', body: { phone: request.phone, code: request.code, nickname: request.nickname, invitationCode: request.invitation_code, ...server } };
    case 'password':
      return { path: '/api/auth/login/password', body: { username: request.username, password: request.password, ...server } };
    case 'api_key':
      return { path: '/api/auth/login/api-key', body: { apiKey: request.api_key, ...server } };
    case 'oauth2':
      throw new LoginError('invalidCredentials');
  }
}

/** Web keeps real tokens on the server; a verified cookie session supplies its identity. */
export const webLoginPort: ILoginPort = {
  async authenticate(request, _deviceId, attempt) {
    const { path, body } = webRequest(request);
    const result = await attempt.step('web-authenticate', async (signal) => {
      const response = await fetch(path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
      const data = (await response.json().catch((): null => null)) as { ok?: boolean; error?: string; message?: string } | null;
      if (!response.ok || data?.ok !== true) {
        const isUnavailable = response.status >= 500 || data?.error === 'MOSS_UNAVAILABLE';
        throw new LoginError(isUnavailable ? 'networkError' : 'invalidCredentials', data?.error, data?.message);
      }
      return data;
    });
    if (!result) throw new LoginError('invalidResponse');
    const data = await attempt.step('web-session', async (signal) => {
      const response = await fetch('/api/auth/session', { method: 'GET', credentials: 'include', signal });
      if (!response.ok) throw new LoginError('invalidResponse');
      const session = (await response.json()) as { user?: { id?: string; name?: string }; role?: string; organization?: { id?: string } | null };
      if (!session.user?.id) throw new LoginError('invalidResponse');
      return {
        access_token: WEB_SESSION_TOKEN,
        refresh_token: '',
        expires_in: 24 * 60 * 60,
        user: { id: session.user.id, name: session.user.name || session.user.id, role: session.role || 'USER', orgId: session.organization?.id || '', localAuth: false },
      } satisfies IAuthenticatedLogin;
    });
    return { success: true, data };
  },
};

/** Desktop authenticates through main-process IPC, which owns persistent credentials. */
export const desktopLoginPort: ILoginPort = {
  async authenticate(request, deviceId, attempt) {
    const serverUrl = await attempt.step('desktop-server', () => getAuthServerBaseUrl());
    const { mossBaseUrl: _mossBaseUrl, ...body } = request;
    return attempt.step('desktop-authenticate', () => eeclaw.login.invoke({ serverUrl, body, deviceId }));
  },
};
