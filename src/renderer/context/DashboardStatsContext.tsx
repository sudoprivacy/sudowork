/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import { useAuth } from './AuthContext';

interface ConsumerUsageToday {
  tokens?: number | null;
  cost_points?: number | null;
  requests?: number | null;
}

interface ConsumerDashboardStats {
  usage_today?: ConsumerUsageToday | null;
}

interface DashboardStatsContextValue {
  profile: any | null;
  stats: ConsumerDashboardStats | null;
  loading: boolean;
  error: Error | null;
  refresh: (options?: { force?: boolean }) => Promise<void>;
}

const DashboardStatsContext = createContext<DashboardStatsContextValue | null>(null);

const STALE_MS = 30_000;

export const DashboardStatsProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { user, ensureValidToken, forceRefreshToken } = useAuth();
  const [profile, setProfile] = useState<any | null>(null);
  const [stats, setStats] = useState<ConsumerDashboardStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const lastFetchedAtRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (!user?.token) return;
      if (!force && Date.now() - lastFetchedAtRef.current < STALE_MS) return;
      if (inFlightRef.current) return inFlightRef.current;

      const fetchWithAuth = async (url: string, options: RequestInit = {}, retry = true): Promise<Response> => {
        const token = await ensureValidToken();
        if (!token) {
          throw new Error('NO_TOKEN');
        }
        const headers = { ...options.headers, Authorization: `Bearer ${token}` };
        const response = await fetch(url, { ...options, headers });
        if (response.status === 401 && retry) {
          const newToken = await forceRefreshToken();
          if (newToken) {
            const retryHeaders = { ...options.headers, Authorization: `Bearer ${newToken}` };
            return fetch(url, { ...options, headers: retryHeaders });
          }
        }
        return response;
      };

      const task = (async () => {
        setLoading(true);
        setError(null);
        try {
          const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
          const [profileRes, dashboardRes] = await Promise.all([fetchWithAuth(`${serverConfig.baseUrl}/api/v1/user/profile`), fetchWithAuth(`${serverConfig.baseUrl}/api/v1/user/dashboard`)]);

          if (profileRes.status === 401 || dashboardRes.status === 401) {
            // Token refresh already attempted inside fetchWithAuth; leave state as-is.
            return;
          }

          const profileData = await profileRes.json();
          const dashboardData = await dashboardRes.json();

          if (profileData.success) setProfile(profileData.data);
          if (dashboardData.success) {
            setStats({ usage_today: dashboardData.data.usage_today });
          }
          lastFetchedAtRef.current = Date.now();
        } catch (e) {
          console.error('[DashboardStats] refresh failed:', e);
          setError(e instanceof Error ? e : new Error(String(e)));
        } finally {
          setLoading(false);
          inFlightRef.current = null;
        }
      })();
      inFlightRef.current = task;
      return task;
    },
    [user?.token, ensureValidToken, forceRefreshToken]
  );

  // Auto-fetch when a token becomes available; clear state on logout.
  useEffect(() => {
    if (user?.token) {
      void refresh();
    } else {
      setProfile(null);
      setStats(null);
      setError(null);
      lastFetchedAtRef.current = 0;
    }
    // Intentionally omit `refresh` from deps — its identity changes when the
    // token does, which would just trigger a redundant invocation. We only
    // care about token transitions here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.token]);

  return <DashboardStatsContext.Provider value={{ profile, stats, loading, error, refresh }}>{children}</DashboardStatsContext.Provider>;
};

export function useDashboardStats(): DashboardStatsContextValue {
  const value = useContext(DashboardStatsContext);
  if (!value) {
    throw new Error('useDashboardStats must be used within a DashboardStatsProvider');
  }
  return value;
}
