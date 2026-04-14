import { ipcBridge } from '@/common';
import { SUDOWORK_SERVER_BASE_URL } from '@/common/sudoworkServer';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { withCsrfToken } from '@/webserver/middleware/csrfClient';
import { getSudorouterPrimaryModelPath, mergeSudorouterProvidersIntoConfig } from '@/common/sudoclawModelConfig';
import { extractLoginSudoclawPayload, mergeLoginUserData } from '@/common/sudoworkAuthLogin';

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
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const AUTH_USER_ENDPOINT = '/api/auth/user';
const AUTH_STORAGE_KEY = 'sudowork_auth_v2';
const DEVICE_ID_KEY = 'sudowork_device_id';

const isDesktopRuntime = typeof window !== 'undefined' && Boolean(window.electronAPI);

function hasSudoclawApiKey(config: { models?: { providers?: Record<string, { apiKey?: string }> } } | null | undefined): boolean {
  return Object.values(config?.models?.providers || {}).some((provider) => !!provider?.apiKey?.trim());
}

async function ensureSudoclawHasApiKey(): Promise<boolean> {
  if (!isDesktopRuntime) {
    return true;
  }

  try {
    const res = await ipcBridge.sudoclaw.getConfig.invoke();
    return hasSudoclawApiKey(res?.data);
  } catch (error) {
    console.error('[Auth] Failed to inspect Sudoclaw config:', error);
    return false;
  }
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

// 处理登录成功后的通用逻辑
async function handleLoginSuccess(data: LoginSuccessResponse, setUser: SetAuthUser, setStatus: SetAuthStatus, setReady: SetAuthReady, setSyncMessage: SetSyncMessage) {
  const deviceId = getDeviceId();
  const mergedUser = mergeLoginUserData(data) as unknown as AuthUser;
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

  if (isDesktopRuntime) {
    if (!loginSudoclawPayload) {
      setUser(null);
      setStatus('unauthenticated');
      setReady(true);
      throw new Error('登录响应缺少 Sudoclaw API Key 配置');
    }

    setReady(true);

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
              primary: getSudorouterPrimaryModelPath('gemini-3-flash-preview'),
            },
          },
        };
      }

      const saveRes = await ipcBridge.sudoclaw.saveConfig.invoke({ config: patch });
      if (!saveRes?.success) {
        throw new Error(saveRes?.msg || 'Sudoclaw saveConfig failed');
      }
    } catch (error) {
      setSyncMessage(null);
      setUser(null);
      setStatus('unauthenticated');
      setReady(true);
      console.error('[Auth] Sudoclaw 配置失败:', error);
      throw error;
    }
  }

  setSyncMessage(null);
  setUser(authData);
  setStatus('authenticated');
  setReady(true);

  if (isDesktopRuntime) {
    void ipcBridge.sudoclaw.restartGateway
      .invoke()
      .then((restartRes) => {
        if (!restartRes?.success) {
          console.error('[Auth] Sudoclaw 后台重启失败:', restartRes?.msg || 'Sudoclaw restartGateway failed');
          return;
        }
        console.log('[Auth] Sudoclaw 正在后台重启');
      })
      .catch((error) => {
        console.error('[Auth] Sudoclaw 后台重启失败:', error);
      });
  }
}

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Token 刷新函数
  const refreshTokens = useCallback(async (): Promise<boolean> => {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) return false;

    try {
      const authStorage: AuthStorage = JSON.parse(stored);
      const { refresh_token, device_id } = authStorage;

      const response = await fetch(`${SUDOWORK_SERVER_BASE_URL}/api/v1/auth/refresh`, {
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
        console.log('[Auth] Token refreshed successfully');
        return true;
      }
    } catch (error) {
      console.error('[Auth] Token refresh failed:', error);
    }

    return false;
  }, []);

  // 确保有效 Token（在请求前调用）
  const ensureValidToken = useCallback(
    async (forceRefresh = false): Promise<string | null> => {
      // 优先检查新版本存储
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (stored) {
        try {
          const authStorage: AuthStorage = JSON.parse(stored);
          const { access_token, expires_at } = authStorage;

          // 强制刷新 或 提前 5 分钟刷新
          if (forceRefresh || (expires_at && Date.now() > expires_at - 5 * 60 * 1000)) {
            const refreshed = await refreshTokens();
            if (!refreshed) {
              // refresh_token 也过期，需要重新登录
              return null;
            }
            // 返回新的 access_token
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
          // 旧版本没有 refresh_token，直接返回 token
          // 如果 token 失效，用户需要重新登录才能获得新机制
          return oldAuthData.token || null;
        } catch (error) {
          console.error('[Auth] Failed to parse old auth storage:', error);
        }
      }

      return null;
    },
    [refreshTokens]
  );

  // 强制刷新 Token（当服务器返回 401 时调用）
  const forceRefreshToken = useCallback(async (): Promise<string | null> => {
    console.log('[Auth] Force refreshing token...');

    // 检查是否有新版本存储（有 refresh_token）
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      try {
        const authStorage: AuthStorage = JSON.parse(stored);
        if (authStorage.refresh_token) {
          // 有 refresh_token，可以刷新
          return ensureValidToken(true);
        }
      } catch (error) {
        console.error('[Auth] Failed to check auth storage:', error);
      }
    }

    // 旧版本用户没有 refresh_token，返回 null 让用户重新登录
    console.warn('[Auth] No refresh_token available, user needs to re-login');
    return null;
  }, [ensureValidToken]);

  const refresh = useCallback(async () => {
    // 优先检查新版本存储
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

        // 从 localStorage 恢复登录状态时，也保存手机号到文件
        if (isDesktopRuntime && authStorage.user.phone) {
          ipcBridge.sudoworkAuth.saveUserPhone.invoke({ phone: authStorage.user.phone }).catch((error) => {
            console.error('[Auth] Failed to save user phone on restore:', error);
          });
        }

        // 检查 token 是否需要刷新
        if (authStorage.expires_at && Date.now() > authStorage.expires_at - 5 * 60 * 1000) {
          await refreshTokens();
        }
        return;
      } catch (e) {
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

        // 旧 token 没有 refresh_token，用户需要重新登录才能获得新机制
        setUser(parsed);
        setStatus('authenticated');
        setReady(true);

        if (isDesktopRuntime && parsed.phone) {
          ipcBridge.sudoworkAuth.saveUserPhone.invoke({ phone: parsed.phone }).catch((error) => {
            console.error('[Auth] Failed to save user phone on restore:', error);
          });
        }
        return;
      } catch (e) {
        localStorage.removeItem('sudowork_auth_v1');
      }
    }

    if (isDesktopRuntime) {
      // 桌面端默认未登录，除非有本地存储的 Token
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

  const login = useCallback(async ({ phone, code, enterprise_code, invitation_code: _invitation_code, remember: _remember }: LoginParams): Promise<LoginResult> => {
    const deviceId = getDeviceId();

    try {
      const response = await fetch(`${SUDOWORK_SERVER_BASE_URL}/api/v1/auth/login`, {
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

      await handleLoginSuccess({ data: data.data }, setUser, setStatus, setReady, setSyncMessage);
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
      const response = await fetch(`${SUDOWORK_SERVER_BASE_URL}/api/v1/auth/register`, {
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

  const logout = useCallback(async () => {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);

    if (stored) {
      try {
        const authStorage: AuthStorage = JSON.parse(stored);
        const { refresh_token, device_id } = authStorage;

        // 调用服务端注销接口
        await fetch(`${SUDOWORK_SERVER_BASE_URL}/api/v1/auth/logout`, {
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
    localStorage.removeItem('sudowork_auth_v1'); // 也清理旧版本

    // 清除用户手机号文件
    if (isDesktopRuntime) {
      try {
        await ipcBridge.sudoworkAuth.clearUserPhone.invoke();
      } catch (error) {
        console.error('[Auth] Failed to clear user phone:', error);
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
    }),
    [login, register, logout, ready, refresh, status, syncMessage, user, ensureValidToken, forceRefreshToken]
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
