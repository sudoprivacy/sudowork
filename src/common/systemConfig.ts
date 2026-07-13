/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Sudowork-server system-config client.
 *
 * Fetches the public system-config (`GET /api/v1/system-config`) and decrypts the
 * credentials envelope (`GET /api/v1/system-config/credentials`, AES-256-GCM), and
 * exposes synchronous base-url helpers + feature switches that every call site reads
 * on every use.
 *
 * Module placement: this lives in `src/common/` (shared by main + renderer). Per the
 * Electron bundling model, this module has ONE instance per process; each process fills
 * its own module-level cache at startup (main: `src/index.ts`, renderer:
 * `useSystemLoginMethod`), so synchronous helpers read the in-process instance without
 * any reverse dependency on `src/process/`.
 *
 * Sensitivity boundary: only NON-sensitive data (base urls + feature switches) is held
 * in this module-level cache. Decrypted credential plaintext (keys/tokens) is stored in
 * the main process only (`src/process/`) and never enters this module or the renderer.
 */

import { getSudoworkServerBaseUrl, normalizeSudoworkServerUrl } from '@/common/sudoworkServer';
import { COS_RELEASE_BASE } from '@/shared/cos';

// ---- build-time injected base URLs (Vite `define`; empty string = not injected) ----
declare const __SUDOROUTER_BASE_URL__: string | undefined;
declare const __SKILLHUB_BASE_URL__: string | undefined;
declare const __LOG_REPORT_BASE_URL__: string | undefined;
declare const __COS_RELEASE_BASE__: string | undefined;

/** Hardcoded fallbacks (the historical production addresses). */
export const FALLBACK_SUDOROUTER_BASE_URL = 'https://hk.sudorouter.ai';
export const FALLBACK_SKILLHUB_BASE_URL = 'https://sudoworkhub.sudoprivacy.com';
export const FALLBACK_LOG_REPORT_BASE_URL = 'https://sudolog.sudoprivacy.com';

/** Build-time injected value, or fallback when not injected (mirrors sudoworkServer.ts:33). */
export const BUILD_SUDOROUTER_BASE_URL: string = (typeof __SUDOROUTER_BASE_URL__ !== 'undefined' && __SUDOROUTER_BASE_URL__) || FALLBACK_SUDOROUTER_BASE_URL;
export const BUILD_SKILLHUB_BASE_URL: string = (typeof __SKILLHUB_BASE_URL__ !== 'undefined' && __SKILLHUB_BASE_URL__) || FALLBACK_SKILLHUB_BASE_URL;
export const BUILD_LOG_REPORT_BASE_URL: string = (typeof __LOG_REPORT_BASE_URL__ !== 'undefined' && __LOG_REPORT_BASE_URL__) || FALLBACK_LOG_REPORT_BASE_URL;
export const BUILD_COS_RELEASE_BASE: string = (typeof __COS_RELEASE_BASE__ !== 'undefined' && __COS_RELEASE_BASE__) || COS_RELEASE_BASE;

// ---- typed system-config shape (interface doc 1.4) ----
export interface SystemConfig {
  login_method?: number;
  third_party_auth?: ThirdPartyAuthConfig;
  log_report?: { enabled: number; baseurl?: string };
  version_update?: { enabled: number; cos_domain?: string };
  product_improvement?: { enabled: number; encryption_required?: boolean };
  sudorouter_baseurl?: string;
  skillhub_baseurl?: string;
}

export interface ThirdPartyAuthProvider {
  id: string;
  name: string;
  type: 'cas';
  cas_url: string;
  login_path?: string;
  validate_path?: string;
  logout_path?: string;
  service_param?: string;
}

export interface ThirdPartyAuthConfig {
  enabled?: boolean;
  default_provider?: string;
  providers?: ThirdPartyAuthProvider[];
}

/** Decrypted credentials plaintext (interface doc 2.4.3 — fields are conditional). */
export interface DecryptedCredentials {
  skillhub?: { token: string };
  log_report?: { key: string };
  product_improvement?: { api_key: string; public_key?: string };
}

// ---- module-level cache (per-process instance; resides for the process lifetime) ----
// No TTL: once filled (by startup bootstrap, autoUpdater branch, or renderer push), the
// cache stays put until the process exits. A time-based expiry would force every consumer
// to fall back to the hardcoded URL whenever no refresh path happened to fire — and there
// is no consumer or scheduler that re-fetches on expiry, so an expired cache was silently
// equivalent to a permanently absent cache. server-side dispatch changes are picked up on
// the next startup / re-login (the same windows that fill the cache in the first place).
let cachedConfig: SystemConfig | null = null;

