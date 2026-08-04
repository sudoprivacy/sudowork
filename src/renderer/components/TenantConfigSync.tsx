/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { ipcBridge } from '@/common';
import { ConfigStorage } from '@/common/storage';
import { getSudoworkServerBaseUrl } from '@/common/sudoworkServer';
import type { TenantConfigResponse } from '@/common/types/tenantConfig';
import { useAuth } from '@/renderer/context/AuthContext';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import { useTenantStore } from '@/renderer/stores/useTenantStore';

const POLL_INTERVAL_MS = 10 * 60 * 1000;

/**
 * 监听登录状态并刷新远端租户配置，负责首次请求、定时轮询和并发控制。
 * 请求成功时一次性更新 Tenant Store；失败时保留当前内存状态和缓存。
 */
export default function TenantConfigSync(): ReactElement | null {
  const { user, status, ensureValidToken } = useAuth();
  const { isEnterprise } = useAppMode();
  const applyRemoteConfig = useTenantStore((state) => state.applyRemoteConfig);
  const resetPolicyConfirmation = useTenantStore((state) => state.resetPolicyConfirmation);
  const isRefreshing = useRef(false);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const refreshTenant = useCallback(async () => {
    if (status !== 'authenticated' || (!isEnterprise && !user?.enterprise_code) || isRefreshing.current) return;
    isRefreshing.current = true;

    try {
      if (isEnterprise) {
        const configuredServerUrl = await ConfigStorage.get('eeclaw.serverUrl');
        const serverUrl = configuredServerUrl?.trim().replace(/\/+$/, '');
        if (!serverUrl) return;

        const response = await ipcBridge.eeclaw.verifyServer.invoke({ serverUrl });
        if (!response.success || !response.data) return;

        const tenant = applyRemoteConfig(response.data);
        await ConfigStorage.set('eeclaw.tenantName', tenant.companyName);
        return;
      }

      const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
      const baseUrl = serverConfig.baseUrl || (await getSudoworkServerBaseUrl());
      const token = await ensureValidToken();
      if (!token) return;

      const response = await fetch(`${baseUrl}/api/v1/tenant/config?code=${user?.enterprise_code}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) return;

      const data: TenantConfigResponse = await response.json();
      if (data.success && data.data) applyRemoteConfig(data.data);
    } catch (error) {
      console.error('[TenantConfig] Fetch failed:', error);
    } finally {
      isRefreshing.current = false;
    }
  }, [status, isEnterprise, user?.enterprise_code, ensureValidToken, applyRemoteConfig]);

  useEffect(() => {
    if (status === 'authenticated' && (isEnterprise || user?.enterprise_code)) {
      void refreshTenant();
      pollTimerRef.current = setInterval(() => void refreshTenant(), POLL_INTERVAL_MS);
    } else {
      resetPolicyConfirmation();
    }

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, [status, isEnterprise, user?.enterprise_code, refreshTenant, resetPolicyConfirmation]);

  return null;
}
