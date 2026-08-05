/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ipcBridge } from '@/common';
import { getSudoworkServerBaseUrl } from '@/common/sudoworkServer';
import { ConfigStorage } from '@/common/storage';
import type { TenantConfig, TenantConfigResponse } from '@/common/types/tenantConfig';
import { DEFAULT_TENANT_CONFIG, TENANT_CONFIG_STORAGE_KEY, resolveTenantConfig } from '@/common/types/tenantConfig';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import { useAuth } from './AuthContext';

const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 分钟

interface TenantConfigContextValue {
  /** 当前租户配置 */
  config: Required<TenantConfig>;
  /** 加载状态 */
  loading: boolean;
  /**
   * Whether the enterprise tenant config was confirmed from the server this
   * session. Policy-bearing flags (e.g. client_cron_enabled) must fail closed
   * when this is false — the cached config may be stale and an admin may have
   * disabled the feature while the client was offline. Always true in personal
   * mode (no enterprise policy to confirm).
   */
  confirmed: boolean;
  /** 手动刷新配置 */
  refresh: () => Promise<void>;
}

const TenantConfigContext = createContext<TenantConfigContextValue | undefined>(undefined);

/**
 * 租户配置 Provider
 *
 * 更新策略：
 * 1. 登录成功后立即刷新配置
 * 2. 登录状态下每 10 分钟定时轮询刷新
 * 3. 登出时重置 config 为默认值，停止轮询（不清除 localStorage）
 */
export const TenantConfigProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { user, status, ensureValidToken } = useAuth();
  const { isEnterprise } = useAppMode();

  // 初始化时从 localStorage 加载缓存
  const [config, setConfig] = useState<Required<TenantConfig>>(() => {
    try {
      const cached = localStorage.getItem(TENANT_CONFIG_STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        return resolveTenantConfig(parsed);
      }
    } catch {
      // ignore parse error
    }
    return DEFAULT_TENANT_CONFIG;
  });

  const [loading, setLoading] = useState(false);
  // Confirmed only after a successful enterprise server fetch this session.
  // Personal mode has no enterprise policy, so it is always considered confirmed.
  const [confirmed, setConfirmed] = useState(false);
  const isRefreshing = useRef(false);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * 从服务端获取租户配置
   */
  const fetchConfig = useCallback(async () => {
    if (status !== 'authenticated') {
      return;
    }

    // Personal mode still depends on sudowork-server enterprise_code.
    if (!isEnterprise && !user?.enterprise_code) {
      return;
    }

    // 防止重复请求
    if (isRefreshing.current) return;
    isRefreshing.current = true;
    setLoading(true);

    try {
      if (isEnterprise) {
        const configuredServerUrl = await ConfigStorage.get('eeclaw.serverUrl');
        const serverUrl = configuredServerUrl?.trim().replace(/\/+$/, '');

        if (!serverUrl) {
          console.warn('[TenantConfig] No enterprise server URL configured');
          return;
        }

        const data = await ipcBridge.eeclaw.verifyServer.invoke({ serverUrl });

        if (data.success && data.data) {
          const mergedConfig = resolveTenantConfig(data.data);
          setConfig(mergedConfig);
          setConfirmed(true);
          localStorage.setItem(TENANT_CONFIG_STORAGE_KEY, JSON.stringify(mergedConfig));
          await ConfigStorage.set('eeclaw.tenantName', mergedConfig.app_company_name);
          console.log('[TenantConfig] Enterprise config updated:', mergedConfig);
        } else {
          console.warn('[TenantConfig] Enterprise API returned unsuccessful:', data.msg);
        }
        return;
      }

      const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
      const baseUrl = serverConfig.baseUrl || (await getSudoworkServerBaseUrl());
      const token = await ensureValidToken();

      if (!token) {
        console.warn('[TenantConfig] No valid token');
        return;
      }

      // 使用 enterprise_code 作为租户 code 参数
      const url = `${baseUrl}/api/v1/tenant/config?code=${user?.enterprise_code}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.warn('[TenantConfig] API response not OK:', response.status);
        return;
      }

      const data: TenantConfigResponse = await response.json();

      if (data.success && data.data) {
        const mergedConfig = resolveTenantConfig(data.data);
        setConfig(mergedConfig);
        // 缓存到 localStorage
        localStorage.setItem(TENANT_CONFIG_STORAGE_KEY, JSON.stringify(mergedConfig));
        console.log('[TenantConfig] Config updated:', mergedConfig);
      } else {
        console.warn('[TenantConfig] API returned unsuccessful:', data.msg);
      }
    } catch (error) {
      console.error('[TenantConfig] Fetch failed:', error);
    } finally {
      isRefreshing.current = false;
      setLoading(false);
    }
  }, [status, isEnterprise, user?.enterprise_code, ensureValidToken]);

  /**
   * 启动定时轮询
   */
  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return; // 已在运行

    pollTimerRef.current = setInterval(() => {
      console.log('[TenantConfig] Polling refresh...');
      void fetchConfig();
    }, POLL_INTERVAL_MS);
    console.log('[TenantConfig] Polling started (10min interval)');
  }, [fetchConfig]);

  /**
   * 停止定时轮询
   */
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
      console.log('[TenantConfig] Polling stopped');
    }
  }, []);

  // 监听登录状态变化
  useEffect(() => {
    if (status === 'authenticated' && (isEnterprise || user?.enterprise_code)) {
      // 登录成功 → 立即刷新 + 启动轮询
      void fetchConfig();
      startPolling();
    } else if (status === 'unauthenticated') {
      // 登出 → 重置 config 为默认值，停止轮询
      // 注意：不清除 localStorage，保留缓存供下次启动登录页使用
      setConfig(DEFAULT_TENANT_CONFIG);
      setConfirmed(false);
      stopPolling();
    }
  }, [status, isEnterprise, user?.enterprise_code, fetchConfig, startPolling, stopPolling]);

  // 清理定时器
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  const value = useMemo<TenantConfigContextValue>(
    () => ({
      config,
      loading,
      // Personal mode has no enterprise policy to confirm; enterprise requires a
      // successful server fetch this session before policy flags are trusted.
      confirmed: !isEnterprise || confirmed,
      refresh: fetchConfig,
    }),
    [config, loading, confirmed, isEnterprise, fetchConfig]
  );

  return <TenantConfigContext.Provider value={value}>{children}</TenantConfigContext.Provider>;
};

/**
 * 获取租户配置 Context
 */
export function useTenantConfig(): TenantConfigContextValue {
  const context = useContext(TenantConfigContext);
  if (!context) {
    throw new Error('useTenantConfig must be used within TenantConfigProvider');
  }
  return context;
}
