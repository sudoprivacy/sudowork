/**
 * URL validation for the Auth Proxy.
 *
 * Validates that target URLs use allowed protocols (http/https only).
 *
 * Note: IP-level SSRF protection (blocking 127.0.0.1, 10.x, 192.168.x, etc.)
 * is intentionally NOT applied. The Auth Proxy:
 * - Listens on 127.0.0.1 only (no external access)
 * - Requires token authentication (only Skill child processes can use it)
 * - Runs on the user's own machine — the Skill process could directly access
 *   any local/LAN service without the proxy, so IP blocking adds no real
 *   security value and would prevent legitimate use cases (local dev servers,
 *   self-hosted APIs, on-premise services, etc.).
 */

// ============================================================================
// Public API
// ============================================================================

export interface ValidateUrlResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate that a URL uses an allowed protocol.
 */
export async function validateRemoteUrl(rawUrl: string): Promise<ValidateUrlResult> {
  return validateRemoteUrlSync(rawUrl);
}

/**
 * Synchronous URL validation — protocol check only.
 */
export function validateRemoteUrlSync(rawUrl: string): ValidateUrlResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, error: `Invalid URL: ${rawUrl}` };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: `Blocked protocol: ${parsed.protocol}` };
  }

  return { valid: true };
}
