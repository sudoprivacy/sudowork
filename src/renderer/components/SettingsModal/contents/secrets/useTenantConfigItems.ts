/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { secret } from '@/common/ipcBridge';
import { SUDOWORK_SERVER_BASE_URL } from '@/common/sudoworkServer';
import { ConfigStorage } from '@/common/storage';
import { useAuth } from '@/renderer/context/AuthContext';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TenantConfigEntry, TenantConfigItem, TenantConfigValues } from './types';

const TENANT_ENABLED_STORAGE_KEY = 'settings.tenant.enabled';
const CONFIG_ITEMS_API = `${SUDOWORK_SERVER_BASE_URL}/api/v1/config/items`;

interface UseTenantConfigItemsReturn {
  configItems: TenantConfigItem[];
  valuesMap: Record<number, TenantConfigValues>;
  enabledMap: Record<number, boolean>;
  loading: boolean;
  savingId: number | null;
  error: string | null;
  refresh: () => Promise<void>;
  toggleEnabled: (configItemId: number, enabled: boolean) => Promise<void>;
  saveItem: (configItemId: number, entries: TenantConfigEntry[], values: TenantConfigValues) => Promise<boolean>;
}

async function fetchWithAuth(url: string, token: string, options: RequestInit = {}): Promise<Response> {
  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
  };

  const response = await fetch(url, { ...options, headers });
  return response;
}

function buildNamespace(configItemId: number): string {
  return `tenant:${configItemId}`;
}

export function useTenantConfigItems(refreshTrigger?: number): UseTenantConfigItemsReturn {
  const { ensureValidToken, forceRefreshToken } = useAuth();

  const [configItems, setConfigItems] = useState<TenantConfigItem[]>([]);
  const [valuesMap, setValuesMap] = useState<Record<number, TenantConfigValues>>({});
  const [enabledMap, setEnabledMap] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  const loadEnabledStates = useCallback(async (itemIds: number[]) => {
    try {
      const stored = await ConfigStorage.get(TENANT_ENABLED_STORAGE_KEY);
      const storedMap = (stored || {}) as Record<number, boolean>;
      const newMap: Record<number, boolean> = {};
      for (const id of itemIds) {
        newMap[id] = storedMap[id] ?? false;
      }
      if (mountedRef.current) {
        setEnabledMap(newMap);
      }
    } catch {
      // Ignore storage read errors
    }
  }, []);

  const loadValuesFromNexus = useCallback(async (items: TenantConfigItem[]) => {
    const newValuesMap: Record<number, TenantConfigValues> = {};

    const promises: Promise<void>[] = [];
    for (const item of items) {
      const namespace = buildNamespace(item.id);
      const values: TenantConfigValues = {};

      for (const entry of item.entries) {
        const p = secret.get
          .invoke({ namespace, key: entry.config_key })
          .then((res) => {
            if (res.success && res.data) {
              values[entry.config_key] = res.data;
            }
          })
          .catch(() => {
            // Silently ignore, leave value empty
          });
        promises.push(p);
      }

      // Ensure values object is created for this item even if all gets fail
      newValuesMap[item.id] = values;
    }

    await Promise.all(promises);

    if (mountedRef.current) {
      setValuesMap(newValuesMap);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let token = await ensureValidToken();
      if (!token) {
        if (mountedRef.current) {
          setConfigItems([]);
          setValuesMap({});
          setError(null);
        }
        return;
      }

      let response = await fetchWithAuth(CONFIG_ITEMS_API, token);

      // Retry with refreshed token on 401
      if (response.status === 401) {
        const newToken = await forceRefreshToken();
        if (newToken) {
          token = newToken;
          response = await fetchWithAuth(CONFIG_ITEMS_API, token);
        }
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.success && Array.isArray(data.data)) {
        const items: TenantConfigItem[] = data.data;
        if (mountedRef.current) {
          setConfigItems(items);
        }
        await loadValuesFromNexus(items);
        await loadEnabledStates(items.map((i) => i.id));
      } else {
        if (mountedRef.current) {
          setConfigItems([]);
        }
      }
    } catch (err) {
      console.error('[TenantConfig] Failed to load config items:', err);
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : '加载失败');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [ensureValidToken, forceRefreshToken, loadValuesFromNexus, loadEnabledStates]);

  // Initial load and refresh trigger
  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  // Handle external refresh trigger
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0) {
      void refresh();
    }
  }, [refreshTrigger, refresh]);

  const toggleEnabled = useCallback(
    async (configItemId: number, enabled: boolean) => {
      const newMap = { ...enabledMap, [configItemId]: enabled };
      setEnabledMap(newMap);
      try {
        await ConfigStorage.set(TENANT_ENABLED_STORAGE_KEY, newMap);
      } catch (err) {
        console.error('[TenantConfig] Failed to save enabled state:', err);
      }
    },
    [enabledMap],
  );

  const saveItem = useCallback(
    async (configItemId: number, entries: TenantConfigEntry[], values: TenantConfigValues): Promise<boolean> => {
      setSavingId(configItemId);
      const namespace = buildNamespace(configItemId);

      try {
        const results = await Promise.all(
          entries.map((entry) =>
            secret.put.invoke({
              namespace,
              key: entry.config_key,
              value: values[entry.config_key] || '',
              description: entry.config_desc || entry.config_key,
            }),
          ),
        );

        const allSuccess = results.every((r) => r.success);
        return allSuccess;
      } catch (err) {
        console.error('[TenantConfig] Failed to save config item:', err);
        return false;
      } finally {
        if (mountedRef.current) {
          setSavingId(null);
        }
      }
    },
    [],
  );

  return {
    configItems,
    valuesMap,
    enabledMap,
    loading,
    savingId,
    error,
    refresh,
    toggleEnabled,
    saveItem,
  };
}
