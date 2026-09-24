/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { fetchSystemConfig, type SystemConfig } from '@sudowork/common/systemConfig';
import type { AuthMethod } from '@sudowork/common/systemConfigTypes';
import { getAuthServerBaseUrl } from '@sudowork/host-bridge/authServer';
import { THIRD_PARTY_LOGIN_METHOD } from '@sudowork/common/thirdPartyAuthConfig';

/** 0 = 手机验证码；1 = 用户名密码；2 = 三方认证登录 */
export type LoginMethod = 0 | 1 | 2;

export interface SystemLoginMethodState {
  /** null 表示尚未拿到结果；拿到后为 0、1 或 2 */
  loginMethod: LoginMethod | null;
  systemConfig: SystemConfig | null;
  authMethods: AuthMethod[];
  isLoading: boolean;
  error: Error | null;
}

// Login policy depends on both the server and organization. A failed lookup is
// never cached, and a response from an earlier selection cannot update the view.
const CACHE_TTL_MS = 30 * 1000;
type LoginConfig = { loginMethod: LoginMethod; systemConfig: SystemConfig; authMethods: AuthMethod[] };
const cache = new Map<string, { value: LoginConfig; at: number }>();
const inflight = new Map<string, Promise<LoginConfig>>();

export function resolveAuthMethods(data: SystemConfig | null): AuthMethod[] {
  const allowed = new Set<AuthMethod>(['phone', 'password', 'api_key', 'sso']);
  const declared = data?.auth_methods?.filter((method): method is AuthMethod => allowed.has(method));
  if (declared?.length) return [...new Set(declared)];
  if (data?.login_method === 2) return ['sso', 'password', 'api_key'];
  if (data?.login_method === 1) return ['password', 'api_key'];
  return ['phone', 'password', 'api_key'];
}

async function fetchLoginMethod(organizationCode: string, selectedBaseUrl?: string): Promise<LoginConfig> {
  const baseUrl = await getAuthServerBaseUrl();
  const customMossBaseUrl = selectedBaseUrl || (typeof window !== 'undefined' && !window.electronAPI ? localStorage.getItem('login.mossBaseUrl') || undefined : undefined);
  const key = JSON.stringify([baseUrl, customMossBaseUrl || '', organizationCode]);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = (async (): Promise<LoginConfig> => {
    const data = await fetchSystemConfig(baseUrl, customMossBaseUrl, organizationCode || undefined);
    if (!data) throw new Error('无法获取登录方式，请检查企业码和服务器地址后重试');
    if (!organizationCode) void ipcBridge.systemConfig.syncFromRenderer.invoke({ data }).catch(() => {});
    const value: LoginConfig = {
      loginMethod: data.login_method === THIRD_PARTY_LOGIN_METHOD ? 2 : data.login_method === 1 ? 1 : 0,
      systemConfig: data,
      authMethods: resolveAuthMethods(data),
    };
    if (cache.size > 50) cache.clear();
    cache.set(key, { value, at: Date.now() });
    return value;
  })();
  inflight.set(key, request);
  try {
    return await request;
  } finally {
    inflight.delete(key);
  }
}

export function useSystemLoginMethod(organizationCode = '', selectedBaseUrl?: string, retry = 0): SystemLoginMethodState {
  const [state, setState] = useState<SystemLoginMethodState>({ loginMethod: null, systemConfig: null, authMethods: [], isLoading: true, error: null });
  useEffect(() => {
    let cancelled = false;
    setState({ loginMethod: null, systemConfig: null, authMethods: [], isLoading: true, error: null });
    void fetchLoginMethod(organizationCode.trim(), selectedBaseUrl)
      .then((value) => {
        if (!cancelled) setState({ ...value, isLoading: false, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ loginMethod: null, systemConfig: null, authMethods: [], isLoading: false, error: error instanceof Error ? error : new Error(String(error)) });
      });
    return () => {
      cancelled = true;
    };
  }, [organizationCode, selectedBaseUrl, retry]);
  return state;
}