/** Fill/replace the in-process cache (called by main `index.ts` and renderer `useSystemLoginMethod`). */
export function setSystemConfigCache(data: SystemConfig | null): void {
  cachedConfig = data;
}

/** Read the in-process cache; null only when never filled. */
export function getSystemConfigCache(): SystemConfig | null {
  return cachedConfig;
}

// ---- fetch (public, no auth; fetch + res.json() work in both processes) ----
export async function fetchSystemConfig(baseUrl?: string): Promise<SystemConfig | null> {
  try {
    const base = baseUrl ?? (await getSudoworkServerBaseUrl());
    const res = await fetch(`${base}/api/v1/system-config`);
    const json = (await res.json()) as { success?: boolean; data?: SystemConfig };
    if (json?.success && json.data) {
      setSystemConfigCache(json.data);
      return json.data;
    }
    return null;
  } catch (err) {
    console.warn('[systemConfig] fetch system-config failed:', err);
    return null;
  }
}

// ---- AES-256-GCM decryption of the credentials envelope (interface doc 2.4.2 / 2.5.5) ----
// Fixed shared key. atob + crypto.subtle are available in both Node (>=16) and browser,
// so this pure function is safe to keep in src/common/ (only ever invoked from main).
const CREDENTIALS_KEY_B64 = 'L7CbnQlwVrzWlaehCWSIiKuwBxFDh9i1AFaifYv7UXE=';

function base64ToBytes(b64: string): BufferSource {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function decryptCredentials(nonceB64: string, ciphertextB64: string): Promise<DecryptedCredentials> {
  const key = await crypto.subtle.importKey('raw', base64ToBytes(CREDENTIALS_KEY_B64), { name: 'AES-GCM' }, false, ['decrypt']);
  // GCM tag is appended to the ciphertext (interface doc 2.4.2); no AAD.
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(nonceB64) }, key, base64ToBytes(ciphertextB64));
  return JSON.parse(new TextDecoder().decode(plain)) as DecryptedCredentials;
}

// ---- synchronous base-url helpers (read module cache; 3-level fallback) ----
// Precedence: dispatched value > build-time define > hardcoded fallback.
function resolve(raw: string | null | undefined, buildValue: string): string {
  return normalizeSudoworkServerUrl(raw) ?? buildValue;
}

/** Sudorouter root address (call sites append `/v1`, `/search/tavily`, `/api/specific_pricing`, …). */
export function getSudorouterBaseUrl(): string {
  return resolve(getSystemConfigCache()?.sudorouter_baseurl, BUILD_SUDOROUTER_BASE_URL);
}

/**
 * Stable sudorouter identity check by host (NOT a `includes('sudorouter.ai')` substring test).
 * Matches the host of the current dispatched sudorouter base URL, so the check stays valid
 * after the domain is re-dispatched to a different company's deployment.
 */
export function isSudorouterBaseUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).host === new URL(getSudorouterBaseUrl()).host;
  } catch {
    return false;
  }
}

export function getSkillHubBaseUrl(): string {
  return resolve(getSystemConfigCache()?.skillhub_baseurl, BUILD_SKILLHUB_BASE_URL);
}

export function getLogReportBaseUrl(): string {
  return resolve(getSystemConfigCache()?.log_report?.baseurl, BUILD_LOG_REPORT_BASE_URL);
}

export function getCosReleaseBase(): string {
  return resolve(getSystemConfigCache()?.version_update?.cos_domain, BUILD_COS_RELEASE_BASE);
}

// ---- feature-switch helpers (fail-open: cache empty => keep current behavior) ----
// `enabled === 0` is the explicit "off" signal; anything else (including cache miss) keeps
// the historical behavior, so a transient fetch failure cannot silently disable features.
export function isVersionUpdateEnabled(): boolean {
  const cache = getSystemConfigCache();
  return cache ? cache.version_update?.enabled !== 0 : true;
}

export function isProductImprovementEnabled(): boolean {
  const cache = getSystemConfigCache();
  return cache ? cache.product_improvement?.enabled !== 0 : true;
}

export function isLogReportEnabled(): boolean {
  const cache = getSystemConfigCache();
  return cache ? cache.log_report?.enabled !== 0 : true;
}
