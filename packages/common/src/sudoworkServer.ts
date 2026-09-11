/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Sudowork Server base URL resolver.
 *
 * Priority (highest to lowest):
 *   1. User setting in ConfigStorage / ProcessConfig (`system.sudoworkServerUrl`)
 *   2. Build-time injected value (`__SUDOWORK_SERVER_BASE_URL__` via Vite `define`)
 *   3. Hardcoded fallback (`FALLBACK_SUDOWORK_SERVER_BASE_URL`)
 *
 * All call sites must resolve the URL on every use (no caching of the value
 * inside Reporter / module-level constants) so that user updates take effect
 * on the next call without any reload/relaunch.
 */

import { ConfigStorage } from './storage.js';

// Vite `define` injects this as a string literal at build time.
// Empty string when the env var BUILD_SERVER_BASE_URL was not set during build.
declare const __SUDOWORK_SERVER_BASE_URL__: string | undefined;

/** Hardcoded fallback (the historical production address). */
export const FALLBACK_SUDOWORK_SERVER_BASE_URL = 'https://sudowork-server.sudoprivacy.com';

/**
 * Build-time injected base URL, or fallback when not injected.
 * Resolved synchronously at module load (the define is a compile-time string literal).
 */
export const BUILD_SUDOWORK_SERVER_BASE_URL: string = (typeof __SUDOWORK_SERVER_BASE_URL__ !== 'undefined' && __SUDOWORK_SERVER_BASE_URL__) || FALLBACK_SUDOWORK_SERVER_BASE_URL;

/**
 * Normalize a raw URL string: trim whitespace and strip trailing slashes.
 * Returns null for empty / null / undefined / non-string inputs so callers can
 * `?? BUILD_SUDOWORK_SERVER_BASE_URL` to fall back cleanly.
 */
export function normalizeSudoworkServerUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Whether this is the browser host (apps/webui) rather than the desktop app.
 *
 * The desktop bundle has no `window.__sudoworkWebBridge`; the web adapter sets
 * it at import time, before any of this runs.
 */
function isWebHost(): boolean {
  return typeof window !== 'undefined'
    && Boolean((window as { __sudoworkWebBridge?: boolean }).__sudoworkWebBridge);
}

/**
 * Resolve the current sudowork-server base URL (renderer / async context).
 * Reads the user setting on every call — no caching.
 *
 * On the browser host the answer is this origin, which fronts the server the
 * session belongs to. The compiled-in default points at the consumer server,
 * and a page served from somewhere else reaching for it is a cross-origin
 * request that simply fails — which is not visible as a failure, because every
 * caller here treats a failed config fetch as "unknown" and falls back to a
 * default. That is how the web console came to show a payment UI for a
 * deployment that had declared credit applications instead.
 */
export async function getSudoworkServerBaseUrl(): Promise<string> {
  const raw = await ConfigStorage.get('system.sudoworkServerUrl').catch(() => undefined as unknown as string | undefined);
  const configured = normalizeSudoworkServerUrl(raw);
  if (configured) return configured;
  if (isWebHost()) return window.location.origin;
  return BUILD_SUDOWORK_SERVER_BASE_URL;
}
