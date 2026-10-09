/**
 * Auth Proxy - lifecycle management and public API.
 *
 * This module manages:
 * - Starting/stopping the Auth Proxy HTTP server
 * - Token registry (for ACP child process authentication)
 * - Config Items cache refresh (for URL pattern matching)
 */

import { mainLog, mainError } from '@process/utils/mainLogger';
import { isEnterpriseMode } from '@common/enterpriseDebugConfig';
import { AuthProxyServer } from './AuthProxyServer';
import { refreshRules, getRules } from './configItemsLoader';

// ============================================================================
// Module state
// ============================================================================

let server: AuthProxyServer | null = null;
let serverPort: number | null = null;
let serverStartPromise: Promise<number> | null = null;

// ============================================================================
// Public API - Server lifecycle
// ============================================================================

/**
 * Start the Auth Proxy server.
 * Consumer credential calls start after secretCache.preload(). Online desktop
 * agents can start earlier because only local media routes are enabled.
 * Returns the port the server is listening on.
 */
export async function startAuthProxy(): Promise<number> {
  if (serverPort !== null) return serverPort;
  if (serverStartPromise) return serverStartPromise;
  serverStartPromise = startServer().finally(() => {
    serverStartPromise = null;
  });
  return serverStartPromise;
}

async function startServer(): Promise<number> {
  try {
    // Dynamic import minimatch to avoid bundling issues
    const minimatchModule = (await import('minimatch' as string)) as unknown as Record<string, unknown>;
    const minimatchFn = typeof minimatchModule.minimatch === 'function' ? minimatchModule.minimatch : typeof minimatchModule.default === 'function' ? minimatchModule.default : (minimatchModule as unknown as (str: string, pattern: string) => boolean);

    server = new AuthProxyServer(minimatchFn as (str: string, pattern: string) => boolean, () => !isEnterpriseMode());
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
  if (serverStartPromise) await serverStartPromise.catch((): void => undefined);
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

/** Make online local-media APIs ready before the agent receives its environment. */
export async function ensureLocalAgentApiPort(): Promise<number | null> {
  return isEnterpriseMode() ? startAuthProxy() : getAuthProxyPort();
}

/** Advertise the credential proxy only when credentials are managed locally. */
export function getCredentialProxyUrl(): string | null {
  return serverPort && !isEnterpriseMode() ? `http://127.0.0.1:${serverPort}/proxy` : null;
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
export async function refreshAuthProxyRules(accessToken: string, enabledConfigItemIds: number[]): Promise<void> {
  await refreshRules(accessToken, enabledConfigItemIds);
}
