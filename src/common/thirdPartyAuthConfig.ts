import type { SystemConfig, ThirdPartyAuthConfig, ThirdPartyAuthProvider } from '@/common/systemConfig';

export const THIRD_PARTY_LOGIN_METHOD = 2;

export const COMAC_CAS_PROVIDER_ID = 'comac_cas';
export const CAS_CALLBACK_PATH = 'callback';

export const DEFAULT_COMAC_CAS_PROVIDER: ThirdPartyAuthProvider = {
  id: COMAC_CAS_PROVIDER_ID,
  name: '中国商飞',
  type: 'cas',
  cas_url: 'http://cas.cvtol.com/',
  login_path: '/cas/login/',
  validate_path: '/cas/p3/serviceValidate',
  logout_path: '/cas/logout',
  service_param: 'service',
};

export interface ResolvedThirdPartyAuthConfig {
  enabled: boolean;
  defaultProvider: string;
  providers: ThirdPartyAuthProvider[];
}

function normalizePath(path: string | undefined, fallback: string): string {
  const trimmed = path?.trim();
  if (!trimmed) return fallback;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function normalizeCasUrl(url: string | undefined, fallback: string): string {
  const trimmed = url?.trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/\/+$/, '/');
}

export function normalizeThirdPartyProvider(provider: Partial<ThirdPartyAuthProvider> | null | undefined): ThirdPartyAuthProvider | null {
  if (!provider) return null;

  const id = typeof provider.id === 'string' && provider.id.trim() ? provider.id.trim() : undefined;
  const type = provider.type === 'cas' ? 'cas' : undefined;
  if (!id || !type) return null;

  const defaults = id === COMAC_CAS_PROVIDER_ID ? DEFAULT_COMAC_CAS_PROVIDER : undefined;
  const casUrl = normalizeCasUrl(provider.cas_url, defaults?.cas_url || '');
  if (!casUrl) return null;

  return {
    id,
    name: typeof provider.name === 'string' && provider.name.trim() ? provider.name.trim() : defaults?.name || id,
    type,
    cas_url: casUrl,
    login_path: normalizePath(provider.login_path, defaults?.login_path || '/cas/login/'),
    validate_path: normalizePath(provider.validate_path, defaults?.validate_path || '/cas/p3/serviceValidate'),
    logout_path: normalizePath(provider.logout_path, defaults?.logout_path || '/cas/logout'),
    service_param: typeof provider.service_param === 'string' && provider.service_param.trim() ? provider.service_param.trim() : defaults?.service_param || 'service',
  };
}

export function resolveThirdPartyAuthConfig(config: SystemConfig | null | undefined): ResolvedThirdPartyAuthConfig | null {
  if (config?.login_method !== THIRD_PARTY_LOGIN_METHOD) {
    return null;
  }

  const rawConfig: ThirdPartyAuthConfig | undefined = config.third_party_auth;
  if (rawConfig?.enabled === false) {
    return null;
  }

  const providers = (rawConfig?.providers || []).map((provider) => normalizeThirdPartyProvider(provider)).filter((provider): provider is ThirdPartyAuthProvider => Boolean(provider));

  const resolvedProviders = providers.length > 0 ? providers : [DEFAULT_COMAC_CAS_PROVIDER];
  const requestedDefault = rawConfig?.default_provider?.trim();
  const defaultProvider = resolvedProviders.some((provider) => provider.id === requestedDefault) ? requestedDefault || resolvedProviders[0].id : resolvedProviders[0].id;

  return {
    enabled: true,
    defaultProvider,
    providers: resolvedProviders,
  };
}

export function buildCasLoginUrl(provider: ThirdPartyAuthProvider, serviceUrl: string): string {
  const base = new URL(provider.login_path, provider.cas_url);
  base.searchParams.set(provider.service_param || 'service', serviceUrl);
  return base.toString();
}

export function buildCasServiceUrl(providerId: string): string {
  return `sudowork://cas-callback/${encodeURIComponent(providerId)}/${CAS_CALLBACK_PATH}`;
}

export function parseCasCallbackAction(action: string): { providerId: string } | null {
  const parts = action.split('/');
  if (parts.length !== 3 || parts[0] !== 'cas-callback' || parts[2] !== CAS_CALLBACK_PATH) {
    return null;
  }

  const providerId = decodeURIComponent(parts[1] || '').trim();
  if (!providerId) {
    return null;
  }

  return { providerId };
}
