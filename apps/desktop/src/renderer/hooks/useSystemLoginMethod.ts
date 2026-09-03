/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { fetchSystemConfig, type SystemConfig } from '@sudowork/common/systemConfig';
import { THIRD_PARTY_LOGIN_METHOD } from '@sudowork/common/thirdPartyAuthConfig';

/** 0 = 手机验证码；1 = 用户名密码；2 = 三方认证登录 */
export type LoginMethod = 0 | 1 | 2;

export interface SystemLoginMethodState {
  /** null 表示尚未拿到结果；拿到后为 0、1 或 2 */
  loginMethod: LoginMethod | null;
  systemConfig: SystemConfig | null;
  isLoading: boolean;
  error: Error | null;
}

// 模块级内存缓存 + 时间戳：登录页与用户中心复用，避免重复请求
const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedLoginMethod: LoginMethod | null = null;
let cachedSystemConfig: SystemConfig | null = null;
let cachedAt = 0;
// 进行中的请求去重，避免并发触发多次
let inflight: Promise<{ loginMethod: LoginMethod; systemConfig: SystemConfig | null }> | null = null;

async function fetchLoginMethod(): Promise<{ loginMethod: LoginMethod; systemConfig: SystemConfig | null }> {
  if (cachedLoginMethod !== null && Date.now() - cachedAt < CACHE_TTL_MS) {
    return { loginMethod: cachedLoginMethod, systemConfig: cachedSystemConfig };
  }
  if (inflight) return inflight;
  inflight = (async (): Promise<{ loginMethod: LoginMethod; systemConfig: SystemConfig | null }> => {
    try {
      // Reuse the shared client; fetchSystemConfig() also fills the renderer's
      // system-config module cache (setSystemConfigCache) so synchronous base-url
      // helpers work for renderer consumers.
      const data = await fetchSystemConfig();
      // Sync to main-process cache (see main.tsx for rationale).
      if (data) {
        void ipcBridge.systemConfig.syncFromRenderer.invoke({ data }).catch(() => {});
      }
      const loginMethod: LoginMethod = data?.login_method === THIRD_PARTY_LOGIN_METHOD ? 2 : data?.login_method === 1 ? 1 : 0;
      cachedLoginMethod = loginMethod;
      cachedSystemConfig = data;
      cachedAt = Date.now();
      return { loginMethod, systemConfig: data };
    } catch (err) {
      // 失败兜底：按手机验证码（login_method=0，即维持现状），控制台告警，不打断用户
      console.warn('[useSystemLoginMethod] fetch system-config failed, fallback to login_method=0:', err);
      return { loginMethod: 0, systemConfig: null };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useSystemLoginMethod(): SystemLoginMethodState {
  const [state, setState] = useState<SystemLoginMethodState>(() => ({
    loginMethod: cachedLoginMethod,
    systemConfig: cachedSystemConfig,
    isLoading: cachedLoginMethod === null,
    error: null,
  }));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { loginMethod, systemConfig } = await fetchLoginMethod();
      if (cancelled) return;
      setState({ loginMethod, systemConfig, isLoading: false, error: null });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
