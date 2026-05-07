/**
 * Config Items Loader - fetches Config Items from sudowork-server
 * and maintains an in-memory cache for Auth Proxy URL matching.
 */

import type { AuthProxyRule } from '@/common/types/authProxy';
import { SUDOWORK_SERVER_BASE_URL } from '@/common/sudoworkServer';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { adaptConfigItems } from './configItemsAdapter';

// ============================================================================
// Cache
// ============================================================================

const CONFIG_ITEMS_API = `${SUDOWORK_SERVER_BASE_URL}/api/v1/config/items`;

let rulesCache: Map<number, AuthProxyRule> = new Map();
let lastSuccessfulRules: AuthProxyRule[] = [];

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
export async function refreshRules(
  accessToken: string,
  enabledConfigItemIds: number[],
): Promise<AuthProxyRule[]> {
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
