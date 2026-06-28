import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import { getSudoworkServerBaseUrl } from '@/common/sudoworkServer';
import { ConfigStorage, type IConfigStorageRefer } from '@/common/storage';
import { pickDefaultImageModelFromPricing, pickImageGenerationModelId, resolveImageModelWithAvailability } from '@/common/imageGenerationModelConfig';
import { withCsrfToken } from '@/webserver/middleware/csrfClient';
import { getSudorouterPrimaryModelPath, mergeSudorouterProvidersIntoConfig } from '@/common/sudoclawModelConfig';
import { buildScodeConfigFromLoginPayload, SCODE_AUTO_MODEL_ALIAS } from '@/common/scodeConfig';
import { extractLoginSudoclawPayload, mergeLoginUserData } from '@/common/sudoworkAuthLogin';
import type { AcpModelInfo } from '@/types/acpTypes';

type AuthStatus = 'checking' | 'syncing' | 'authenticated' | 'unauthenticated';

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
  phone?: string;
  localAuth?: boolean;
  localModeAvailable?: boolean;
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
}

// Enterprise auth storage (localStorage, separate from C-side)
interface EeclawAuthStorage {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: AuthUser;
  device_id: string;
  /** How this session was established; drives which grant_type is used on refresh. */
  session_type?: 'password' | 'api_key' | 'oauth2';
}

interface LoginParams {
  phone: string;
  code: string;
  enterprise_code?: string;
  invitation_code?: string;
  remember?: boolean;
}

type LoginErrorCode = 'invalidCredentials' | 'tooManyAttempts' | 'serverError' | 'networkError' | 'unknown';

interface LoginResult {
  success: boolean;
  message?: string;
  code?: LoginErrorCode;
  status?: number;
  need_register?: boolean;
  register_token?: string;
  phone?: string;
}

