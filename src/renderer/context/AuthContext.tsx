import { ipcBridge } from '@/common';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { withCsrfToken } from '@/webserver/middleware/csrfClient';

type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

export interface AuthUser {
  id: string;
  nickname: string;
  role: 'ADMIN' | 'USER';
  status: number;
  enterprise_code?: string;
  token?: string;
}

interface LoginParams {
  phone: string;
  code: string;
  enterprise_code: string;
  remember?: boolean;
}

type LoginErrorCode = 'invalidCredentials' | 'tooManyAttempts' | 'serverError' | 'networkError' | 'unknown';

interface LoginResult {
  success: boolean;
  message?: string;
  code?: LoginErrorCode;
}

interface AuthContextValue {
  ready: boolean;
  user: AuthUser | null;
  status: AuthStatus;
  login: (params: LoginParams) => Promise<LoginResult>;
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

  const login = useCallback(async ({ phone, code, enterprise_code, remember }: LoginParams): Promise<LoginResult> => {
    try {
      const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
      const baseUrl = serverConfig.baseUrl || 'http://localhost:3000';

      const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phone, code, enterprise_code }),
      });

      const data = (await response.json()) as any;

      if (!response.ok || !data.success || !data.data) {
        return {
          success: false,
          message: data?.msg || data?.message || '登录失败',
          code: 'invalidCredentials',
          status: data?.status,
        } as any;
      }

      const authData = { ...data.data.user, token: data.data.token };
      setUser(authData);
      setStatus('authenticated');
      localStorage.setItem('sudowork_auth_v1', JSON.stringify(authData));
      setReady(true);

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

  const logout = useCallback(async () => {
    localStorage.removeItem('sudowork_auth_v1');
    if (isDesktopRuntime) {
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
      logout,
      refresh,
    }),
    [login, logout, ready, refresh, status, user]
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
