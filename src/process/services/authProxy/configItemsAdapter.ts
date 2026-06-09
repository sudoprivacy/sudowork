/**
 * Config Items Adapter - converts sudowork-server API responses
 * into Auth Proxy internal rule format (AuthProxyRule).
 *
 * The namespace convention (service:{pinyin}) must match
 * useTenantConfigItems.ts buildNamespace() in the renderer process.
 */

import type { AuthProxyRule } from '@/common/types/authProxy';

// ============================================================================
// Sudowork-server API types
// ============================================================================

interface ConfigEntry {
  id: number;
  config_key: string;
  name: string;
  config_desc: string | null;
  required: number;
}

interface ConfigItem {
  id: number;
  name: string;
  icon: string | null;
  icon_url: string | null;
  pinyin: string | null;
  url_pattern: string | null;
  scheme: string | null;
  bearer_prefix: string | null;
  entries: ConfigEntry[];
}

interface ConfigItemsResponse {
  success: boolean;
  data: ConfigItem[];
  msg?: string;
}

// ============================================================================
// Adapter
// ============================================================================

/**
 * Build the Nexus secret namespace from a config item's pinyin.
 * Must match useTenantConfigItems.ts buildNamespace().
 */
export function buildNamespace(pinyin: string): string {
  return `service:${pinyin}`;
}

/**
 * Convert a single Config Item from the sudowork-server API
 * into an AuthProxyRule for internal use.
 */
export function adaptConfigItem(item: ConfigItem): AuthProxyRule {
  return {
    configItemId: item.id,
    name: item.name,
    urlPattern: item.url_pattern,
    scheme: item.scheme,
    bearerPrefix: item.bearer_prefix,
    secretNamespace: buildNamespace(item.pinyin ?? ''),
    entries: item.entries.map((e) => ({
      configKey: e.config_key,
      name: e.name,
      required: e.required === 1,
    })),
  };
}

/**
 * Convert the full Config Items API response into AuthProxyRule[],
 * filtered by enabledConfigItemIds.
 */
export function adaptConfigItems(
  response: ConfigItemsResponse,
  enabledConfigItemIds: number[],
): AuthProxyRule[] {
  if (!response.success) {
    throw new Error(response.msg || 'Failed to fetch config items');
  }

  const enabledSet = new Set(enabledConfigItemIds);

  return response.data
    .filter((item) => enabledSet.has(item.id))
    .map(adaptConfigItem);
}
