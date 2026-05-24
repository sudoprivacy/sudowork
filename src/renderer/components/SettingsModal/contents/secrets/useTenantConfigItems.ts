/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { secret, authProxy } from '@/common/ipcBridge';
import { buildNamespace } from '@/common/nexus/namespace';
import { MossSecretClient } from '@/common/nexus/moss-secret-client';
import { SUDOWORK_SERVER_BASE_URL } from '@/common/sudoworkServer';
import { ConfigStorage } from '@/common/storage';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import { useAuth } from '@/renderer/context/AuthContext';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TenantConfigEntry, TenantConfigItem, TenantConfigValues } from './types';

const TENANT_ENABLED_STORAGE_KEY = 'settings.tenant.enabled';

interface UseTenantConfigItemsReturn {
  configItems: TenantConfigItem[];
  valuesMap: Record<number, TenantConfigValues>;
  enabledMap: Record<number, boolean>;
  loading: boolean;
  savingId: number | null;
  error: string | null;
  refresh: () => Promise<void>;
  toggleEnabled: (configItemId: number, enabled: boolean) => Promise<void>;
  saveItem: (configItemId: number, pinyin: string, entries: TenantConfigEntry[], values: TenantConfigValues, oldValues: TenantConfigValues) => Promise<boolean>;
}

async function fetchWithAuth(url: string, token: string, options: RequestInit = {}): Promise<Response> {
  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
  };

  const response = await fetch(url, { ...options, headers });
  return response;
}

