import { describe, expect, it } from 'vitest';
import { buildCasLoginUrl, buildCasServiceUrl, COMAC_CAS_PROVIDER_ID, DEFAULT_COMAC_CAS_PROVIDER, parseCasCallbackAction, resolveThirdPartyAuthConfig } from '@/common/thirdPartyAuthConfig';
import type { SystemConfig } from '@/common/systemConfig';

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
      service_param: 'service',
    });
  });

  it('builds CAS login and service URLs', () => {
    const service = buildCasServiceUrl('comac_cas');
    const loginUrl = buildCasLoginUrl(DEFAULT_COMAC_CAS_PROVIDER, service);

    expect(service).toBe('sudowork://cas-callback/comac_cas/callback');
    expect(loginUrl).toBe('http://cas.cvtol.com/cas/login/?service=sudowork%3A%2F%2Fcas-callback%2Fcomac_cas%2Fcallback');
  });

  it('parses CAS callback actions', () => {
    expect(parseCasCallbackAction('cas-callback/comac_cas/callback')).toEqual({
      providerId: 'comac_cas',
    });
    expect(parseCasCallbackAction('cas-callback/comac_cas/abc123')).toBeNull();
    expect(parseCasCallbackAction('oauth2-callback')).toBeNull();
  });
});
