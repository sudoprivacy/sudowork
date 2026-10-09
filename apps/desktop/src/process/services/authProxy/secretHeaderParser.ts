/**
 * Pure parsers for Auth Proxy request control headers.
 *
 * Extracted from AuthProxyServer so the parsing logic has no Electron / Nexus
 * dependencies and is unit-testable in isolation. AuthProxyServer delegates to
 * these via parseRequestInfo().
 */

import type { IncomingMessage } from 'http';

/**
 * Collect every X-Secret-Key value from the raw request, supporting both
 * repeated headers (e.g. two separate `X-Secret-Key: ...` lines) and
 * comma-separated values within a single header. Empty segments are dropped.
 * Returns null when no key is present (falls back to URL-pattern matching).
 */
export function parseSecretKeys(req: IncomingMessage): string[] | null {
  const rawValues: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i]?.toLowerCase() === 'x-secret-key') {
      const v = req.rawHeaders[i + 1];
      if (typeof v === 'string') rawValues.push(v);
    }
  }
  if (rawValues.length === 0) return null;
  const keys = rawValues
    .flatMap((v) => v.split(','))
    .map((k) => k.trim())
    .filter(Boolean);
  return keys.length > 0 ? keys : null;
}

/**
 * Parse X-Secret-Map into a vaultKey -> upstreamName record.
 * Format: "vaultKey->upstreamName, vaultKey->upstreamName".
 * Segments missing the `->` separator are silently skipped.
 * Returns null when the header is absent or produces no valid mappings.
 */
export function parseSecretMap(headerValue: string | null): Record<string, string> | null {
  if (!headerValue) return null;
  const map: Record<string, string> = {};
  for (const segment of headerValue.split(',')) {
    const idx = segment.indexOf('->');
    if (idx <= 0) continue;
    const vaultKey = segment.slice(0, idx).trim();
    const upstreamName = segment.slice(idx + 2).trim();
    if (vaultKey && upstreamName) {
      map[vaultKey] = upstreamName;
    }
  }
  return Object.keys(map).length > 0 ? map : null;
}
