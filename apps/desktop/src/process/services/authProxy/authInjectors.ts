/**
 * Auth injection strategies for the Auth Proxy.
 *
 * Pure functions that receive a secret value and scheme,
 * and return the headers/query to inject into the upstream request.
 */

import { Buffer } from 'buffer';

// ============================================================================
// Types
// ============================================================================

export interface InjectAuthParams {
  scheme: string;
  secret: string;
  /** Custom header name (for scheme=header) or query param name (for scheme=query) */
  headerName?: string;
  /** Custom prefix for scheme=bearer (default: 'Bearer') */
  prefix?: string;
}

export interface InjectAuthResult {
  headers: Record<string, string>;
  /** Modified URL with query params appended (only for scheme=query) */
  url?: string;
}

// ============================================================================
// Injection functions
// ============================================================================

/**
 * Inject authentication based on the specified scheme.
 *
 * | Scheme   | Injection                                    |
 * |----------|---------------------------------------------|
 * | bearer   | Authorization: <prefix> <secret>             |
 * | header   | <headerName>: <secret>                       |
 * | query    | <headerName>=<secret> appended to URL        |
 * | basic    | Authorization: Basic <base64(secret)>        |
 */
export function injectAuth(params: InjectAuthParams): InjectAuthResult {
  const { scheme, secret, headerName, prefix } = params;

  switch (scheme) {
    case 'bearer': {
      const effectivePrefix = prefix ?? 'Bearer';
      return { headers: { Authorization: `${effectivePrefix} ${secret}` } };
    }

    case 'header': {
      const name = headerName ?? 'X-API-Key';
      return { headers: { [name]: secret } };
    }

    case 'query': {
      const name = headerName ?? 'api_key';
      // Return url with appended query param; caller is responsible for merging
      return { headers: {}, url: `${name}=${encodeURIComponent(secret)}` };
    }

    case 'basic': {
      const encoded = Buffer.from(secret, 'utf-8').toString('base64');
      return { headers: { Authorization: `Basic ${encoded}` } };
    }

    default: {
      // Fallback: treat as bearer
      const effectivePrefix = prefix ?? 'Bearer';
      return { headers: { Authorization: `${effectivePrefix} ${secret}` } };
    }
  }
}

/**
 * Inject multiple headers for header/query schemes with multiple entries.
 *
 * @param nameMap - Optional mapping from Vault configKey to the upstream
 *                  header / query param name. Entries not present in the map
 *                  (or when the map is omitted) fall back to `entry.configKey`,
 *                  preserving the URL-pattern path's original behavior.
 */
export function injectMultiAuth(scheme: string, entries: Array<{ configKey: string; secret: string }>, nameMap?: Record<string, string>): InjectAuthResult {
  const headers: Record<string, string> = {};
  const queryParts: string[] = [];

  for (const entry of entries) {
    const name = nameMap?.[entry.configKey] ?? entry.configKey;
    if (scheme === 'header') {
      headers[name] = entry.secret;
    } else if (scheme === 'query') {
      queryParts.push(`${name}=${encodeURIComponent(entry.secret)}`);
    }
  }

  if (scheme === 'query' && queryParts.length > 0) {
    return { headers, url: queryParts.join('&') };
  }

  return { headers };
}
