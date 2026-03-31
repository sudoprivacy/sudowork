import { ipcBridge } from '@/common';
import { SUDOWORK_SERVER_BASE_URL } from '@/common/sudoworkServer';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { withCsrfToken } from '@/webserver/middleware/csrfClient';
import type { SudoclawConfig } from '@/common/ipcBridge';

type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

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

interface AuthContextValue {
  ready: boolean;
  user: AuthUser | null;
  status: AuthStatus;
  login: (params: LoginParams) => Promise<LoginResult>;
  register: (params: RegisterParams) => Promise<RegisterResult>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const AUTH_USER_ENDPOINT = '/api/auth/user';

const isDesktopRuntime = typeof window !== 'undefined' && Boolean(window.electronAPI);

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
async function handleLoginSuccess(data: any, setUser: (user: AuthUser) => void, setStatus: (status: AuthStatus) => void, setReady: (ready: boolean) => void) {
  const authData = { ...data.data.user, token: data.data.token };
  setUser(authData);
  setStatus('authenticated');
  localStorage.setItem('sudowork_auth_v1', JSON.stringify(authData));
  setReady(true);

  // 保存用户手机号到配置文件供 skill 读取
  // Save user phone to config file for skill access
  if (isDesktopRuntime && authData.phone) {
    try {
      await ipcBridge.sudoworkAuth.saveUserPhone.invoke({ phone: authData.phone });
      console.log('[Auth] User phone saved to config');
    } catch (error) {
      console.error('[Auth] Failed to save user phone:', error);
    }
  }

  // 自动配置 Sudoclaw
  if (authData.model_service_url && authData.sudorouter_key && authData.models?.length) {
    try {
      // 获取当前配置（保留用户其他设置）
      const currentConfig = await ipcBridge.sudoclaw.getConfig.invoke();
      const currentProviders = currentConfig?.data?.models?.providers || {};
      const existingSudorouter = currentProviders['sudorouter'] || {};

      // 构建 provider models
      const providerModels = authData.models.map((id: string) => ({ id, name: id }));

      // 构建 provider 配置（保留原有的 api 字段）
      const providers = {
        ...currentProviders,
        sudorouter: {
          ...existingSudorouter,
          baseUrl: authData.model_service_url,
          apiKey: authData.sudorouter_key,
          models: providerModels,
        },
      };

      // 确定 primary model（优先使用 gemini-3-flash-preview）
      const primaryModel = authData.models.includes('gemini-3-flash-preview') ? 'gemini-3-flash-preview' : authData.models[0] || 'gemini-3-flash-preview';

      // 更新配置（保留所有原有字段）
      const patch: SudoclawConfig = {
        ...currentConfig?.data,
        models: {
          mode: currentConfig?.data?.models?.mode || 'merge',
          providers,
        },
        agents: {
          ...currentConfig?.data?.agents,
          defaults: {
            ...currentConfig?.data?.agents?.defaults,
            model: {
              ...currentConfig?.data?.agents?.defaults?.model,
              primary: `sudorouter/${primaryModel}`,
            },
          },
        },
      };

      await ipcBridge.sudoclaw.saveConfig.invoke({ config: patch });
      console.log('[Auth] Sudoclaw 配置已更新');
    } catch (error) {
      console.error('[Auth] Sudoclaw 配置失败:', error);
      // 不阻止登录流程
    }
  }
}

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [ready, setReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const stored = localStorage.getItem('sudowork_auth_v1');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setUser(parsed);
        setStatus('authenticated');
        setReady(true);

        // 从 localStorage 恢复登录状态时，也保存手机号到文件
        // Save phone to file when restoring auth from localStorage
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
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      abortRef.current?.abort();
    };
  }, [refresh]);

  const login = useCallback(async ({ phone, code, enterprise_code, invitation_code, remember }: LoginParams): Promise<LoginResult> => {
    try {
      const response = await fetch(`${SUDOWORK_SERVER_BASE_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phone, code, enterprise_code }),
      });

      const data = (await response.json()) as any;

      // 用户不存在，需要注册
      if (data.need_register) {
        return {
          success: false,
          need_register: true,
          register_token: data.register_token,
          phone: data.phone,
          message: data.msg || '用户不存在，请先注册',
        };
      }

      if (!response.ok || !data.success || !data.data) {
        return {
          success: false,
          message: data?.msg || data?.message || '登录失败',
          code: 'invalidCredentials',
        };
      }

      await handleLoginSuccess(data, setUser, setStatus, setReady);
      return { success: true };
    } catch (error) {
      console.error('Login request failed:', error);
      return {
        success: false,
        message: '连接到中控服务器失败',
        code: 'networkError',
      };
    }
  }, []);

  const register = useCallback(async ({ register_token, nickname, invitation_code }: RegisterParams): Promise<RegisterResult> => {
    try {
      const response = await fetch(`${SUDOWORK_SERVER_BASE_URL}/api/v1/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ register_token, nickname, invitation_code }),
      });

      const data = (await response.json()) as any;

      if (!response.ok || !data.success || !data.data) {
        return {
          success: false,
          message: data?.msg || data?.message || '注册失败',
          code: 'invalidCredentials',
        };
      }

      await handleLoginSuccess(data, setUser, setStatus, setReady);
      return { success: true };
    } catch (error) {
      console.error('Register request failed:', error);
      return {
        success: false,
        message: '连接到中控服务器失败',
        code: 'networkError',
      };
    }
  }, []);

  const logout = useCallback(async () => {
    localStorage.removeItem('sudowork_auth_v1');

    // 清除用户手机号文件
    // Clear user phone file on logout
    if (isDesktopRuntime) {
      try {
        await ipcBridge.sudoworkAuth.clearUserPhone.invoke();
      } catch (error) {
        console.error('[Auth] Failed to clear user phone:', error);
      }

      setUser(null);
      setStatus('unauthenticated');
      setReady(true);
      return;
    }

    try {
      await fetch('/logout', {
        method: 'POST',
        // Logout also needs CSRF token / 登出同样需要 CSRF Token
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
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      user,
      status,
      login,
      register,
      logout,
      refresh,
    }),
    [login, register, logout, ready, refresh, status, user]
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
