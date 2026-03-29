/**
 * Blacklist Matcher
 *
 * Pattern matching for network URLs and file paths against blacklist rules.
 */

import type { BlacklistRule, BlacklistConfig, BlacklistMatchType, RiskLevel } from './types';

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return null;
  }
}

/**
 * Extract IP address from URL hostname
 * Returns null if hostname is not an IP address
 */
export function extractIP(url: string): string | null {
  const domain = extractDomain(url);
  if (!domain) return null;

  // Check if it's an IPv4 address
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(domain)) {
    return domain;
  }

  // Check if it's an IPv6 address (simplified check)
  const ipv6Regex = /^\[?[0-9a-fA-F:]+\]?$/;
  if (ipv6Regex.test(domain)) {
    return domain.replace(/^\[|\]$/g, '');
  }

  return null;
}

/**
 * Match a value against a pattern
 */
export function matchPattern(value: string, pattern: string, matchType: BlacklistMatchType): boolean {
  try {
    switch (matchType) {
      case 'exact':
        return value === pattern;

      case 'wildcard': {
        // Convert wildcard pattern to regex
        // *.example.com -> ^.*\.example\.com$
        // example.com -> ^example\.com$
        const regexPattern = pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars except *
          .replace(/\*/g, '.*'); // Convert * to .*
        const regex = new RegExp(`^${regexPattern}$`, 'i');
        return regex.test(value);
      }

      default:
        return false;
    }
  } catch {
    // Invalid pattern
    return false;
  }
}

/**
 * Match a network URL against network blacklist rules
 */
export function matchNetworkRule(
  url: string,
  rules: BlacklistRule[]
): { matched: boolean; rule?: BlacklistRule; riskLevel?: RiskLevel } {
  const domain = extractDomain(url);
  const ip = extractIP(url);

  for (const rule of rules) {
    if (!rule.enabled || rule.type !== 'network') continue;

    // For wildcard patterns, try multiple matching strategies
    if (rule.matchType === 'wildcard') {
      // Normalize pattern: strip protocol if present
      // Also strip trailing /* or / since we want to match the domain/host
      let normalizedPattern = rule.pattern
        .replace(/^https?:\/\//, '')  // Strip protocol
        .replace(/\/\*$/, '')         // Strip trailing /*
        .replace(/\/$/, '');          // Strip trailing /

      // 1. Match against domain (best for patterns like *baidu* or www.baidu.com)
      if (domain && matchPattern(domain, normalizedPattern, 'wildcard')) {
        return { matched: true, rule, riskLevel: rule.riskLevel };
      }

      // 2. Match against IP if available
      if (ip && matchPattern(ip, normalizedPattern, 'wildcard')) {
        return { matched: true, rule, riskLevel: rule.riskLevel };
      }

      // 3. Match against full URL (for patterns like *baidu*)
      // Strip protocol from URL for matching
      const urlWithoutProtocol = url.replace(/^https?:\/\//, '');
      if (matchPattern(urlWithoutProtocol, normalizedPattern, 'wildcard')) {
        return { matched: true, rule, riskLevel: rule.riskLevel };
      }

      // 4. Match against hostname only (domain + port, without path)
      const hostname = urlWithoutProtocol.split('/')[0];
      if (matchPattern(hostname, normalizedPattern, 'wildcard')) {
        return { matched: true, rule, riskLevel: rule.riskLevel };
      }
    } else {
      // For exact match
      // 1. Match against domain
      if (domain && matchPattern(domain, rule.pattern, rule.matchType)) {
        return { matched: true, rule, riskLevel: rule.riskLevel };
      }

      // 2. Match against IP if available
      if (ip && matchPattern(ip, rule.pattern, rule.matchType)) {
        return { matched: true, rule, riskLevel: rule.riskLevel };
      }

      // 3. Match against full URL
      if (matchPattern(url, rule.pattern, rule.matchType)) {
        return { matched: true, rule, riskLevel: rule.riskLevel };
      }
    }
  }

  return { matched: false };
}

/**
 * Match a file path against file blacklist rules
 */
export function matchFileRule(
  filePath: string,
  flags: string[],
  rules: BlacklistRule[]
): { matched: boolean; rule?: BlacklistRule; riskLevel?: RiskLevel } {
  // Normalize path
  const normalizedPath = filePath.replace(/\\/g, '/');

  for (const rule of rules) {
    if (!rule.enabled || rule.type !== 'file') continue;

    // Normalize rule pattern
    const normalizedPattern = rule.pattern.replace(/\\/g, '/');

    // For wildcard patterns, match the path
    if (matchPattern(normalizedPath, normalizedPattern, rule.matchType)) {
      return { matched: true, rule, riskLevel: rule.riskLevel };
    }

    // Check if pattern is a directory (ends with / or /*)
    // e.g., /etc/ or /etc/* should match /etc/passwd
    const dirPattern = normalizedPattern.replace(/\/?\*?$/, '/');
    if (normalizedPath.startsWith(dirPattern)) {
      return { matched: true, rule, riskLevel: rule.riskLevel };
    }

    // Check if file is inside a directory pattern
    // e.g., pattern "/home/user" should match "/home/user/.env"
    if (!normalizedPattern.endsWith('*') && !normalizedPattern.endsWith('/')) {
      if (normalizedPath.startsWith(normalizedPattern + '/')) {
        return { matched: true, rule, riskLevel: rule.riskLevel };
      }
    }
  }

  return { matched: false };
}

/**
 * Check if a request should trigger safety popup based on blacklist config
 *
 * Blacklist mode is ALWAYS on:
 * - If request matches a blacklist rule -> trigger popup
 * - If no rule matches -> allow without popup
 */
export function shouldTriggerPopup(
  type: 'network' | 'file',
  data: { url?: string; path?: string; flags?: string[] },
  config: BlacklistConfig | null
): { shouldTrigger: boolean; rule?: BlacklistRule; riskLevel?: RiskLevel } {
  // If no config, don't intercept (allow all)
  if (!config) {
    return { shouldTrigger: false };
  }

  // Filter rules by type and enabled status
  const relevantRules = config.rules.filter((r) => r.type === type && r.enabled);

  // If no relevant rules, don't intercept
  if (relevantRules.length === 0) {
    return { shouldTrigger: false };
  }

  if (type === 'network' && data.url) {
    const result = matchNetworkRule(data.url, relevantRules);
    if (result.matched) {
      return { shouldTrigger: true, rule: result.rule, riskLevel: result.riskLevel };
    }
  }

  if (type === 'file' && data.path && data.flags) {
    const result = matchFileRule(data.path, data.flags, relevantRules);
    if (result.matched) {
      return { shouldTrigger: true, rule: result.rule, riskLevel: result.riskLevel };
    }
  }

  // No rule matched - allow without popup
  return { shouldTrigger: false };
}