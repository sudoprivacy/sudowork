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

import { ConfigStorage } from '@/common/storage';

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
 * Resolve the current sudowork-server base URL (renderer / async context).
 * Reads the user setting on every call — no caching.
 */
export async function getSudoworkServerBaseUrl(): Promise<string> {
  const raw = await ConfigStorage.get('system.sudoworkServerUrl').catch(() => undefined as unknown as string | undefined);
  return normalizeSudoworkServerUrl(raw) ?? BUILD_SUDOWORK_SERVER_BASE_URL;
}