interface RegisterParams {
  register_token: string;
  nickname: string;
  invitation_code: string;
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

async function syncScodeGuidModelPreference(modelId: string): Promise<void> {
  try {
    const config = ((await ConfigStorage.get('acp.config').catch((): undefined => undefined)) || {}) as IConfigStorageRefer['acp.config'];
    const backendConfig = config.scode || {};
    await ConfigStorage.set('acp.config', {
      ...config,
      scode: {
        ...backendConfig,
        preferredModelId: modelId,
      },
    });
  } catch {
    /* best-effort */
  }

  try {
    const cached = ((await ConfigStorage.get('acp.cachedModels').catch((): undefined => undefined)) || {}) as Record<string, AcpModelInfo>;
    const scodeCached = cached.scode as AcpModelInfo | undefined;
    if (!scodeCached?.availableModels?.length) return;
    const match = scodeCached.availableModels.find((model) => model.id === modelId);
    await ConfigStorage.set('acp.cachedModels', {
      ...cached,
      scode: {
        ...scodeCached,
        currentModelId: modelId,
        currentModelLabel: match?.label || modelId,
      },
    });
  } catch {
    /* best-effort */
  }
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
  need_register?: boolean;
  register_token?: string;
  phone?: string;
  data?: LoginSuccessResponse['data'];
};

type SetAuthUser = (user: AuthUser | null) => void;
type SetAuthStatus = (status: AuthStatus) => void;
type SetAuthReady = (ready: boolean) => void;
type SetSyncMessage = (message: string | null) => void;

// Enterprise login params
interface EnterpriseLoginParams {
  username: string;
  password: string;
}

interface EnterpriseLoginParamsByKey {
  api_key: string;
}

interface AuthContextValue {
  ready: boolean;
  user: AuthUser | null;
  status: AuthStatus;
  syncMessage: string | null;
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
  changePassword: (params: ChangePasswordParams) => Promise<PasswordAuthResult>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const AUTH_USER_ENDPOINT = '/api/auth/user';
const AUTH_STORAGE_KEY = 'sudowork_auth_v2';
export const EECLAW_AUTH_STORAGE_KEY = 'eeclaw_auth_v1';
const DEVICE_ID_KEY = 'sudowork_device_id';

const isDesktopRuntime = typeof window !== 'undefined' && Boolean(window.electronAPI);

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

// 同步图像生成模型到 sudocode/sudoclaw：尊重用户已保存的选择，不再无条件覆盖为默认值
// Apply the image model on login: respect the user's saved selection instead of unconditionally forcing the default.
async function applyLoginImageModel(): Promise<void> {
  const saved = await ConfigStorage.get('tools.imageGenerationModel').catch((): undefined => undefined);
  const res = await ipcBridge.scode.fetchSpecificImagePricing.invoke().catch((): null => null);
  const items = res?.success && Array.isArray(res.data) ? res.data : null; // null = 失败
  if (!saved) {
    const def = items ? pickDefaultImageModelFromPricing(items) : '';
    await ipcBridge.scode.setImageModel.invoke({ modelId: def || null }).catch(() => {});
    return;
  }
  if (items === null || items.length === 0) {
    await ipcBridge.scode.setImageModel.invoke({ modelId: pickImageGenerationModelId(saved) }).catch(() => {});
    return;
  }
  const { jsonModelId, persistedUseModel, changed } = resolveImageModelWithAvailability(saved, items);
  if (changed) {
    await ConfigStorage.set('tools.imageGenerationModel', { ...saved, useModel: persistedUseModel }).catch(() => {});
  }
  await ipcBridge.scode.setImageModel.invoke({ modelId: jsonModelId }).catch(() => {});
}

// 处理登录成功后的通用逻辑
/**
 * Fetch the server-driven credentials envelope (with the renderer-held JWT) and forward
 * {nonce, ciphertext} to the main process for decryption + caching. Used by BOTH login
 * paths — active login (handleLoginSuccess) and restart restore (refresh) — per §6.4, so
 * reporters/skillhub keep working after a restart without a manual re-login.
 * The JWT never leaves the renderer; only the encrypted envelope crosses IPC.
 */
async function fetchAndCacheCredentials(): Promise<void> {
  if (!isDesktopRuntime) return;
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) return;
    const authStorage = JSON.parse(stored) as AuthStorage;
    const jwt = authStorage.access_token;
    if (!jwt) return;
    const res = await fetch(`${await getSudoworkServerBaseUrl()}/api/v1/system-config/credentials`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const json = (await res.json()) as { success?: boolean; nonce?: string; ciphertext?: string };
    if (!json?.success || !json.nonce || !json.ciphertext) return;
    await ipcBridge.systemConfig.cacheCredentials.invoke({ nonce: json.nonce, ciphertext: json.ciphertext });
  } catch (err) {
    console.warn('[Auth] fetch/cache server credentials failed:', err);
  }
}

async function handleLoginSuccess(data: LoginSuccessResponse, setUser: SetAuthUser, setStatus: SetAuthStatus, setReady: SetAuthReady, setSyncMessage: SetSyncMessage, tenantIdFallback?: string) {
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

  if (isDesktopRuntime) {
    // §6.4 active-login path: cache server-driven credentials BEFORE restarting the gateway
    // subprocess so env injection (skillhub url/token) sees the dispatched values.
    await fetchAndCacheCredentials();
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
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Mutex to prevent concurrent refresh calls
  const refreshPromiseRef = useRef<Promise<boolean> | null>(null);
  // Cooldown to prevent rapid repeated refresh
  const lastRefreshAtRef = useRef<number>(0);
  const REFRESH_COOLDOWN_MS = 30_000;

  // Token 刷新函数 — supports both C-side and enterprise mode
  const refreshTokens = useCallback(async (): Promise<boolean> => {
    // Cooldown: skip if refreshed recently
    if (Date.now() - lastRefreshAtRef.current < REFRESH_COOLDOWN_MS) {
      return false;
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
              return true;
            }
            console.error('[Auth] Enterprise token refresh via IPC failed');
            return false;
          } catch (error) {
            console.error('[Auth] Enterprise token refresh via IPC failed:', error);
            return false;
          }
        }

        // C-side mode: refresh from sudowork server
        const stored = localStorage.getItem(AUTH_STORAGE_KEY);
        if (!stored) return false;

        try {
          const authStorage: AuthStorage = JSON.parse(stored);
          const { refresh_token, device_id } = authStorage;

          const response = await fetch(`${await getSudoworkServerBaseUrl()}/api/v1/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token, device_id }),
          });

          const data = await response.json();
          if (data.success) {
            const newStorage: AuthStorage = {
              access_token: data.access_token,
              refresh_token: data.refresh_token,
              expires_at: Date.now() + data.expires_in * 1000,
              user: authStorage.user,
              device_id: device_id || getDeviceId(),
            };

            localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(newStorage));
            setUser({ ...authStorage.user, token: data.access_token });
            lastRefreshAtRef.current = Date.now();
            console.log('[Auth] Token refreshed successfully');
            return true;
          }
        } catch (error) {
          console.error('[Auth] Token refresh failed:', error);
        }

        return false;
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
        try {
          const authStorage: EeclawAuthStorage = JSON.parse(eeclawStored);
          const { access_token, expires_at } = authStorage;

          if (forceRefresh || (expires_at && Date.now() > expires_at - 5 * 60 * 1000)) {
            const refreshed = await refreshTokens();
            if (refreshed) {
              const newStorage = JSON.parse(localStorage.getItem(EECLAW_AUTH_STORAGE_KEY) || '{}');
              return newStorage.access_token || null;
            }
            // Refresh failed (e.g. provider has no refresh API). Keep using the
            // current access_token while it is still valid; only give up once it
            // has actually expired, at which point re-login is required.
            if (!forceRefresh && expires_at && Date.now() < expires_at) {
              return access_token;
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
            const refreshed = await refreshTokens();
            if (!refreshed) {
              return null;
            }
            const newStorage = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || '{}');
            return newStorage.access_token || null;
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
    [refreshTokens]
  );

  // 强制刷新 Token — supports both modes
  const forceRefreshToken = useCallback(async (): Promise<string | null> => {
    console.log('[Auth] Force refreshing token...');

    // Enterprise mode
    const eeclawStored = localStorage.getItem(EECLAW_AUTH_STORAGE_KEY);
    if (eeclawStored) {
      try {
        const authStorage: EeclawAuthStorage = JSON.parse(eeclawStored);
        if (authStorage.refresh_token) {
          return ensureValidToken(true);
        }
      } catch (error) {
        console.error('[Auth] Failed to check enterprise auth storage:', error);
      }
      console.warn('[Auth] No enterprise refresh_token available, user needs to re-login');
      return null;
    }

    // C-side
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      try {
        const authStorage: AuthStorage = JSON.parse(stored);
        if (authStorage.refresh_token) {
          return ensureValidToken(true);
        }
      } catch (error) {
        console.error('[Auth] Failed to check auth storage:', error);
      }
    }

    console.warn('[Auth] No refresh_token available, user needs to re-login');
    return null;
  }, [ensureValidToken]);

  const refresh = useCallback(async () => {
    // === Enterprise mode: restore from eeclaw_auth_v1 ===
    const eeclawStored = localStorage.getItem(EECLAW_AUTH_STORAGE_KEY);
    if (eeclawStored) {
      try {
        const authStorage: EeclawAuthStorage = JSON.parse(eeclawStored);

        if (!authStorage.user) {
          localStorage.removeItem(EECLAW_AUTH_STORAGE_KEY);
        } else {
          setUser(authStorage.user);
          setStatus('authenticated');
          setReady(true);
          await syncScodeGuidModelPreference(SCODE_AUTO_MODEL_ALIAS);

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

          // Check if token needs refresh
          if (authStorage.expires_at && Date.now() > authStorage.expires_at - 5 * 60 * 1000) {
            await refreshTokens();
          }
          return;
        }
      } catch {
        localStorage.removeItem(EECLAW_AUTH_STORAGE_KEY);
      }
    }

    // === C-side: original logic ===
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

        setUser({ ...authStorage.user, token: authStorage.access_token });
        setStatus('authenticated');
        setReady(true);
        // §6.4 restart-restore path: also cache credentials so reporters/skillhub work after
        // a restart without requiring a manual re-login (fire-and-forget, don't block restore).
        void fetchAndCacheCredentials();
        await syncScodeGuidModelPreference(SCODE_AUTO_MODEL_ALIAS);

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
          await refreshTokens();
        }
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

    if (isDesktopRuntime) {
      setStatus('unauthenticated');
      setUser(null);
      setReady(true);
      return;
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
  }, [refreshTokens]);

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
      localStorage.removeItem(EECLAW_AUTH_STORAGE_KEY);
      setUser(null);
      setStatus('unauthenticated');
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const login = useCallback(async ({ phone, code, enterprise_code, invitation_code: _invitation_code, remember: _remember }: LoginParams): Promise<LoginResult> => {
    const deviceId = getDeviceId();

    try {
      const response = await fetch(`${await getSudoworkServerBaseUrl()}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': deviceId,
        },
        body: JSON.stringify({ phone, code, enterprise_code }),
      });

      const data = (await response.json()) as AuthApiResponse;

      // 用户不存在，需要注册
      if (data.need_register) {
        return {
          success: false,
          status: data.status,
          need_register: true,
          register_token: data.register_token,
          phone: data.phone,
          message: data.msg || '用户不存在，请先注册',
        };
      }

      if (!response.ok || !data.success || !data.data) {
        return {
          success: false,
          status: data.status,
          message: data?.msg || data?.message || '登录失败',
          code: 'invalidCredentials',
        };
      }

      await handleLoginSuccess({ data: data.data }, setUser, setStatus, setReady, setSyncMessage, enterprise_code);
      return { success: true };
    } catch (error) {
      console.error('Login request failed:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : '连接到中控服务器失败',
        code: 'networkError',
      };
    }
  }, []);

  const register = useCallback(async ({ register_token, nickname, invitation_code }: RegisterParams): Promise<RegisterResult> => {
    const deviceId = getDeviceId();

    try {
      const response = await fetch(`${await getSudoworkServerBaseUrl()}/api/v1/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': deviceId,
        },
        body: JSON.stringify({ register_token, nickname, invitation_code }),
      });

      const data = (await response.json()) as AuthApiResponse;

      if (!response.ok || !data.success || !data.data) {
        return {
          success: false,
          message: data?.msg || data?.message || '注册失败',
          code: 'invalidCredentials',
        };
      }

      await handleLoginSuccess({ data: data.data }, setUser, setStatus, setReady, setSyncMessage);
      return { success: true };
    } catch (error) {
      console.error('Register request failed:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : '连接到中控服务器失败',
        code: 'networkError',
      };
    }
  }, []);

  // 用户名密码登录（system login_method=1 时使用），复用 handleLoginSuccess
  const loginByPassword = useCallback(async ({ phone, password }: PasswordLoginParams): Promise<PasswordAuthResult> => {
    const deviceId = getDeviceId();
    try {
      const response = await fetch(`${await getSudoworkServerBaseUrl()}/api/v1/auth/login-by-config`, {
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
      const response = await fetch(`${await getSudoworkServerBaseUrl()}/api/v1/auth/register-password`, {
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

  // 修改密码（login_method=1 的用户改自己的密码）；token 过期时由调用方提示重登
  const changePassword = useCallback(
    async ({ oldPassword, newPassword }: ChangePasswordParams): Promise<PasswordAuthResult> => {
      const token = await ensureValidToken();
      if (!token) {
        return { success: false, message: '登录状态已过期，请重新登录' };
      }
      try {
        const response = await fetch(`${await getSudoworkServerBaseUrl()}/api/v1/auth/change-password`, {
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

  // Shared post-login handling for all enterprise grant types (password / api_key / oauth2).
  // Persists tokens, sets up scode/session mode, and updates auth state.
  const finalizeEnterpriseLogin = useCallback(async (result: Awaited<ReturnType<typeof ipcBridge.eeclaw.login.invoke>>, deviceId: string, sessionType: 'password' | 'api_key' | 'oauth2'): Promise<LoginResult> => {
    if (!result.success || !result.data) {
      return {
        success: false,
        message: (result as any).error === 'network_error' ? '连接到企业服务器失败' : (result as any).error || result.msg || '登录失败',
        code: 'invalidCredentials',
      };
    }

    const data = result.data;

    // Map MOSS user to AuthUser compatible type
    const mappedUser = mapEnterpriseUser(data.user, data.access_token);

    // --- localModeAvailable calculation (before localStorage serialization) ---
    const localModeAvailable = !!(data.user.localAuth && data.sudorouter_key && data.model_service_url && Array.isArray(data.models) && data.models.length > 0);
    mappedUser.localModeAvailable = localModeAvailable;

    // Save to localStorage (eeclaw_auth_v1, separate from C-side)
    const eeclawAuthStorage: EeclawAuthStorage = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || '',
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      user: mappedUser,
      device_id: deviceId,
      session_type: sessionType,
    };
    localStorage.setItem(EECLAW_AUTH_STORAGE_KEY, JSON.stringify(eeclawAuthStorage));

    // --- sudocode.json generation/cleanup + sessionMode reset ---
    if (isDesktopRuntime) {
      if (localModeAvailable) {
        const loginSudoclawPayload = extractLoginSudoclawPayload(result);
        if (loginSudoclawPayload) {
          const currentScodeConfig = await ipcBridge.scode.getConfig.invoke().catch((): null => null);
          const pricingRes = await ipcBridge.scode.fetchSpecificPricing.invoke().catch((): null => null);
          const pricingItems = pricingRes?.data ?? [];
          const scodeConfig = buildScodeConfigFromLoginPayload(loginSudoclawPayload, currentScodeConfig?.data, pricingItems);
          await ipcBridge.scode.saveConfig.invoke({ config: scodeConfig }).catch((err) => {
            console.warn('[Auth] Failed to save scode config on enterprise login:', err);
          });
          const restoreRes = await ipcBridge.scode.restoreCustomModelProviders.invoke({ userId: mappedUser.id }).catch((err): null => {
            console.warn('[Auth] Failed to restore custom scode models on enterprise login:', err);
            return null;
          });
          await applyLoginImageModel();
          // Sync settings.json to the merged default model while preserving a user-selected custom model.
          const defaultModel = restoreRes?.data?.default_model || scodeConfig.default_model;
          if (defaultModel) {
            await ipcBridge.scode.setDefaultModel.invoke({ modelId: defaultModel }).catch(() => {});
          }
          await syncScodeGuidModelPreference(SCODE_AUTO_MODEL_ALIAS);
        }
      } else {
        await ipcBridge.scode.saveConfig.invoke({ config: {} }).catch(() => {});
        await ConfigStorage.set('guid.sessionMode', 'remote').catch(() => {});
        await ipcBridge.eeclaw.setSessionMode.invoke({ mode: 'remote' }).catch(() => {});
      }
    }

    // Save user info to ConfigStorage
    try {
      await ConfigStorage.set('eeclaw.userInfo', {
        id: data.user.id,
        username: data.user.name,
        role: data.user.role,
      });
      await ConfigStorage.set('eeclaw.localModeAvailable', localModeAvailable);
    } catch (e) {
      console.warn('[Auth] Failed to save enterprise user info:', e);
    }

    // Sync token to ConfigStorage for eeclawBridge
    const configAuthStorage = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || '',
      expires_at: eeclawAuthStorage.expires_at,
      device_id: deviceId,
      session_type: sessionType,
    };
    try {
      await ConfigStorage.set('eeclaw.authStorage', configAuthStorage);
    } catch (e) {
      console.warn('[Auth] Failed to sync eeclaw auth to ConfigStorage (will retry):', e);
      // Retry once
      try {
        await ConfigStorage.set('eeclaw.authStorage', configAuthStorage);
      } catch (e2) {
        console.error('[Auth] Failed to sync eeclaw auth to ConfigStorage after retry:', e2);
      }
    }

    // Set auth state
    setUser(mappedUser);
    setStatus('authenticated');
    setReady(true);

    return { success: true };
  }, []);

  // Enterprise login — independent from C-side login flow
  const enterpriseLogin = useCallback(
    async (params: EnterpriseLoginParams | EnterpriseLoginParamsByKey): Promise<LoginResult> => {
      try {
        const serverUrl = await ConfigStorage.get('eeclaw.serverUrl');
        if (!serverUrl) {
          return { success: false, message: '未配置企业服务器地址' };
        }

        const deviceId = getDeviceId();
        // Build MOSS-compatible request body with grant_type
        const isApiKeyLogin = 'api_key' in params;
        const requestBody = isApiKeyLogin ? { grant_type: 'api_key', api_key: (params as EnterpriseLoginParamsByKey).api_key } : { grant_type: 'password', username: (params as EnterpriseLoginParams).username, password: (params as EnterpriseLoginParams).password };

        // Use IPC bridge to avoid CORS (main process has no CORS restrictions)
        const result = await ipcBridge.eeclaw.login.invoke({
          serverUrl,
          body: requestBody,
          deviceId,
        });

        return finalizeEnterpriseLogin(result, deviceId, isApiKeyLogin ? 'api_key' : 'password');
      } catch (error) {
        console.error('[Auth] Enterprise login failed:', error);
        return {
          success: false,
          message: error instanceof Error ? error.message : '连接到企业服务器失败',
          code: 'networkError',
        };
      }
    },
    [finalizeEnterpriseLogin]
  );

  // Enterprise OAuth2 login — completes after the browser redirects back via the
  // sudowork:// deep link. `params` is the opaque dict of deep-link query params
  // (code / access_token / refresh_token / …); moss hands it to the credential script.
  const enterpriseLoginWithOAuth2 = useCallback(
    async (params: Record<string, string>): Promise<LoginResult> => {
      try {
        const serverUrl = await ConfigStorage.get('eeclaw.serverUrl');
        if (!serverUrl) {
          return { success: false, message: '未配置企业服务器地址' };
        }

        const deviceId = getDeviceId();
        const result = await ipcBridge.eeclaw.login.invoke({
          serverUrl,
          body: { grant_type: 'oauth2', params },
          deviceId,
        });

        return finalizeEnterpriseLogin(result, deviceId, 'oauth2');
      } catch (error) {
        console.error('[Auth] Enterprise OAuth2 login failed:', error);
        return {
          success: false,
          message: error instanceof Error ? error.message : '连接到企业服务器失败',
          code: 'networkError',
        };
      }
    },
    [finalizeEnterpriseLogin]
  );

  const logout = useCallback(async () => {
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
        await ipcBridge.scode.saveConfig.invoke({ config: {} }).catch(() => {});
        await ConfigStorage.set('guid.sessionMode', 'remote').catch(() => {});
        await ipcBridge.eeclaw.setSessionMode.invoke({ mode: 'remote' }).catch(() => {});
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

    if (stored) {
      try {
        const authStorage: AuthStorage = JSON.parse(stored);
        const { refresh_token, device_id } = authStorage;

        await fetch(`${await getSudoworkServerBaseUrl()}/api/v1/auth/logout`, {
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
        await ipcBridge.scode.saveConfig.invoke({ config: {} }).catch(() => {});
        await ConfigStorage.set('guid.sessionMode', 'remote').catch(() => {});
        // 清除 ConfigStorage 中的用户信息
        await ConfigStorage.set('consumer.userInfo', undefined);
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
      await fetch('/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(withCsrfToken({})),
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
      syncMessage,
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
      changePassword,
    }),
    [login, register, logout, ready, refresh, status, syncMessage, user, ensureValidToken, forceRefreshToken, enterpriseLogin, enterpriseLoginWithOAuth2, loginByPassword, registerByPassword, changePassword]
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
