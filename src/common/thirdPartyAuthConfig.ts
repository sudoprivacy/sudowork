import type { SystemConfig, ThirdPartyAuthConfig, ThirdPartyAuthProvider } from '@/common/systemConfig';

export const THIRD_PARTY_LOGIN_METHOD = 2;

export const COMAC_CAS_PROVIDER_ID = 'comac_cas';
export const CAS_CALLBACK_PATH = 'callback';
export const CAS_LOGOUT_CALLBACK_PATH = 'logout';

export const DEFAULT_COMAC_CAS_PROVIDER: ThirdPartyAuthProvider = {
  id: COMAC_CAS_PROVIDER_ID,
  name: '中国商飞',
  type: 'cas',
  cas_url: 'http://cas.cvtol.com/',
  login_path: '/cas/login/',
  validate_path: '/cas/p3/serviceValidate',
  logout_path: '/cas/logout',
  logout_service_url: '',
  service_param: 'service',
  service_encode_mode: 'component',
  callback_mode: 'server_callback',
  server_callback_url: '',
  app_callback_url: 'sudowork://cas-callback/comac_cas/callback',
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
    logout_service_url: typeof provider.logout_service_url === 'string' ? provider.logout_service_url.trim() : defaults?.logout_service_url || '',
    service_param: typeof provider.service_param === 'string' && provider.service_param.trim() ? provider.service_param.trim() : defaults?.service_param || 'service',
    service_encode_mode: provider.service_encode_mode === 'raw' ? 'raw' : defaults?.service_encode_mode || 'component',
    callback_mode: provider.callback_mode === 'direct_app' ? 'direct_app' : defaults?.callback_mode || 'server_callback',
    server_callback_url: typeof provider.server_callback_url === 'string' ? provider.server_callback_url.trim() : defaults?.server_callback_url || '',
    app_callback_url: typeof provider.app_callback_url === 'string' && provider.app_callback_url.trim() ? provider.app_callback_url.trim() : defaults?.app_callback_url || `sudowork://cas-callback/${encodeURIComponent(id)}/${CAS_CALLBACK_PATH}`,
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
  return appendCasServiceParam(base, provider, serviceUrl);
}

export function buildCasLogoutUrl(provider: ThirdPartyAuthProvider, serviceUrl: string): string {
  const base = new URL(provider.logout_path || DEFAULT_COMAC_CAS_PROVIDER.logout_path || '/cas/logout', provider.cas_url);
  return appendCasServiceParam(base, provider, serviceUrl);
}

function appendCasServiceParam(base: URL, provider: ThirdPartyAuthProvider, serviceUrl: string): string {
  if (provider.service_encode_mode === 'raw') {
    const separator = base.toString().includes('?') ? '&' : '?';
    return `${base.toString()}${separator}${provider.service_param || 'service'}=${serviceUrl}`;
  }
  base.searchParams.set(provider.service_param || 'service', serviceUrl);
  return base.toString();
}

export function buildCasServiceUrl(provider: Pick<ThirdPartyAuthProvider, 'id' | 'callback_mode' | 'server_callback_url' | 'app_callback_url'>): string {
  if (provider.callback_mode === 'server_callback') {
    const callbackUrl = provider.server_callback_url?.trim();
    if (!callbackUrl) {
      throw new Error('Missing server callback URL');
    }
    return callbackUrl;
  }

  return provider.app_callback_url?.trim() || `sudowork://cas-callback/${encodeURIComponent(provider.id)}/${CAS_CALLBACK_PATH}`;
}

export function buildCasLogoutServiceUrl(provider: Pick<ThirdPartyAuthProvider, 'id' | 'callback_mode' | 'server_callback_url' | 'app_callback_url' | 'logout_service_url'>, serverBaseUrl: string): string {
  const configured = provider.logout_service_url?.trim();
  if (configured) {
    return configured;
  }

  if (provider.callback_mode === 'server_callback') {
    const derived = deriveServerLogoutCallbackUrl(provider.server_callback_url, provider.id);
    if (derived) {
      return derived;
    }
    return new URL(`/api/v1/auth/third-party/cas/logout/callback/${encodeURIComponent(provider.id)}`, serverBaseUrl).toString();
  }

  return deriveAppLogoutCallbackUrl(provider.app_callback_url, provider.id);
}

function deriveServerLogoutCallbackUrl(serverCallbackUrl: string | undefined, providerId: string): string | null {
  const trimmed = serverCallbackUrl?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (/\/callback\/[^/]+\/?$/.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/callback\/[^/]+\/?$/, `/logout/callback/${encodeURIComponent(providerId)}`);
      url.search = '';
      return url.toString();
    }
    return new URL(`/api/v1/auth/third-party/cas/logout/callback/${encodeURIComponent(providerId)}`, url.origin).toString();
  } catch {
    return null;
  }
}

function deriveAppLogoutCallbackUrl(appCallbackUrl: string | undefined, providerId: string): string {
  const fallback = `sudowork://cas-callback/${encodeURIComponent(providerId)}/${CAS_LOGOUT_CALLBACK_PATH}`;
  const trimmed = appCallbackUrl?.trim();
  if (!trimmed) return fallback;

  try {
    const url = new URL(trimmed);
    url.pathname = url.pathname.replace(/\/callback\/?$/, `/${CAS_LOGOUT_CALLBACK_PATH}`);
    url.search = '';
    return url.toString();
  } catch {
    return fallback;
  }
}

export function parseCasCallbackAction(action: string): { providerId: string; action: 'callback' | 'logout' } | null {
  const parts = action.split('/');
  if (parts.length !== 3 || parts[0] !== 'cas-callback' || (parts[2] !== CAS_CALLBACK_PATH && parts[2] !== CAS_LOGOUT_CALLBACK_PATH)) {
    return null;
  }

  const providerId = decodeURIComponent(parts[1] || '').trim();
  if (!providerId) {
    return null;
  }

  return {
    providerId,
    action: parts[2] === CAS_LOGOUT_CALLBACK_PATH ? 'logout' : 'callback',
  };
}
