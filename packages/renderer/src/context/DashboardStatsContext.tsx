/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
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
  const { user, authFetch } = useAuth();
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

      const task = (async () => {
        setLoading(true);
        setError(null);
        try {
          const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
          const [profileRes, dashboardRes] = await Promise.all([authFetch(`${serverConfig.baseUrl}/api/v1/user/profile`), authFetch(`${serverConfig.baseUrl}/api/v1/user/dashboard`)]);

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
    [user?.token, authFetch]
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
