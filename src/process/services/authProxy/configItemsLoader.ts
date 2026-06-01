/**
 * Config Items Loader - fetches Config Items from sudowork-server
 * and maintains an in-memory cache for Auth Proxy URL matching.
 */

import type { AuthProxyRule } from '@/common/types/authProxy';
import { SUDOWORK_SERVER_BASE_URL } from '@/common/sudoworkServer';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { adaptConfigItems, adaptConfigItem } from './configItemsAdapter';

// ============================================================================
// Cache
// ============================================================================

const CONFIG_ITEMS_API = `${SUDOWORK_SERVER_BASE_URL}/api/v1/config/items`;

const rulesCache: Map<number, AuthProxyRule> = new Map();
let lastSuccessfulRules: AuthProxyRule[] = [];
let rawConfigItemsCache: RawConfigItem[] = [];

// ============================================================================
// Types (mirror configItemsAdapter internal types for raw cache)
// ============================================================================

interface ConfigEntry {
  id: number;
  config_key: string;
  name: string;
  config_desc: string | null;
  required: number;
}

export interface RawConfigItem {
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

// ============================================================================
// Public API
// ============================================================================

/**
 * Get all cached rules.
 */
export function getRules(): AuthProxyRule[] {
  return Array.from(rulesCache.values());
}

/**
 * Get cached rules that have a urlPattern (for URL auto-matching).
 */
export function getRulesWithPattern(): AuthProxyRule[] {
  return Array.from(rulesCache.values()).filter((r) => r.urlPattern !== null);
}

/**
 * Find a matching rule for the given URL using glob pattern matching.
 * Returns the first matching rule, or null if no match.
 */
export function findRuleForUrl(url: string, minimatchFn: (str: string, pattern: string) => boolean): AuthProxyRule | null {
  const patternRules = getRulesWithPattern();
  for (const rule of patternRules) {
    if (rule.urlPattern && minimatchFn(url, rule.urlPattern)) {
      return rule;
    }
  }
  return null;
}

/**
 * Fetch Config Items from sudowork-server and update the cache.
 *
 * @param accessToken - User's access token for sudowork-server API
 * @param enabledConfigItemIds - IDs of config items the user has enabled
 */
export async function refreshRules(accessToken: string, enabledConfigItemIds: number[]): Promise<AuthProxyRule[]> {
  try {
    const response = await fetch(CONFIG_ITEMS_API, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      mainWarn('ConfigItemsLoader', `API returned ${response.status}: ${response.statusText}`);
      // Degrade: return last successful cache
      return lastSuccessfulRules;
    }

    const result = await response.json();

    // Business-level validation before touching raw cache
    if (!result.success || !Array.isArray(result.data)) {
      mainWarn('ConfigItemsLoader', `API business failure or invalid data shape: success=${result.success}`);
      return lastSuccessfulRules;
    }

    // Fill raw cache only after validation passes
    rawConfigItemsCache = result.data;

    const rules = adaptConfigItems(result, enabledConfigItemIds);

    // Update cache
    rulesCache.clear();
    for (const rule of rules) {
      rulesCache.set(rule.configItemId, rule);
    }
    lastSuccessfulRules = rules;

    mainLog('ConfigItemsLoader', `Loaded ${rules.length} rules (${rules.filter((r) => r.urlPattern).length} with URL patterns)`);
    return rules;
  } catch (error) {
    mainWarn('ConfigItemsLoader', `Failed to fetch config items:`, error);
    // Degrade: return last successful cache
    return lastSuccessfulRules;
  }
}

/**
 * Find a raw ConfigItem by its namespace.
 * C端 namespace format: `service:{pinyin}` — strip `service:` prefix to get pinyin,
 * then match against rawConfigItemsCache.
 */
export function findConfigItemByNamespace(namespace: string): RawConfigItem | null {
  const pinyin = namespace.replace(/^service:/, '');
  return rawConfigItemsCache.find((item) => item.pinyin === pinyin) ?? null;
}

/**
 * Build an AuthProxyRule from a raw ConfigItem (using singular adaptConfigItem).
 */
export function buildRuleFromRawItem(item: RawConfigItem): AuthProxyRule {
  return adaptConfigItem(item);
}

/**
 * Add a single rule to the rulesCache.
 */
export function addRuleToCache(rule: AuthProxyRule): void {
  rulesCache.set(rule.configItemId, rule);
}

/**
 * Remove a rule from rulesCache by configItemId.
 */
export function removeRuleFromCache(configItemId: number): void {
  rulesCache.delete(configItemId);
}
