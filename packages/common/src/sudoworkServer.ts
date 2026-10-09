/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Online service base URL resolver.
 *
 * Priority (highest to lowest):
 *   1. Administrator-managed URL when locked
 *   2. User setting in ConfigStorage / ProcessConfig (`eeclaw.serverUrl`)
 *   3. Legacy user setting (`system.sudoworkServerUrl`)
 *   4. Build-time injected value (`__SUDOWORK_SERVER_BASE_URL__` via Vite `define`)
 *   5. Hosted Moss fallback
 *
 * All call sites must resolve the URL on every use (no caching of the value
 * inside Reporter / module-level constants) so that user updates take effect
 * on the next call without any reload/relaunch.
 */

import { ConfigStorage } from './storage.js';
import type { IConfigStorageRefer } from './storageTypes.js';

// Vite `define` injects this as a string literal at build time.
// Empty string when the env var BUILD_SERVER_BASE_URL was not set during build.
declare const __SUDOWORK_SERVER_BASE_URL__: string | undefined;
declare const __SUDOWORK_SERVER_LOCKED__: boolean | undefined;

/** Hosted Moss used when neither an administrator nor the user supplied one. */
export const FALLBACK_SUDOWORK_SERVER_BASE_URL = 'https://agent.sudoprivacy.com';

/**
 * Build-time injected base URL, or fallback when not injected.
 * Resolved synchronously at module load (the define is a compile-time string literal).
 */
export const BUILD_SUDOWORK_SERVER_BASE_URL: string = (typeof __SUDOWORK_SERVER_BASE_URL__ !== 'undefined' && __SUDOWORK_SERVER_BASE_URL__) || FALLBACK_SUDOWORK_SERVER_BASE_URL;
export const BUILD_SUDOWORK_SERVER_LOCKED: boolean = typeof __SUDOWORK_SERVER_LOCKED__ !== 'undefined' && __SUDOWORK_SERVER_LOCKED__ === true;

export interface IMossServerPolicy {
  serverUrl: string;
  isLocked: boolean;
  source: 'managed' | 'user' | 'legacy' | 'build';
}

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
  return typeof window !== 'undefined' && Boolean((window as { __sudoworkWebBridge?: boolean }).__sudoworkWebBridge);
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
  if (isWebHost()) return window.location.origin;
  return (await getMossServerPolicy()).serverUrl;
}

/** Resolve the effective Moss address and whether the UI may change it. */
export async function getMossServerPolicy(): Promise<IMossServerPolicy> {
  const [managedRaw, isManagedLocked, userRaw, legacyRaw] = await Promise.all([
    ConfigStorage.get('system.managedMossServerUrl').catch((): string | undefined => undefined),
    ConfigStorage.get('system.mossServerUrlLocked').catch((): boolean | undefined => undefined),
    ConfigStorage.get('eeclaw.serverUrl').catch((): string | undefined => undefined),
    ConfigStorage.get('system.sudoworkServerUrl').catch((): string | undefined => undefined),
  ]);
  return resolveMossServerPolicy({
    'system.managedMossServerUrl': managedRaw,
    'system.mossServerUrlLocked': isManagedLocked,
    'eeclaw.serverUrl': userRaw,
    'system.sudoworkServerUrl': legacyRaw,
  });
}

/** Shared policy; each host supplies config through its own storage adapter. */
export function resolveMossServerPolicy(config: Pick<IConfigStorageRefer, 'system.managedMossServerUrl' | 'system.mossServerUrlLocked' | 'eeclaw.serverUrl' | 'system.sudoworkServerUrl'>): IMossServerPolicy {
  const managedRaw = config['system.managedMossServerUrl'];
  const isManagedLocked = config['system.mossServerUrlLocked'];
  const userRaw = config['eeclaw.serverUrl'];
  const legacyRaw = config['system.sudoworkServerUrl'];
  const managed = normalizeHttpOrigin(managedRaw);
  if (managed && isManagedLocked === true) {
    return { serverUrl: managed, isLocked: true, source: 'managed' };
  }
  if (BUILD_SUDOWORK_SERVER_LOCKED) {
    return {
      serverUrl: BUILD_SUDOWORK_SERVER_BASE_URL,
      isLocked: true,
      source: 'build',
    };
  }
  const user = normalizeHttpOrigin(userRaw);
  if (user) return { serverUrl: user, isLocked: false, source: 'user' };
  if (managed) return { serverUrl: managed, isLocked: false, source: 'managed' };
  const legacy = normalizeHttpOrigin(legacyRaw);
  if (legacy) return { serverUrl: legacy, isLocked: false, source: 'legacy' };
  return {
    serverUrl: BUILD_SUDOWORK_SERVER_BASE_URL,
    isLocked: false,
    source: 'build',
  };
}

/** Accept only an HTTP(S) origin; paths and embedded credentials are rejected. */
export function normalizeHttpOrigin(raw: string | null | undefined): string | null {
  const normalized = normalizeSudoworkServerUrl(raw);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Migrate only the retired public default; preserve private and managed deployments. */
export function migrateHostedMossConfig(
  config: IConfigStorageRefer,
  buildPolicy = {
    serverUrl: BUILD_SUDOWORK_SERVER_BASE_URL,
    isLocked: BUILD_SUDOWORK_SERVER_LOCKED,
  }
): IConfigStorageRefer | null {
  if (buildPolicy.isLocked || normalizeHttpOrigin(buildPolicy.serverUrl) !== FALLBACK_SUDOWORK_SERVER_BASE_URL || normalizeHttpOrigin(config['system.managedMossServerUrl'])) return null;
  const isRetired = (url: string | undefined) => {
    const origin = normalizeHttpOrigin(url);
    return origin === 'https://sudowork-server.sudoprivacy.com' || origin === 'http://sudowork-server.sudoprivacy.com';
  };
  const effectiveUrl = normalizeHttpOrigin(config['eeclaw.serverUrl']) || normalizeHttpOrigin(config['system.sudoworkServerUrl']);
  if (!isRetired(effectiveUrl || undefined)) return null;

  const migrated = { ...config };
  migrated['eeclaw.serverUrl'] = FALLBACK_SUDOWORK_SERVER_BASE_URL;
  if (isRetired(config['system.sudoworkServerUrl'])) migrated['system.sudoworkServerUrl'] = FALLBACK_SUDOWORK_SERVER_BASE_URL;
  // Persist the reset marker with the URL so the renderer cannot restore old tokens.
  migrated['migration.hostedMossAuthReset'] = 'hosted-moss-v1';
  delete migrated['eeclaw.authStorage'];
  delete migrated['eeclaw.userInfo'];
  delete migrated['eeclaw.accountScope'];
  delete migrated['eeclaw.execution'];
  delete migrated['eeclaw.localRuntime'];
  delete migrated['eeclaw.localModeAvailable'];
  delete migrated['eeclaw.tenantConfig'];
  delete migrated['eeclaw.tenantName'];
  delete migrated['consumer.userInfo'];
  return migrated;
}
