/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { runLogin, type LoginFailureCode, type LoginRequest } from '@sudowork/common/authLogin';
import { desktopLoginPort, webLoginPort, WEB_SESSION_TOKEN } from '@sudowork/host-bridge/authLogin';
import { applyLoginImageModel, fetchAndCacheCredentials, prepareDesktopLogin, syncScodeGuidModelPreference } from '@sudowork/host-bridge/desktopLoginSetup';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { getAuthServerBaseUrl } from '@sudowork/host-bridge/authServer';
import { ConfigStorage } from '@sudowork/common/storage';
import { fetchSystemConfig } from '@sudowork/common/systemConfig';
import { buildCasLogoutServiceUrl, buildCasLogoutUrl, resolveThirdPartyAuthConfig } from '@sudowork/common/thirdPartyAuthConfig';
import { getSudorouterPrimaryModelPath, mergeSudorouterProvidersIntoConfig } from '@sudowork/common/sudoclawModelConfig';
import { buildScodeConfigFromLoginPayload, SCODE_AUTO_MODEL_ALIAS } from '@sudowork/common/scodeConfig';
import { extractLoginSudoclawPayload, mergeLoginUserData } from '@sudowork/common/sudoworkAuthLogin';

type AuthStatus = 'checking' | 'syncing' | 'authenticated' | 'unauthenticated' | 'guest';

export interface AuthUser {
  id: string;
  nickname: string;
  role: 'SUPER_ADMIN' | 'ENTERPRISE_ADMIN' | 'ADMIN' | 'USER';
  status: number;
  enterprise_code?: string;
  token?: string;
  sudorouter_key?: string;
  model_service_url?: string;
  models?: string[];
  scode_auto_model?: string;
  phone?: string;
  localAuth?: boolean;
  localModeAvailable?: boolean;
  execution?: import('@sudowork/common/mossExecution').IMossExecutionCapabilities;
  localRuntime?: import('@sudowork/common/mossExecution').TMossLocalRuntimeStatus;
  points?: {
    total: number;
    used: number;
    remaining: number;
    bonus: number;
  };
}

// 新的存储结构
interface AuthStorage {
  access_token: string;
  refresh_token: string;
  expires_at: number; // 过期时间戳（毫秒）
  user: AuthUser;
  device_id: string;
  session?: AuthSession;
}

interface AuthSession {
  type: 'cas';
  provider: string;
}

// Enterprise auth storage (localStorage, separate from C-side)
interface EeclawAuthStorage {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: AuthUser;
  device_id: string;
  /** How this session was established; drives which grant_type is used on refresh. */
  session_type?: 'password' | 'api_key' | 'oauth2' | 'phone';
}

interface LoginParams {
  phone: string;
  code: string;
  enterprise_code?: string;
  invitation_code?: string;
  remember?: boolean;
  mossBaseUrl?: string;
}

type LoginErrorCode = LoginFailureCode | 'tooManyAttempts' | 'serverError' | 'unknown';

interface LoginResult {
  success: boolean;
  message?: string;
  code?: LoginErrorCode;
  status?: number;
}

interface RegisterParams {
  phone: string;
  code: string;
  nickname: string;
  invitation_code: string;
  mossBaseUrl?: string;
}

interface RegisterResult {
  success: boolean;
  message?: string;
  code?: LoginErrorCode;
}

interface PasswordLoginParams {
  phone: string;
  password: string;
}

interface PasswordRegisterParams {
  phone: string;
  password: string;
  nickname: string;
  invitation_code: string;
}

interface ChangePasswordParams {
  oldPassword: string;
  newPassword: string;
}

interface PasswordAuthResult {
  success: boolean;
  message?: string;
}

interface ThirdPartyAuthLoginParams {
  provider: string;
  ticket: string;
  service: string;
}

interface ThirdPartyAuthExchangeParams {
  provider: string;
  code: string;
}

type LoginSuccessResponse = {
  data: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user?: AuthUser;
  };
};

type AuthApiResponse = {
  success?: boolean;
  msg?: string;
  message?: string;
  status?: number;
  phone?: string;
  data?: LoginSuccessResponse['data'];
};

type SetAuthUser = (user: AuthUser | null) => void;
type SetAuthStatus = (status: AuthStatus) => void;
type SetAuthReady = (ready: boolean) => void;
type SetSyncMessage = (message: string | null) => void;
type RefreshResult = { status: 'success'; accessToken: string } | { status: 'auth_expired' | 'failed'; reason?: string };

// Enterprise login params
interface EnterpriseLoginParams {
  username: string;
  password: string;
  // WebUI 自定义 moss 服务器地址（可选）；桌面端不传
  mossBaseUrl?: string;
}

interface EnterpriseLoginParamsByKey {
  api_key: string;
  // WebUI 自定义 moss 服务器地址（可选）；桌面端不传
  mossBaseUrl?: string;
}

interface AuthContextValue {
  ready: boolean;
  user: AuthUser | null;
  status: AuthStatus;
  isGuest: boolean;
  syncMessage: string | null;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  login: (params: LoginParams) => Promise<LoginResult>;
  register: (params: RegisterParams) => Promise<RegisterResult>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  ensureValidToken: (forceRefresh?: boolean) => Promise<string | null>;
  forceRefreshToken: () => Promise<string | null>;
  enterpriseLogin: (params: EnterpriseLoginParams | EnterpriseLoginParamsByKey) => Promise<LoginResult>;
  enterpriseLoginWithOAuth2: (params: Record<string, string>) => Promise<LoginResult>;
  loginByPassword: (params: PasswordLoginParams) => Promise<PasswordAuthResult>;
  registerByPassword: (params: PasswordRegisterParams) => Promise<PasswordAuthResult>;
  loginWithThirdPartyAuth: (params: ThirdPartyAuthLoginParams) => Promise<PasswordAuthResult>;
  exchangeThirdPartyAuthCode: (params: ThirdPartyAuthExchangeParams) => Promise<PasswordAuthResult>;
  changePassword: (params: ChangePasswordParams) => Promise<PasswordAuthResult>;
  enterGuest: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const AUTH_USER_ENDPOINT = '/api/auth/user';
const AUTH_STORAGE_KEY = 'sudowork_auth_v2';
export const EECLAW_AUTH_STORAGE_KEY = 'eeclaw_auth_v1';
export const GUEST_FLAG_KEY = 'sudowork_guest';
// Virtual SQLite user_id for guest custom model providers (scode_custom_model_providers.user_id has no FK constraint)
export const GUEST_USER_ID = 'sudowork_guest';
const DEVICE_ID_KEY = 'sudowork_device_id';

// Restore guest custom models from SQLite into sudocode.json with an empty base,
// which drops sudorouter and other non-custom entries (clears residue).
async function restoreGuestScodeModels(): Promise<void> {
  try {
    await ipcBridge.scode.restoreCustomModelProviders.invoke({ userId: GUEST_USER_ID, baseConfig: {} });
  } catch (err) {
    console.warn('[Auth] Guest scode restore failed:', err);
  }
}

const isDesktopRuntime = typeof window !== 'undefined' && Boolean(window.electronAPI);

// Shared-renderer web host (webui mossAdapter): auth talks to the webui server's
// cookie session instead of the eeclaw IPC channels. Desktop is always false.
const isWebRuntime = typeof window !== 'undefined' && !window.electronAPI;

/**
 * Refresh Auth Proxy rules after successful login.
 * Reads enabled config item IDs from storage and triggers a rules refresh.
 */
async function refreshAuthProxyRulesAfterLogin(): Promise<void> {
  try {
    const enabledMap = (await ConfigStorage.get('settings.tenant.enabled')) as Record<number, boolean> | undefined;
    const enabledIds = enabledMap
      ? Object.entries(enabledMap)
          .filter(([, v]) => v)
          .map(([k]) => Number(k))
      : [];

    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) return;
    const authStorage: AuthStorage = JSON.parse(stored);

    const result = await ipcBridge.authProxy.refreshRules.invoke({
      accessToken: authStorage.access_token,
      enabledConfigItemIds: enabledIds,
    });
    if (result.success) {
      console.log('[Auth] Auth Proxy rules refreshed after login');
    } else {
      console.warn('[Auth] Auth Proxy rules refresh failed after login:', result.msg);
    }
  } catch (err) {
    console.warn('[Auth] Auth Proxy rules refresh error after login:', err);
  }
}