export function useTenantConfigItems(refreshTrigger?: number): UseTenantConfigItemsReturn {
  const { ensureValidToken, forceRefreshToken, user } = useAuth();
  const { isEnterprise } = useAppMode();

  const [configItems, setConfigItems] = useState<TenantConfigItem[]>([]);
  const [valuesMap, setValuesMap] = useState<Record<number, TenantConfigValues>>({});
  const [enabledMap, setEnabledMap] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  const loadEnabledStates = useCallback(async (items: TenantConfigItem[], token: string) => {
    if (isEnterprise && user?.id) {
      // B端: use MossSecretClient.listSecrets() for enabled status
      try {
        const serverUrl = await ConfigStorage.get('eeclaw.serverUrl');
        const mossClient = new MossSecretClient(serverUrl, token, user.id);
        const allSecrets = await mossClient.listSecrets();
        const newMap: Record<number, boolean> = {};
        for (const item of items) {
          const namespace = buildNamespace(item.pinyin!, user.id);
          const itemEntries = allSecrets.filter(s => s.namespace === namespace);
          newMap[item.id] = itemEntries.length > 0 && itemEntries.some(s => s.enabled);
        }
        if (mountedRef.current) {
          setEnabledMap(newMap);
        }
      } catch {
        // Fall back to all disabled
        if (mountedRef.current) {
          const newMap: Record<number, boolean> = {};
          for (const item of items) { newMap[item.id] = false; }
          setEnabledMap(newMap);
        }
      }
      return;
    }

    // C端: read from ConfigStorage
    try {
      const stored = await ConfigStorage.get(TENANT_ENABLED_STORAGE_KEY);
      const storedMap = (stored || {}) as Record<number, boolean>;
      const newMap: Record<number, boolean> = {};
      for (const item of items) {
        newMap[item.id] = storedMap[item.id] ?? false;
      }
      if (mountedRef.current) {
        setEnabledMap(newMap);
      }
    } catch {
      // Ignore storage read errors
    }
  }, [isEnterprise, user?.id]);

  const loadValuesFromNexus = useCallback(async (items: TenantConfigItem[], token: string) => {
    const newValuesMap: Record<number, TenantConfigValues> = {};
    const userId = user?.id;

    if (isEnterprise && userId) {
      // B端: use MossSecretClient to GET values from moss API
      const serverUrl = await ConfigStorage.get('eeclaw.serverUrl');
      const mossClient = new MossSecretClient(serverUrl, token, userId);

      for (const item of items) {
        if (!item.pinyin) continue;
        const namespace = buildNamespace(item.pinyin, userId);
        const values: TenantConfigValues = {};
        for (const entry of item.entries) {
          try {
            const value = await mossClient.getSecret(namespace, entry.config_key);
            if (value) {
              values[entry.config_key] = value;
            }
          } catch {
            // Secret not found, skip
          }
        }
        newValuesMap[item.id] = values;
      }
    } else {
      // C端: use IPC to local nexusd
      const promises: Promise<void>[] = [];
      for (const item of items) {
        if (!item.pinyin) continue;
        const namespace = buildNamespace(item.pinyin);
        const values: TenantConfigValues = {};
        for (const entry of item.entries) {
          const p = secret.get
            .invoke({ namespace, key: entry.config_key })
            .then((res) => {
              if (res.success && res.data) {
                values[entry.config_key] = res.data;
              }
            })
            .catch(() => {});
          promises.push(p);
        }
        newValuesMap[item.id] = values;
      }
      await Promise.all(promises);
    }

    if (mountedRef.current) {
      setValuesMap(newValuesMap);
    }
  }, [isEnterprise, user?.id]);

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

      let configItemsUrl: string;
      if (isEnterprise) {
        const serverUrl = await ConfigStorage.get('eeclaw.serverUrl');
        configItemsUrl = `${serverUrl}/api/v1/config/items`;
      } else {
        configItemsUrl = `${SUDOWORK_SERVER_BASE_URL}/api/v1/config/items`;
      }

      let response = await fetchWithAuth(configItemsUrl, token);

      // Retry with refreshed token on 401
      if (response.status === 401) {
        const newToken = await forceRefreshToken();
        if (newToken) {
          token = newToken;
          response = await fetchWithAuth(configItemsUrl, token);
        }
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.success && Array.isArray(data.data)) {
        let items: TenantConfigItem[] = data.data;
        items = items.filter((item) => item.pinyin !== null);
        // B端: filter to user scope only
        if (isEnterprise) {
          items = items.filter((item) => item.scope === 'user');
        }
        if (mountedRef.current) {
          setConfigItems(items);
        }
        await loadValuesFromNexus(items, token);
        await loadEnabledStates(items, token);
      } else {
        if (mountedRef.current) {
          setConfigItems([]);
        }
      }
    } catch (err) {
      console.error('[TenantConfig] Failed to load config items:', err);
      if (mountedRef.current) {
        if (isEnterprise) {
          setConfigItems([]);
        } else {
          setError(err instanceof Error ? err.message : '加载失败');
        }
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [ensureValidToken, forceRefreshToken, loadValuesFromNexus, loadEnabledStates, isEnterprise]);

  // Initial load and refresh trigger
  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  // Subscribe to enabled state changes from Auth Proxy secrets API
  useEffect(() => {
    const unsub = authProxy.enabledStateChanged.on(() => {
      void refresh();
    });
    return unsub;
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

      if (isEnterprise && user?.id) {
        // B端: traverse entries and call moss API per key
        try {
          const token = await ensureValidToken();
          const serverUrl = await ConfigStorage.get('eeclaw.serverUrl');
          const mossClient = new MossSecretClient(serverUrl, token, user.id);
          const item = configItems.find(i => i.id === configItemId);
          if (item?.pinyin) {
            const namespace = buildNamespace(item.pinyin, user.id);
            for (const entry of item.entries) {
              if (enabled) {
                await mossClient.enableSecret(namespace, entry.config_key);
              } else {
                await mossClient.disableSecret(namespace, entry.config_key);
              }
            }
          }
        } catch (err) {
          console.error('[TenantConfig] Failed to toggle moss secret enabled state:', err);
        }
        return;
      }

      // C端: save to ConfigStorage and notify Auth Proxy
      try {
        await ConfigStorage.set(TENANT_ENABLED_STORAGE_KEY, newMap);
        const token = await ensureValidToken();
        if (token) {
          const enabledIds = Object.entries(newMap).filter(([, v]) => v).map(([k]) => Number(k));
          authProxy.refreshRules.invoke({ accessToken: token, enabledConfigItemIds: enabledIds }).catch((err) => {
            console.warn('[TenantConfig] Failed to refresh Auth Proxy rules:', err);
          });
        }
      } catch (err) {
        console.error('[TenantConfig] Failed to save enabled state:', err);
      }
    },
    [enabledMap, ensureValidToken, isEnterprise, user?.id, configItems],
  );

  const saveItem = useCallback(
    async (configItemId: number, pinyin: string, entries: TenantConfigEntry[], values: TenantConfigValues, oldValues: TenantConfigValues): Promise<boolean> => {
      setSavingId(configItemId);
      const userId = user?.id;

      try {
        if (isEnterprise && userId) {
          // B端: use MossSecretClient directly
          const token = await ensureValidToken();
          const serverUrl = await ConfigStorage.get('eeclaw.serverUrl');
          const mossClient = new MossSecretClient(serverUrl, token, userId);
          const namespace = buildNamespace(pinyin, userId);

          const results = await Promise.all(
            entries.map(async (entry) => {
              const currentValue = values[entry.config_key]?.trim() ?? '';
              try {
                if (!currentValue) {
                  if (!oldValues[entry.config_key]?.trim()) return { success: true as const };
                  await mossClient.deleteSecret(namespace, entry.config_key);
                  return { success: true as const };
                }
                await mossClient.putSecret(namespace, entry.config_key, currentValue);
                return { success: true as const };
              } catch {
                return { success: false as const };
              }
            }),
          );
          const allSuccess = results.every(r => r.success);
          return allSuccess;
        }

        // C端: use IPC with get/restore/put pattern
        const namespace = buildNamespace(pinyin);
        const results = await Promise.all(
          entries.map(async (entry) => {
            const currentValue = values[entry.config_key]?.trim() ?? '';
            const hasOldValue = !!oldValues[entry.config_key]?.trim();

            if (!currentValue) {
              if (!hasOldValue) return { success: true as const };
              try {
                await secret.delete.invoke({ namespace, key: entry.config_key });
                return { success: true as const };
              } catch {
                return { success: true as const };
              }
            }

            try {
              const getResult = await secret.get.invoke({ namespace, key: entry.config_key });
              if (!getResult.success) {
                try {
                  await secret.restore.invoke({ namespace, key: entry.config_key });
                } catch {}
              }
            } catch {
              try {
                await secret.restore.invoke({ namespace, key: entry.config_key });
              } catch {}
            }

            try {
              const result = await secret.put.invoke({ namespace, key: entry.config_key, value: currentValue, description: entry.name });
              return { success: !!result.success };
            } catch {
              return { success: false as const };
            }
          }),
        );
        const allSuccess = results.every(r => r.success);
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
    [isEnterprise, user?.id, ensureValidToken],
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
