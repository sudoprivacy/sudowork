import { describe, expect, it } from 'vitest';
import { buildCasLoginUrl, buildCasLogoutServiceUrl, buildCasLogoutUrl, buildCasServiceUrl, COMAC_CAS_PROVIDER_ID, DEFAULT_COMAC_CAS_PROVIDER, parseCasCallbackAction, resolveThirdPartyAuthConfig } from '@sudowork/common/thirdPartyAuthConfig';
import type { SystemConfig } from '@sudowork/common/systemConfig';

describe('thirdPartyAuthConfig', () => {
  it('returns null when third-party login method is not enabled', () => {
    expect(resolveThirdPartyAuthConfig({ login_method: 0 })).toBeNull();
    expect(resolveThirdPartyAuthConfig({ login_method: 1 })).toBeNull();
  });

  it('falls back to the built-in COMAC CAS provider', () => {
    const resolved = resolveThirdPartyAuthConfig({ login_method: 2 });

    expect(resolved?.enabled).toBe(true);
    expect(resolved?.defaultProvider).toBe(COMAC_CAS_PROVIDER_ID);
    expect(resolved?.providers).toEqual([DEFAULT_COMAC_CAS_PROVIDER]);
  });

  it('normalizes configured CAS providers and respects the default provider', () => {
    const config: SystemConfig = {
      login_method: 2,
      third_party_auth: {
        enabled: true,
        default_provider: 'custom_cas',
        providers: [
          {
            id: 'custom_cas',
            name: 'Custom CAS',
            type: 'cas',
            cas_url: 'https://cas.example.com/root///',
            login_path: 'login',
            validate_path: 'validate',
            logout_path: 'logout',
          },
        ],
      },
    };

    const resolved = resolveThirdPartyAuthConfig(config);

    expect(resolved?.defaultProvider).toBe('custom_cas');
    expect(resolved?.providers[0]).toMatchObject({
      cas_url: 'https://cas.example.com/root/',
      login_path: '/login',
      validate_path: '/validate',
      logout_path: '/logout',
      logout_service_url: '',
      service_param: 'service',
      service_encode_mode: 'component',
      callback_mode: 'server_callback',
    });
  });

  it('builds CAS login and service URLs with server callback mode', () => {
    const service = buildCasServiceUrl({
      ...DEFAULT_COMAC_CAS_PROVIDER,
      server_callback_url: 'https://server.example.com/api/v1/auth/third-party/cas/callback/comac_cas',
    });
    const loginUrl = buildCasLoginUrl(DEFAULT_COMAC_CAS_PROVIDER, service);

    expect(service).toBe('https://server.example.com/api/v1/auth/third-party/cas/callback/comac_cas');
    expect(loginUrl).toBe('http://cas.cvtol.com/cas/login/?service=https%3A%2F%2Fserver.example.com%2Fapi%2Fv1%2Fauth%2Fthird-party%2Fcas%2Fcallback%2Fcomac_cas');
  });

  it('builds raw CAS login service parameters when configured', () => {
    const service = 'http://127.0.0.1:3001/api/v1/auth/third-party/cas/callback/comac_cas';
    const loginUrl = buildCasLoginUrl({ ...DEFAULT_COMAC_CAS_PROVIDER, service_encode_mode: 'raw' }, service);

    expect(loginUrl).toBe('http://cas.cvtol.com/cas/login/?service=http://127.0.0.1:3001/api/v1/auth/third-party/cas/callback/comac_cas');
  });

  it('builds direct app callback service URLs', () => {
    const service = buildCasServiceUrl({
      ...DEFAULT_COMAC_CAS_PROVIDER,
      callback_mode: 'direct_app',
    });

    expect(service).toBe('sudowork://cas-callback/comac_cas/callback');
  });

  it('builds CAS logout URLs from the server callback URL', () => {
    const provider = {
      ...DEFAULT_COMAC_CAS_PROVIDER,
      server_callback_url: 'https://server.example.com/api/v1/auth/third-party/cas/callback/comac_cas',
    };
    const service = buildCasLogoutServiceUrl(provider, 'http://127.0.0.1:3001');
    const logoutUrl = buildCasLogoutUrl(provider, service);

    expect(service).toBe('https://server.example.com/api/v1/auth/third-party/cas/logout/callback/comac_cas');
    expect(logoutUrl).toBe('http://cas.cvtol.com/cas/logout?service=https%3A%2F%2Fserver.example.com%2Fapi%2Fv1%2Fauth%2Fthird-party%2Fcas%2Flogout%2Fcallback%2Fcomac_cas');
  });

  it('respects a configured raw CAS logout service URL', () => {
    const provider = {
      ...DEFAULT_COMAC_CAS_PROVIDER,
      service_encode_mode: 'raw' as const,
      logout_service_url: 'http://127.0.0.1:3001/api/v1/auth/third-party/cas/logout/callback/comac_cas',
    };
    const service = buildCasLogoutServiceUrl(provider, 'http://unused.example.com');
    const logoutUrl = buildCasLogoutUrl(provider, service);

    expect(service).toBe('http://127.0.0.1:3001/api/v1/auth/third-party/cas/logout/callback/comac_cas');
    expect(logoutUrl).toBe('http://cas.cvtol.com/cas/logout?service=http://127.0.0.1:3001/api/v1/auth/third-party/cas/logout/callback/comac_cas');
  });

  it('parses CAS callback actions', () => {
    expect(parseCasCallbackAction('cas-callback/comac_cas/callback')).toEqual({
      providerId: 'comac_cas',
      action: 'callback',
    });
    expect(parseCasCallbackAction('cas-callback/comac_cas/logout')).toEqual({
      providerId: 'comac_cas',
      action: 'logout',
    });
    expect(parseCasCallbackAction('cas-callback/comac_cas/abc123')).toBeNull();
    expect(parseCasCallbackAction('oauth2-callback')).toBeNull();
  });
});
