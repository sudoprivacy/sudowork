/**
 * Auth Proxy - lifecycle management and public API.
 *
 * This module manages:
 * - Starting/stopping the Auth Proxy HTTP server
 * - Token registry (for ACP child process authentication)
 * - Config Items cache refresh (for URL pattern matching)
 */

import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { AuthProxyServer } from './AuthProxyServer';
import { refreshRules, getRules } from './configItemsLoader';

// ============================================================================
// Module state
// ============================================================================

let server: AuthProxyServer | null = null;
let serverPort: number | null = null;

// ============================================================================
// Public API - Server lifecycle
// ============================================================================

/**
 * Start the Auth Proxy server.
 * Must be called after secretCache.preload() completes.
 * Returns the port the server is listening on.
 */
export async function startAuthProxy(): Promise<number> {
  if (server) {
    return server.getPort()!;
  }

  try {
    // Dynamic import minimatch to avoid bundling issues
    const minimatchDefault = (await import('minimatch' as string) as unknown as { default: (str: string, pattern: string) => boolean }).default;

    server = new AuthProxyServer(minimatchDefault);
    serverPort = await server.start();
    return serverPort;
  } catch (error) {
    mainError('AuthProxy', 'Failed to start:', error);
    throw error;
  }
}

/**
 * Stop the Auth Proxy server gracefully.
 */
export async function stopAuthProxy(): Promise<void> {
  if (!server) return;
  const port = serverPort;
  await server.stop();
  server = null;
  serverPort = null;
  mainLog('AuthProxy', `Stopped (was on port ${port})`);
}

/**
 * Get the current Auth Proxy port, or null if not running.
 */
export function getAuthProxyPort(): number | null {
  return serverPort;
}

// ============================================================================
// Public API - Token management (for AcpConnection)
// ============================================================================

/**
 * Register a proxy token for a child process.
 */
export function registerToken(token: string, pid: number): void {
  server?.registerToken(token, pid);
}

/**
 * Revoke a proxy token (e.g., when child process exits).
 */
export function revokeToken(token: string): void {
  server?.revokeToken(token);
}

// ============================================================================
// Public API - Config Items (for IPC bridge)
// ============================================================================

/**
 * Get all cached Config Items rules.
 */
export function getAuthProxyRules() {
  return getRules();
}

/**
 * Refresh Config Items from sudowork-server.
 * Called from renderer via IPC bridge.
 */
export async function refreshAuthProxyRules(
  accessToken: string,
  enabledConfigItemIds: number[],
): Promise<void> {
  await refreshRules(accessToken, enabledConfigItemIds);
}
