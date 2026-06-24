import { useEffect, useState } from 'react';
import { fetchSystemConfig } from '@/common/systemConfig';

/** 0 = 手机验证码（现状）；1 = 用户名密码（本次新增） */
export type LoginMethod = 0 | 1;

export interface SystemLoginMethodState {
  /** null 表示尚未拿到结果；拿到后为 0 或 1 */
  loginMethod: LoginMethod | null;
  isLoading: boolean;
  error: Error | null;
}

// 模块级内存缓存 + 时间戳：登录页与用户中心复用，避免重复请求
const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedLoginMethod: LoginMethod | null = null;
let cachedAt = 0;
// 进行中的请求去重，避免并发触发多次
let inflight: Promise<LoginMethod> | null = null;

async function fetchLoginMethod(): Promise<LoginMethod> {
  if (cachedLoginMethod !== null && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedLoginMethod;
  }
  if (inflight) return inflight;
  inflight = (async (): Promise<LoginMethod> => {
    try {
      // Reuse the shared client; fetchSystemConfig() also fills the renderer's
      // system-config module cache (setSystemConfigCache) so synchronous base-url
      // helpers work for renderer consumers.
      const data = await fetchSystemConfig();
      const loginMethod: LoginMethod = data?.login_method === 1 ? 1 : 0;
      cachedLoginMethod = loginMethod;
      cachedAt = Date.now();
      return loginMethod;
    } catch (err) {
      // 失败兜底：按手机验证码（login_method=0，即维持现状），控制台告警，不打断用户
      console.warn('[useSystemLoginMethod] fetch system-config failed, fallback to login_method=0:', err);
      return 0;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useSystemLoginMethod(): SystemLoginMethodState {
  const [state, setState] = useState<SystemLoginMethodState>(() => ({
    loginMethod: cachedLoginMethod,
    isLoading: cachedLoginMethod === null,
    error: null,
  }));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loginMethod = await fetchLoginMethod();
      if (cancelled) return;
      setState({ loginMethod, isLoading: false, error: null });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