function hasSudoclawApiKey(config: { models?: { providers?: Record<string, { apiKey?: string }> } } | null | undefined): boolean {
  return Object.values(config?.models?.providers || {}).some((provider) => !!provider?.apiKey?.trim());
}

async function invokeWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([fn(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`IPC timeout after ${timeoutMs}ms`)), timeoutMs))]);
}

async function ensureSudoclawHasApiKey(): Promise<boolean> {
  if (!isDesktopRuntime) {
    return true;
  }

  const maxRetries = 3;
  const timeoutMs = 3000;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await invokeWithTimeout(() => ipcBridge.sudoclaw.getConfig.invoke(), timeoutMs);
      return hasSudoclawApiKey(res?.data);
    } catch (error) {
      console.warn(`[Auth] getConfig attempt ${i + 1}/${maxRetries} failed:`, error);
      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  console.error('[Auth] ensureSudoclawHasApiKey failed after all retries, treating as no api key');
  return false;
}

// 获取或创建设备 ID
function getDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

async function fetchCurrentUser(signal?: AbortSignal): Promise<AuthUser | null> {
  try {
    const response = await fetch(AUTH_USER_ENDPOINT, {
      method: 'GET',
      credentials: 'include',
      signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { success: boolean; user?: AuthUser };
    if (data.success && data.user) {
      return data.user;
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return null;
    }
    console.error('Failed to fetch current user:', error);
  }

  return null;
}

// Map MOSS enterprise user to AuthUser compatible type
function mapEnterpriseUser(enterpriseUser: { id: string; name: string; role?: string; localAuth?: boolean }, token?: string): AuthUser {
  return {
    id: enterpriseUser.id,
    nickname: enterpriseUser.name,
    role: (enterpriseUser.role as AuthUser['role']) || 'USER',
    status: 1, // default active
    token,
    localAuth: enterpriseUser.localAuth === true,
  };
}

// Web host: the webui server exposes a cookie session at /api/auth/session
// ({ user: { id, name }, organization, role, scopes }). No real token is handed
// to the browser — the storage below only satisfies the EeclawAuthStorage shape
// the existing enterprise branches read.
async function fetchWebSession(): Promise<AuthUser | null> {
  try {
    const response = await fetch('/api/auth/session', {
      method: 'GET',
      credentials: 'include',
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      user?: { id?: string; name?: string };
      role?: string;
      organization?: { id?: string; name?: string } | null;
    };
    if (!data.user?.id) return null;
    return {
      id: data.user.id,
      nickname: data.user.name || data.user.id,
      role: (data.role as AuthUser['role']) || 'USER',
      status: 1,
      localAuth: false,
      // 企业标识：让技能「专属」tab 通过非空门槛并让 handler 分流到 /tenant
      // （/tenant 取数按登录 session 企业身份返回，不依赖此值内容）
      enterprise_code: data.organization?.id,
      // The placeholder the rest of the app tests for. Twenty-odd screens gate
      // their data fetching on `user.token` being present, which on the desktop
      // carries a real bearer. Here the cookie is the credential and nothing
      // needs the value — but leaving the field empty silently switched every
      // one of those screens off: the settings pages rendered their zero state
      // and never issued a request. `ensureValidToken()` returns this same
      // placeholder, so the two agree.
      token: WEB_SESSION_TOKEN,
    };
  } catch {
    return null;
  }
}

function buildWebAuthStorage(user: AuthUser): string {
  return JSON.stringify({
    access_token: WEB_SESSION_TOKEN,
    refresh_token: '',
    expires_at: Date.now() + 24 * 60 * 60 * 1000,
    user,
    device_id: getDeviceId(),
    session_type: 'password',
  } satisfies EeclawAuthStorage);
}

function resolveString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function resolveConsumerUserId(user: Partial<AuthUser>): string | undefined {
  return resolveString(user.id);
}

function resolveConsumerTenantId(user: Partial<AuthUser> & { tenant_id?: string }, fallbackTenantId?: string): string | undefined {
  return resolveString(user.tenant_id) || resolveString(user.enterprise_code) || resolveString(fallbackTenantId);
}

function isAuthRejectedResponse(status: number, body?: unknown): boolean {
  if (status === 401 || status === 403) return true;
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const code = resolveString(record.error) || resolveString(record.code) || resolveString(record.msg) || resolveString(record.message);
  if (!code) return false;
  return /invalid.*refresh|refresh.*invalid|expired|unauthorized|forbidden|auth.*required/i.test(code);
}

function withAuthorizationHeader(headers: HeadersInit | undefined, token: string): Headers {
  const nextHeaders = new Headers(headers);
  nextHeaders.set('Authorization', `Bearer ${token}`);
  return nextHeaders;
}

async function openThirdPartyLogoutIfNeeded(session: AuthSession | undefined): Promise<void> {
  if (session?.type !== 'cas') return;

  try {
    const serverBaseUrl = await getAuthServerBaseUrl();
    const systemConfig = await fetchSystemConfig(serverBaseUrl);
    const authConfig = resolveThirdPartyAuthConfig(systemConfig);
    const provider = authConfig?.providers.find((item) => item.id === session.provider);
    if (!provider) {
      return;
    }

    const serviceUrl = buildCasLogoutServiceUrl(provider, serverBaseUrl);
    const logoutUrl = buildCasLogoutUrl(provider, serviceUrl);
    if (isDesktopRuntime) {
      await ipcBridge.shell.openExternal.invoke(logoutUrl);
      return;
    }
    window.open(logoutUrl, '_blank', 'noopener,noreferrer');
  } catch (error) {
    console.error('[Auth] Third-party CAS logout failed:', error);
  }
}

async function handleLoginSuccess(data: LoginSuccessResponse, setUser: SetAuthUser, setStatus: SetAuthStatus, setReady: SetAuthReady, setSyncMessage: SetSyncMessage, tenantIdFallback?: string, session?: AuthSession) {
  const deviceId = getDeviceId();
  const mergedUser = mergeLoginUserData(data) as unknown as AuthUser;
  const resolvedTenantId = resolveConsumerTenantId(mergedUser, tenantIdFallback);
  const resolvedUserId = resolveConsumerUserId(mergedUser);
  if (resolvedUserId && mergedUser.id !== resolvedUserId) {
    mergedUser.id = resolvedUserId;
  }

  if (resolvedTenantId && !mergedUser.enterprise_code) {
    mergedUser.enterprise_code = resolvedTenantId;
  }
  const loginSudoclawPayload = extractLoginSudoclawPayload(data);

  // 新的存储结构
  const authStorage: AuthStorage = {
    access_token: data.data.access_token,
    refresh_token: data.data.refresh_token,
    expires_at: Date.now() + data.data.expires_in * 1000,
    user: mergedUser,
    device_id: deviceId,
    session,
  };

  const authData = { ...mergedUser, token: data.data.access_token };
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authStorage));
  localStorage.removeItem('sudowork_auth_v1');

  if (isDesktopRuntime && authData.phone) {
    try {
      await ipcBridge.sudoworkAuth.saveUserPhone.invoke({ phone: authData.phone });
      console.log('[Auth] User phone saved to config');
    } catch (error) {
      console.error('[Auth] Failed to save user phone:', error);
    }
  }

  // 同步用户昵称到主进程，触发 USER.md 更新，让 AI 能正确称呼用户
  if (isDesktopRuntime && authData.nickname) {
    ipcBridge.sudoworkAuth.saveUserNickname.invoke({ nickname: authData.nickname }).catch((error) => {
      console.error('[Auth] Failed to sync user nickname:', error);
    });
  }

  // 同步用户 ID 到主进程，用于遥测上报 (个人模式)
  if (isDesktopRuntime && resolvedUserId) {
    try {
      await Promise.all([
        ipcBridge.sudoworkAuth.saveConsumerUserId.invoke({ userId: resolvedUserId }),
        ConfigStorage.set('consumer.userInfo', {
          id: resolvedUserId,
          nickname: authData.nickname,
          phone: authData.phone,
          tenant_id: resolvedTenantId,
        }),
      ]);
    } catch (error) {
      console.error('[Auth] Failed to save consumer telemetry user info:', error);
    }
  } else if (isDesktopRuntime) {
    console.warn('[Auth] Consumer user ID missing after login; telemetry will not be reported');
  }

  if (isDesktopRuntime) {
    if (!loginSudoclawPayload) {
      setUser(null);
      setStatus('unauthenticated');
      setReady(true);
      throw new Error('登录响应缺少 Sudoclaw API Key 配置');
    }

    setReady(true);

    try {
      const currentScodeConfig = await ipcBridge.scode.getConfig.invoke().catch((): null => null);
      const pricingRes = await ipcBridge.scode.fetchSpecificPricing.invoke().catch((): null => null);
      const pricingItems = pricingRes?.data ?? [];
      const scodeConfig = buildScodeConfigFromLoginPayload(loginSudoclawPayload, currentScodeConfig?.data, pricingItems);
      const scodeSaveRes = await ipcBridge.scode.saveConfig.invoke({ config: scodeConfig });
      if (!scodeSaveRes?.success) {
        throw new Error(scodeSaveRes?.msg || 'Sudocode saveConfig failed');
      }

      const restoreRes = await ipcBridge.scode.restoreCustomModelProviders.invoke({ userId: authData.id }).catch((err): null => {
        console.warn('[Auth] Failed to restore custom scode models:', err);
        return null;
      });
      await applyLoginImageModel();
      // Sync settings.json to the merged default model while preserving a user-selected custom model.
      const defaultModel = restoreRes?.data?.default_model || scodeConfig.default_model;
      if (defaultModel) {
        await ipcBridge.scode.setDefaultModel.invoke({ modelId: defaultModel }).catch(() => {});
      }
      await syncScodeGuidModelPreference(SCODE_AUTO_MODEL_ALIAS);

      // Sync sudoclaw.json only for legacy gateway compatibility. Failure must not block Sudocode.
      try {
        const currentConfig = await ipcBridge.sudoclaw.getConfig.invoke();
        const hadSudoclawApiKey = hasSudoclawApiKey(currentConfig?.data);
        const patch = mergeSudorouterProvidersIntoConfig(currentConfig?.data, {
          modelIds: loginSudoclawPayload.models,
          apiKey: loginSudoclawPayload.sudorouterKey,
          baseUrl: loginSudoclawPayload.modelServiceUrl,
          preservePrimary: hadSudoclawApiKey,
        });

        if (!hadSudoclawApiKey) {
          patch.agents = {
            ...patch.agents,
            defaults: {
              ...patch.agents?.defaults,
              model: {
                ...patch.agents?.defaults?.model,
                primary: getSudorouterPrimaryModelPath('gemini-3.5-flash'),
              },
            },
          };
        }

        const saveRes = await ipcBridge.sudoclaw.saveConfig.invoke({ config: patch });
        if (!saveRes?.success) {
          throw new Error(saveRes?.msg || 'Sudoclaw saveConfig failed');
        }
      } catch (error) {
        console.warn('[Auth] Failed to sync sudoclaw backup config:', error);
      }
    } catch (error) {
      setSyncMessage(null);
      setUser(null);
      setStatus('unauthenticated');
      setReady(true);
      console.error('[Auth] Sudocode 配置失败:', error);
      throw error;
    }
  }

  setSyncMessage(null);
  setUser(authData);
  setStatus('authenticated');
  setReady(true);
  localStorage.removeItem(GUEST_FLAG_KEY);

  if (isDesktopRuntime) {
    // §6.4 active-login path: cache server-driven credentials BEFORE restarting the gateway
    // subprocess so env injection (skillhub url/token) sees the dispatched values.
    await fetchAndCacheCredentials(authStorage.access_token);
    void restartSudoclawGatewayIfInstalled();
  }
}

async function restartSudoclawGatewayIfInstalled(): Promise<void> {
  try {
    const statusRes = await ipcBridge.sudoclaw.getStatus.invoke();
    if (!statusRes?.success || !statusRes.data?.installed) {
      console.warn('[Auth] Sudoclaw gateway restart skipped because Sudoclaw CLI is not installed');
      return;
    }

    const restartRes = await ipcBridge.sudoclaw.restartGateway.invoke();
    if (!restartRes?.success) {
      console.error('[Auth] Sudoclaw 后台重启失败:', restartRes?.msg || 'Sudoclaw restartGateway failed');
      return;
    }
    console.log('[Auth] Sudoclaw 正在后台重启');
  } catch (error) {
    console.error('[Auth] Sudoclaw 后台重启失败:', error);
  }
}

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { t } = useTranslation();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Mutex to prevent concurrent refresh calls
  const refreshPromiseRef = useRef<Promise<RefreshResult> | null>(null);
  // Cooldown to prevent rapid repeated refresh
  const lastRefreshAtRef = useRef<number>(0);
  const REFRESH_COOLDOWN_MS = 30_000;
  const isExpiringAuthRef = useRef(false);

  const expireAuth = useCallback(async (reason: string) => {
    if (isExpiringAuthRef.current) return;
    isExpiringAuthRef.current = true;
    try {
      console.warn('[Auth] Session expired, clearing local auth state:', reason);
      localStorage.removeItem(AUTH_STORAGE_KEY);
      localStorage.removeItem('sudowork_auth_v1');
      localStorage.removeItem(EECLAW_AUTH_STORAGE_KEY);
      localStorage.removeItem(GUEST_FLAG_KEY);

      setUser(null);
      setStatus('unauthenticated');
      setSyncMessage(null);
      setReady(true);

      if (!isDesktopRuntime) return;

      await Promise.allSettled([
        ConfigStorage.set('consumer.userInfo', undefined),
        ConfigStorage.set('eeclaw.authStorage', undefined),
        ConfigStorage.set('eeclaw.userInfo', undefined),
        ConfigStorage.set('eeclaw.localModeAvailable', undefined),
        ipcBridge.sudoworkAuth.clearConsumerUserId.invoke(),
        ipcBridge.eeclaw.logout.invoke(),
      ]);
    } finally {
      isExpiringAuthRef.current = false;
    }
  }, []);

  // Enter guest mode (unauthenticated use). Clear any online credentials first:
  // auth restoration intentionally prefers a valid Moss session, so leaving
  // one behind would send a reload straight back to online mode.
  const enterGuest = useCallback(async () => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem('sudowork_auth_v1');
    localStorage.removeItem(EECLAW_AUTH_STORAGE_KEY);
    if (isDesktopRuntime) {
      await Promise.allSettled([
        ConfigStorage.set('consumer.userInfo', undefined),
        ConfigStorage.set('eeclaw.authStorage', undefined),
        ConfigStorage.set('eeclaw.userInfo', undefined),
        ConfigStorage.set('eeclaw.localModeAvailable', undefined),
        ConfigStorage.set('guid.sessionMode', 'local'),
        ipcBridge.sudoworkAuth.clearConsumerUserId.invoke(),
        ipcBridge.eeclaw.logout.invoke(),
        ipcBridge.eeclaw.setSessionMode.invoke({ mode: 'local' }),
      ]);
    }
    await restoreGuestScodeModels();
    localStorage.setItem(GUEST_FLAG_KEY, '1');
    setUser(null);
    setStatus('guest');
    setSyncMessage(null);
    setReady(true);
  }, []);

  // Token 刷新函数 — supports both C-side and enterprise mode
  const refreshTokens = useCallback(async ({ force = false }: { force?: boolean } = {}): Promise<RefreshResult> => {
    // Cooldown: skip if refreshed recently
    if (!force && Date.now() - lastRefreshAtRef.current < REFRESH_COOLDOWN_MS) {
      return { status: 'failed', reason: 'refresh_cooldown' };
    }

    // Dedup: if already refreshing, wait for it
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    refreshPromiseRef.current = (async () => {
      try {
        // Enterprise mode: delegate to main process getValidToken via IPC to avoid race conditions
        const eeclawStored = localStorage.getItem(EECLAW_AUTH_STORAGE_KEY);
        if (eeclawStored) {
          // Web host: no token concept — slide the placeholder expiry forward so
          // callers stop retrying (refresh() re-validates on next page load).
          if (isWebRuntime) {
            try {
              const authStorage: EeclawAuthStorage = JSON.parse(eeclawStored);
              authStorage.expires_at = Date.now() + 24 * 60 * 60 * 1000;
              localStorage.setItem(EECLAW_AUTH_STORAGE_KEY, JSON.stringify(authStorage));
            } catch {
              /* malformed storage — refresh() will clear it */
            }
            lastRefreshAtRef.current = Date.now();
            return { status: 'success', accessToken: 'web-session' };
          }
          try {
            const authStorage: EeclawAuthStorage = JSON.parse(eeclawStored);

            const result = await ipcBridge.eeclaw.refreshToken.invoke();
            if (result.success && result.data) {
              const newStorage: EeclawAuthStorage = {
                access_token: result.data.access_token,
                refresh_token: result.data.refresh_token || authStorage.refresh_token,
                expires_at: result.data.expires_at || Date.now() + 3600 * 1000,
                user: authStorage.user,
                device_id: authStorage.device_id,
              };

              localStorage.setItem(EECLAW_AUTH_STORAGE_KEY, JSON.stringify(newStorage));
              setUser({ ...authStorage.user, token: result.data.access_token });
              lastRefreshAtRef.current = Date.now();
              console.log('[Auth] Enterprise token refreshed successfully via IPC');
              return { status: 'success', accessToken: result.data.access_token };
            }
            console.error('[Auth] Enterprise token refresh via IPC failed');
            const error = 'error' in result ? result.error : result.msg;
            return isAuthRejectedResponse(0, { error }) || String(error || '').includes('AUTH_REQUIRED') ? { status: 'auth_expired', reason: String(error || 'enterprise_refresh_failed') } : { status: 'failed', reason: String(error || 'enterprise_refresh_failed') };
          } catch (error) {
            console.error('[Auth] Enterprise token refresh via IPC failed:', error);
            return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
          }
        }

        // C-side mode: refresh from sudowork server
        const stored = localStorage.getItem(AUTH_STORAGE_KEY);
        if (!stored) return { status: 'failed', reason: 'missing_auth_storage' };

        try {
          const authStorage: AuthStorage = JSON.parse(stored);
          const { refresh_token, device_id } = authStorage;
          if (!refresh_token) {
            return { status: 'auth_expired', reason: 'missing_refresh_token' };
          }

          const response = await fetch(`${await getAuthServerBaseUrl()}/api/v1/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token, device_id }),
          });

          const data = (await response.json().catch((): unknown => ({}))) as Record<string, unknown>;
          if (data.success === true) {
            const body = data as { access_token: string; refresh_token: string; expires_in: number };
            const newStorage: AuthStorage = {
              access_token: body.access_token,
              refresh_token: body.refresh_token,
              expires_at: Date.now() + body.expires_in * 1000,
              user: authStorage.user,
              device_id: device_id || getDeviceId(),
              session: authStorage.session,
            };

            localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(newStorage));
            setUser({ ...authStorage.user, token: body.access_token });
            lastRefreshAtRef.current = Date.now();
            console.log('[Auth] Token refreshed successfully');
            return { status: 'success', accessToken: body.access_token };
          }
          if (isAuthRejectedResponse(response.status, data)) {
            return { status: 'auth_expired', reason: 'consumer_refresh_rejected' };
          }
        } catch (error) {
          console.error('[Auth] Token refresh failed:', error);
          return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
        }

        return { status: 'failed', reason: 'refresh_failed' };
      } finally {
        refreshPromiseRef.current = null;
      }
    })();

    return refreshPromiseRef.current;
  }, []);

  // 确保有效 Token（在请求前调用）— supports both modes
  const ensureValidToken = useCallback(
    async (forceRefresh = false): Promise<string | null> => {
      // Enterprise mode: check eeclaw_auth_v1
      const eeclawStored = localStorage.getItem(EECLAW_AUTH_STORAGE_KEY);
      if (eeclawStored) {
        // Web host: the placeholder token is opaque to callers; the cookie
        // session is the real credential. refresh() re-validates on page load.
        if (isWebRuntime) return WEB_SESSION_TOKEN;
        try {
          const authStorage: EeclawAuthStorage = JSON.parse(eeclawStored);
          const { access_token, expires_at } = authStorage;

          if (forceRefresh || (expires_at && Date.now() > expires_at - 5 * 60 * 1000)) {
            const refreshed = await refreshTokens({ force: forceRefresh });
            if (refreshed.status === 'success') {
              return refreshed.accessToken;
            }
            // Refresh failed (e.g. provider has no refresh API). Keep using the
            // current access_token while it is still valid; only give up once it
            // has actually expired, at which point re-login is required.
            if (!forceRefresh && expires_at && Date.now() < expires_at) {
              return access_token;
            }
            if (refreshed.status === 'auth_expired') {
              await expireAuth(refreshed.reason || 'enterprise_refresh_failed');
            }
            return null;
          }

          return access_token;
        } catch (error) {
          console.error('[Auth] Failed to ensure valid enterprise token:', error);
        }
        return null;
      }

      // C-side: original logic
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (stored) {
        try {
          const authStorage: AuthStorage = JSON.parse(stored);
          const { access_token, expires_at } = authStorage;

          if (forceRefresh || (expires_at && Date.now() > expires_at - 5 * 60 * 1000)) {
            const refreshed = await refreshTokens({ force: forceRefresh });
            if (refreshed.status === 'success') {
              return refreshed.accessToken;
            }
            if (refreshed.status === 'auth_expired') {
              await expireAuth(refreshed.reason || 'consumer_refresh_failed');
              return null;
            }
            return null;
          }

          return access_token;
        } catch (error) {
          console.error('[Auth] Failed to ensure valid token:', error);
        }
      }

      // 兼容旧版本存储（sudowork_auth_v1）
      const oldStored = localStorage.getItem('sudowork_auth_v1');
      if (oldStored) {
        try {
          const oldAuthData = JSON.parse(oldStored);
          return oldAuthData.token || null;
        } catch (error) {
          console.error('[Auth] Failed to parse old auth storage:', error);
        }
      }

      return null;
    },
    [expireAuth, refreshTokens]
  );

  // 强制刷新 Token — supports both modes
  const forceRefreshToken = useCallback(async (): Promise<string | null> => {
    console.log('[Auth] Force refreshing token...');

    // Enterprise mode
    const eeclawStored = localStorage.getItem(EECLAW_AUTH_STORAGE_KEY);
    if (eeclawStored) {
      return ensureValidToken(true);
    }

    // C-side
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      return ensureValidToken(true);
    }

    console.warn('[Auth] No refresh_token available, user needs to re-login');
    return null;
  }, [ensureValidToken]);

  const authFetch = useCallback(
    async (url: string, options: RequestInit = {}): Promise<Response> => {
      const token = await ensureValidToken();
      if (!token) {
        throw new Error('AUTH_UNAVAILABLE');
      }

      const response = await fetch(url, {
        ...options,
        headers: withAuthorizationHeader(options.headers, token),
      });

      if (response.status !== 401 && response.status !== 403) {
        return response;
      }

      const newToken = await forceRefreshToken();
      if (!newToken) {
        throw new Error('AUTH_UNAVAILABLE');
      }

      const retryResponse = await fetch(url, {
        ...options,
        headers: withAuthorizationHeader(options.headers, newToken),
      });

      if (retryResponse.status === 401 || retryResponse.status === 403) {
        await expireAuth('authenticated_request_unauthorized_after_retry');
        throw new Error('AUTH_EXPIRED');
      }

      return retryResponse;
    },
    [ensureValidToken, expireAuth, forceRefreshToken]
  );

  const refresh = useCallback(async () => {
    // === Web host (webui shared-renderer): restore from the webui cookie session ===
    if (isWebRuntime) {
      const webUser = await fetchWebSession();
      if (webUser) {
        localStorage.setItem(EECLAW_AUTH_STORAGE_KEY, buildWebAuthStorage(webUser));
        setUser(webUser);
        setStatus('authenticated');
      } else {
        localStorage.removeItem(EECLAW_AUTH_STORAGE_KEY);
        setUser(null);
        setStatus('unauthenticated');
      }
      setReady(true);
      return;
    }

    // === Enterprise mode: restore from eeclaw_auth_v1 ===
    const eeclawStored = localStorage.getItem(EECLAW_AUTH_STORAGE_KEY);
    if (eeclawStored) {
      try {
        const authStorage: EeclawAuthStorage = JSON.parse(eeclawStored);

        if (!authStorage.user) {
          localStorage.removeItem(EECLAW_AUTH_STORAGE_KEY);
        } else {
          // Sync token to ConfigStorage for eeclawBridge
          // Prefer ProcessConfig's refresh_token if it's newer (main process may have rotated it)
          try {
            const existingConfig = await ConfigStorage.get('eeclaw.authStorage');
            const configRefreshToken = existingConfig?.refresh_token;
            const configExpiresAt = existingConfig?.expires_at;

            // Use the newer refresh_token: the one from ProcessConfig if it was refreshed by main process
            const useConfigRefreshToken = configRefreshToken && configRefreshToken !== authStorage.refresh_token;
            const finalRefreshToken = useConfigRefreshToken ? configRefreshToken : authStorage.refresh_token;
            const finalExpiresAt = configExpiresAt && configExpiresAt > authStorage.expires_at ? configExpiresAt : authStorage.expires_at;
            const finalAccessToken = configExpiresAt && configExpiresAt > authStorage.expires_at && existingConfig?.access_token ? existingConfig.access_token : authStorage.access_token;

            await ConfigStorage.set('eeclaw.authStorage', {
              access_token: finalAccessToken,
              refresh_token: finalRefreshToken,
              expires_at: finalExpiresAt,
              device_id: authStorage.device_id,
              session_type: authStorage.session_type || existingConfig?.session_type,
            });
            await ConfigStorage.set('eeclaw.localModeAvailable', authStorage.user.localModeAvailable === true);

            // If ProcessConfig had a newer token, also update localStorage
            if (finalRefreshToken !== authStorage.refresh_token || finalExpiresAt !== authStorage.expires_at) {
              authStorage.access_token = finalAccessToken;
              authStorage.refresh_token = finalRefreshToken;
              authStorage.expires_at = finalExpiresAt;
              localStorage.setItem(EECLAW_AUTH_STORAGE_KEY, JSON.stringify(authStorage));
              console.log('[Auth] Synced newer token from ProcessConfig to localStorage');
            }
          } catch (e) {
            console.warn('[Auth] Failed to sync eeclaw auth to ConfigStorage:', e);
          }

          if (isDesktopRuntime && authStorage.user.execution) {
            const runtime = await ipcBridge.eeclaw.prepareLocalRuntime.invoke().catch((): null => null);
            if (runtime?.success && runtime.data) {
              authStorage.user.execution = runtime.data.execution;
              authStorage.user.localRuntime = runtime.data.localRuntime;
              authStorage.user.localModeAvailable = runtime.data.execution.isLocalAllowed;
              localStorage.setItem(EECLAW_AUTH_STORAGE_KEY, JSON.stringify(authStorage));
            }
          }

          // Check if token needs refresh
          if (authStorage.expires_at && Date.now() > authStorage.expires_at - 5 * 60 * 1000) {
            const refreshed = await refreshTokens({ force: true });
            if (refreshed.status === 'auth_expired') {
              await expireAuth(refreshed.reason || 'enterprise_refresh_rejected_on_restore');
              return;
            }
            if (refreshed.status === 'failed' && Date.now() >= authStorage.expires_at) {
              setUser(null);
              setStatus('unauthenticated');
              setReady(true);
              return;
            }
          }
          const latestAuth = JSON.parse(localStorage.getItem(EECLAW_AUTH_STORAGE_KEY) || JSON.stringify(authStorage)) as EeclawAuthStorage;
          await fetchAndCacheCredentials(latestAuth.access_token);
          setUser({ ...latestAuth.user, token: latestAuth.access_token });
          setStatus('authenticated');
          setReady(true);
          await syncScodeGuidModelPreference(SCODE_AUTO_MODEL_ALIAS);
          return;
        }
      } catch {
        localStorage.removeItem(EECLAW_AUTH_STORAGE_KEY);
      }
    }

    // Explicit offline use takes precedence over retired consumer credentials.
    if (isDesktopRuntime && localStorage.getItem(GUEST_FLAG_KEY)) {
      await restoreGuestScodeModels();
      setStatus('guest');
      setUser(null);
      setReady(true);
      return;
    }

    // Online desktop users authenticate only against Moss. Legacy consumer
    // tokens are intentionally not restored after the unified-entry upgrade.
    if (isDesktopRuntime) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      localStorage.removeItem('sudowork_auth_v1');
      setStatus('unauthenticated');
      setUser(null);
      setReady(true);
      return;
    }

    // === Legacy C-side web flow ===
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      try {
        const authStorage: AuthStorage = JSON.parse(stored);
        const hasApiKey = await ensureSudoclawHasApiKey();
        if (!hasApiKey) {
          setSyncMessage(null);
          setUser(null);
          setStatus('unauthenticated');
          setReady(true);
          return;
        }

        const restoredUserId = resolveConsumerUserId(authStorage.user);
        // 从 localStorage 恢复登录状态时，也保存手机号到文件
        if (isDesktopRuntime && authStorage.user.phone) {
          ipcBridge.sudoworkAuth.saveUserPhone.invoke({ phone: authStorage.user.phone }).catch((error) => {
            console.error('[Auth] Failed to save user phone on restore:', error);
          });
        }

        // 从 localStorage 恢复登录状态时，也同步昵称到主进程
        if (isDesktopRuntime && authStorage.user.nickname) {
          ipcBridge.sudoworkAuth.saveUserNickname.invoke({ nickname: authStorage.user.nickname }).catch((error) => {
            console.error('[Auth] Failed to sync user nickname on restore:', error);
          });
        }

        // 从 localStorage 恢复登录状态时，也同步用户 ID 到主进程 (个人模式)
        if (isDesktopRuntime && restoredUserId) {
          try {
            await Promise.all([
              ipcBridge.sudoworkAuth.saveConsumerUserId.invoke({ userId: restoredUserId }),
              ConfigStorage.set('consumer.userInfo', {
                id: restoredUserId,
                nickname: authStorage.user.nickname,
                phone: authStorage.user.phone,
                tenant_id: resolveConsumerTenantId(authStorage.user),
              }),
            ]);
          } catch (error) {
            console.error('[Auth] Failed to save consumer telemetry user info on restore:', error);
          }
        } else if (isDesktopRuntime) {
          console.warn('[Auth] Consumer user ID missing on restore; telemetry will not be reported');
        }

        // 检查 token 是否需要刷新
        if (authStorage.expires_at && Date.now() > authStorage.expires_at - 5 * 60 * 1000) {
          const refreshed = await refreshTokens({ force: true });
          if (refreshed.status === 'auth_expired') {
            await expireAuth(refreshed.reason || 'consumer_refresh_rejected_on_restore');
            return;
          }
          if (refreshed.status === 'failed' && Date.now() >= authStorage.expires_at) {
            setUser(null);
            setStatus('unauthenticated');
            setReady(true);
            return;
          }
        }
        const latestAuth = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || JSON.stringify(authStorage)) as AuthStorage;
        setUser({ ...latestAuth.user, token: latestAuth.access_token });
        setStatus('authenticated');
        setReady(true);
        await syncScodeGuidModelPreference(SCODE_AUTO_MODEL_ALIAS);
        // §6.4 凭据注入必须在 token 刷新之后:冷启动时 access_token 可能已过期,
        // 若在刷新前注入,/system-config/credentials 会用过期 JWT 返回 401,凭据无法注入。
        void fetchAndCacheCredentials(latestAuth.access_token);
        return;
      } catch {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    }

    // 兼容旧版本存储
    const oldStored = localStorage.getItem('sudowork_auth_v1');
    if (oldStored) {
      try {
        const parsed = JSON.parse(oldStored);
        const hasApiKey = await ensureSudoclawHasApiKey();
        if (!hasApiKey) {
          setSyncMessage(null);
          setUser(null);
          setStatus('unauthenticated');
          setReady(true);
          return;
        }

        setUser(parsed);
        setStatus('authenticated');
        setReady(true);
        await syncScodeGuidModelPreference(SCODE_AUTO_MODEL_ALIAS);

        const restoredUserId = resolveConsumerUserId(parsed as Partial<AuthUser>);
        if (isDesktopRuntime && parsed.phone) {
          ipcBridge.sudoworkAuth.saveUserPhone.invoke({ phone: parsed.phone }).catch((error) => {
            console.error('[Auth] Failed to save user phone on restore:', error);
          });
        }

        if (isDesktopRuntime && parsed.nickname) {
          ipcBridge.sudoworkAuth.saveUserNickname.invoke({ nickname: parsed.nickname }).catch((error) => {
            console.error('[Auth] Failed to sync user nickname on restore:', error);
          });
        }

        if (isDesktopRuntime && restoredUserId) {
          try {
            await Promise.all([
              ipcBridge.sudoworkAuth.saveConsumerUserId.invoke({ userId: restoredUserId }),
              ConfigStorage.set('consumer.userInfo', {
                id: restoredUserId,
                nickname: parsed.nickname,
                phone: parsed.phone,
                tenant_id: resolveConsumerTenantId(parsed),
              }),
            ]);
          } catch (error) {
            console.error('[Auth] Failed to save consumer telemetry user info on legacy restore:', error);
          }
        } else if (isDesktopRuntime) {
          console.warn('[Auth] Consumer user ID missing on legacy restore; telemetry will not be reported');
        }
        return;
      } catch {
        localStorage.removeItem('sudowork_auth_v1');
      }
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('checking');

    const currentUser = await fetchCurrentUser(controller.signal);
    if (currentUser) {
      setUser(currentUser);
      setStatus('authenticated');
    } else {
      setUser(null);
      setStatus('unauthenticated');
    }
    setReady(true);
  }, [expireAuth, refreshTokens]);

  useEffect(() => {
    void refresh();
    return () => {
      abortRef.current?.abort();
    };
  }, [refresh]);

  // Auth Proxy: 登录状态变化时自动刷新 rules
  useEffect(() => {
    if (status === 'authenticated' && isDesktopRuntime) {
      void refreshAuthProxyRulesAfterLogin();
    }
  }, [status]);

  // Sync token refresh events from main process to renderer localStorage
  // Main process (MossSessionApi/eeclawBridge) may refresh tokens, revoking the old
  // refresh_token on the server. Without this sync, renderer would try to use the
  // old refresh_token and get "Invalid refresh token" errors.
  useEffect(() => {
    const unsubscribe = ipcBridge.eeclaw.tokenRefreshed.on((data) => {
      const eeclawStored = localStorage.getItem(EECLAW_AUTH_STORAGE_KEY);
      if (eeclawStored) {
        try {
          const authStorage: EeclawAuthStorage = JSON.parse(eeclawStored);
          authStorage.access_token = data.access_token;
          authStorage.refresh_token = data.refresh_token;
          authStorage.expires_at = data.expires_at;
          localStorage.setItem(EECLAW_AUTH_STORAGE_KEY, JSON.stringify(authStorage));
          setUser({ ...authStorage.user, token: data.access_token });
          console.log('[Auth] Token synced from main process refresh');
        } catch (e) {
          console.error('[Auth] Failed to sync token refresh from main process:', e);
        }
      }
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Main process signals the enterprise token is dead and cannot be refreshed
  // (e.g. OAuth2 session whose IdP issued no refresh token, or a definitively
  // rejected refresh). Drop to the login screen — conversations are untouched
  // and resume after re-login (issue #849).
  useEffect(() => {
    const unsubscribe = ipcBridge.eeclaw.authRequired.on(({ reason }) => {
      console.warn(`[Auth] Enterprise session requires re-login (${reason})`);
      void expireAuth(`enterprise_auth_required:${reason}`);
    });
    return () => {
      unsubscribe();
    };
  }, [expireAuth]);

  const performLogin = useCallback(
    async (request: LoginRequest): Promise<LoginResult> => {
      const port = isWebRuntime ? webLoginPort : { ...desktopLoginPort, prepareSession: prepareDesktopLogin };
      const result = await runLogin(
        request,
        getDeviceId(),
        port,
        (session) => {
          const { data, deviceId, sessionType, expiresAt, isLocalAvailable } = session;
          const mappedUser: AuthUser = {
            ...mapEnterpriseUser(data.user, data.access_token),
            enterprise_code: data.user.orgId || undefined,
            localModeAvailable: isLocalAvailable,
            execution: data.execution,
            localRuntime: data.localRuntime,
          };
          const storage: EeclawAuthStorage = {
            access_token: data.access_token,
            refresh_token: data.refresh_token || '',
            expires_at: expiresAt,
            user: mappedUser,
            device_id: deviceId,
            session_type: sessionType,
          };
          localStorage.setItem(EECLAW_AUTH_STORAGE_KEY, JSON.stringify(storage));
          setUser(mappedUser);
          setStatus('authenticated');
          setReady(true);
          void fetchAndCacheCredentials(data.access_token);
        },
        {
          onFailure: (code, stage) => console.warn('[Auth] Login failed', { code, stage }),
        }
      );
      if (result.success === true) return result;
      const messageKey =
        result.error === 'phone_not_registered' ? 'login.registrationNeeded' : result.code === 'timeout' ? 'login.errors.timeout' : result.code === 'setupError' ? 'login.errors.localSetup' : result.code === 'invalidCredentials' ? 'login.errors.invalidCredentials' : 'login.errors.networkError';
      return { success: false, code: result.code, message: result.message || t(messageKey) };
    },
    [t]
  );

  const login = useCallback(({ phone, code, mossBaseUrl }: LoginParams): Promise<LoginResult> => performLogin({ grant_type: 'phone', phone, code, mossBaseUrl }), [performLogin]);

  const register = useCallback(({ phone, code, nickname, invitation_code, mossBaseUrl }: RegisterParams): Promise<RegisterResult> => performLogin({ grant_type: 'phone_register', phone, code, nickname, invitation_code, mossBaseUrl }), [performLogin]);

  // 用户名密码登录（system login_method=1 时使用），复用 handleLoginSuccess
  const loginByPassword = useCallback(async ({ phone, password }: PasswordLoginParams): Promise<PasswordAuthResult> => {
    const deviceId = getDeviceId();
    try {
      const response = await fetch(`${await getAuthServerBaseUrl()}/api/v1/auth/login-by-config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': deviceId,
        },
        body: JSON.stringify({ phone, password }),
      });
      const data = (await response.json()) as AuthApiResponse;
      if (!response.ok || !data.success || !data.data) {
        return { success: false, message: data?.msg || data?.message || '登录失败' };
      }
      await handleLoginSuccess({ data: data.data }, setUser, setStatus, setReady, setSyncMessage, 'sudo');
      return { success: true };
    } catch (error) {
      console.error('Login by password failed:', error);
      return { success: false, message: error instanceof Error ? error.message : '连接到中控服务器失败' };
    }
  }, []);

  // 用户名密码注册（system login_method=1 时使用），复用 handleLoginSuccess
  const registerByPassword = useCallback(async ({ phone, password, nickname, invitation_code }: PasswordRegisterParams): Promise<PasswordAuthResult> => {
    const deviceId = getDeviceId();
    try {
      const response = await fetch(`${await getAuthServerBaseUrl()}/api/v1/auth/register-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': deviceId,
        },
        body: JSON.stringify({ phone, password, nickname, invitation_code }),
      });
      const data = (await response.json()) as AuthApiResponse;
      if (!response.ok || !data.success || !data.data) {
        return { success: false, message: data?.msg || data?.message || '注册失败' };
      }
      await handleLoginSuccess({ data: data.data }, setUser, setStatus, setReady, setSyncMessage, 'sudo');
      return { success: true };
    } catch (error) {
      console.error('Register by password failed:', error);
      return { success: false, message: error instanceof Error ? error.message : '连接到中控服务器失败' };
    }
  }, []);

  const loginWithThirdPartyAuth = useCallback(async ({ provider, ticket, service }: ThirdPartyAuthLoginParams): Promise<PasswordAuthResult> => {
    const deviceId = getDeviceId();
    try {
      const response = await fetch(`${await getAuthServerBaseUrl()}/api/v1/auth/third-party/cas/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': deviceId,
        },
        body: JSON.stringify({ provider, ticket, service }),
      });
      const data = (await response.json()) as AuthApiResponse;
      if (!response.ok || !data.success || !data.data) {
        return { success: false, message: data?.msg || data?.message || '三方认证登录失败' };
      }
      await handleLoginSuccess({ data: data.data }, setUser, setStatus, setReady, setSyncMessage, undefined, { type: 'cas', provider });
      return { success: true };
    } catch (error) {
      console.error('Third-party auth login failed:', error);
      return { success: false, message: error instanceof Error ? error.message : '连接到中控服务器失败' };
    }
  }, []);

  const exchangeThirdPartyAuthCode = useCallback(async ({ provider, code }: ThirdPartyAuthExchangeParams): Promise<PasswordAuthResult> => {
    const deviceId = getDeviceId();
    try {
      const response = await fetch(`${await getAuthServerBaseUrl()}/api/v1/auth/third-party/cas/exchange`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': deviceId,
        },
        body: JSON.stringify({ provider, code }),
      });
      const data = (await response.json()) as AuthApiResponse;
      if (!response.ok || !data.success || !data.data) {
        return { success: false, message: data?.msg || data?.message || '三方认证登录失败' };
      }
      await handleLoginSuccess({ data: data.data }, setUser, setStatus, setReady, setSyncMessage, undefined, { type: 'cas', provider });
      return { success: true };
    } catch (error) {
      console.error('Third-party auth code exchange failed:', error);
      return { success: false, message: error instanceof Error ? error.message : '连接到中控服务器失败' };
    }
  }, []);

  // 修改密码（login_method=1 的用户改自己的密码）；token 过期时由调用方提示重登
  const changePassword = useCallback(
    async ({ oldPassword, newPassword }: ChangePasswordParams): Promise<PasswordAuthResult> => {
      const token = await ensureValidToken();
      if (!token) {
        return { success: false, message: '登录状态已过期，请重新登录' };
      }
      try {
        const response = await fetch(`${await getAuthServerBaseUrl()}/api/v1/auth/change-password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ oldPassword, newPassword }),
        });
        const data = (await response.json()) as AuthApiResponse;
        if (!response.ok || !data.success) {
          return { success: false, message: data?.msg || data?.message || '修改密码失败' };
        }
        return { success: true };
      } catch (error) {
        console.error('Change password failed:', error);
        return { success: false, message: error instanceof Error ? error.message : '连接到中控服务器失败' };
      }
    },
    [ensureValidToken]
  );

  const enterpriseLogin = useCallback(
    (params: EnterpriseLoginParams | EnterpriseLoginParamsByKey): Promise<LoginResult> =>
      performLogin('api_key' in params ? { grant_type: 'api_key', api_key: params.api_key, mossBaseUrl: params.mossBaseUrl } : { grant_type: 'password', username: params.username, password: params.password, mossBaseUrl: params.mossBaseUrl }),
    [performLogin]
  );

  const enterpriseLoginWithOAuth2 = useCallback((params: Record<string, string>): Promise<LoginResult> => performLogin({ grant_type: 'oauth2', params }), [performLogin]);

  const logout = useCallback(async () => {
    localStorage.removeItem(GUEST_FLAG_KEY);

    // Web host: destroy the webui cookie session; no eeclaw IPC involved.
    if (isWebRuntime) {
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      } catch {
        /* server unreachable — clear local state anyway */
      }
      localStorage.removeItem(EECLAW_AUTH_STORAGE_KEY);
      setUser(null);
      setStatus('unauthenticated');
      setReady(true);
      return;
    }

    // Enterprise mode logout
    const eeclawStored = localStorage.getItem(EECLAW_AUTH_STORAGE_KEY);
    if (eeclawStored) {
      try {
        const authStorage: EeclawAuthStorage = JSON.parse(eeclawStored);
        const { access_token, refresh_token } = authStorage;
        const serverUrl = await ConfigStorage.get('eeclaw.serverUrl');

        if (serverUrl && access_token) {
          try {
            await fetch(`${serverUrl}/api/v1/auth/logout`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${access_token}`,
              },
              body: JSON.stringify({
                refresh_token: refresh_token || undefined,
              }),
            });
          } catch (error) {
            console.error('[Auth] Enterprise logout request failed:', error);
          }
        }
      } catch (error) {
        console.error('[Auth] Failed to parse enterprise auth storage:', error);
      }

      // Clear enterprise auth data
      localStorage.removeItem(EECLAW_AUTH_STORAGE_KEY);

      // Also trigger main-process logout to clear its storage and cache
      try {
        await ipcBridge.eeclaw.logout.invoke();
      } catch (e) {
        console.warn('[Auth] Failed to invoke main-process logout:', e);
      }

      // Cleanup sudocode.json and reset sessionMode on enterprise logout
      if (isDesktopRuntime) {
        if (!user?.execution) await ipcBridge.scode.saveConfig.invoke({ config: {} }).catch(() => {});
        await ConfigStorage.set('guid.sessionMode', 'local').catch(() => {});
        await ipcBridge.eeclaw.setSessionMode.invoke({ mode: 'local' }).catch(() => {});
      }

      // Clear enterprise ConfigStorage (but keep system.appMode = 'e')
      try {
        await ConfigStorage.set('eeclaw.authStorage', undefined);
      } catch {
        /* noop */
      }
      try {
        await ConfigStorage.set('eeclaw.userInfo', undefined);
      } catch {
        /* noop */
      }
      try {
        await ConfigStorage.set('eeclaw.localModeAvailable', undefined);
      } catch {
        /* noop */
      }

      setUser(null);
      setStatus('unauthenticated');
      setSyncMessage(null);
      setReady(true);
      return;
    }

    // C-side logout (original logic)
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    let session: AuthSession | undefined;

    if (stored) {
      try {
        const authStorage: AuthStorage = JSON.parse(stored);
        const { refresh_token, device_id } = authStorage;
        session = authStorage.session;

        await fetch(`${await getAuthServerBaseUrl()}/api/v1/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token, device_id }),
        });
      } catch (error) {
        console.error('[Auth] Logout request failed:', error);
      }
    }

    // 清除本地存储
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem('sudowork_auth_v1');

    // 清除用户手机号文件和用户 ID 文件
    if (isDesktopRuntime) {
      try {
        await ipcBridge.sudoworkAuth.clearUserPhone.invoke();
        await ipcBridge.sudoworkAuth.clearConsumerUserId.invoke();
        if (!user?.execution) await ipcBridge.scode.saveConfig.invoke({ config: {} }).catch(() => {});
        await ConfigStorage.set('guid.sessionMode', 'local').catch(() => {});
        // 清除 ConfigStorage 中的用户信息
        await ConfigStorage.set('consumer.userInfo', undefined);
        await openThirdPartyLogoutIfNeeded(session);
      } catch (error) {
        console.error('[Auth] Failed to clear user data:', error);
      }

      setUser(null);
      setStatus('unauthenticated');
      setSyncMessage(null);
      setReady(true);
      return;
    }

    try {
      await openThirdPartyLogoutIfNeeded(session);
      await fetch('/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({}),
      });
    } catch (error) {
      console.error('Logout request failed:', error);
    } finally {
      setUser(null);
      setStatus('unauthenticated');
      setSyncMessage(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      user,
      status,
      isGuest: status === 'guest',
      syncMessage,
      authFetch,
      login,
      register,
      logout,
      refresh,
      ensureValidToken,
      forceRefreshToken,
      enterpriseLogin,
      enterpriseLoginWithOAuth2,
      loginByPassword,
      registerByPassword,
      loginWithThirdPartyAuth,
      exchangeThirdPartyAuthCode,
      changePassword,
      enterGuest,
    }),
    [authFetch, login, register, logout, ready, refresh, status, syncMessage, user, ensureValidToken, forceRefreshToken, enterpriseLogin, enterpriseLoginWithOAuth2, loginByPassword, registerByPassword, loginWithThirdPartyAuth, exchangeThirdPartyAuthCode, changePassword, enterGuest]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
