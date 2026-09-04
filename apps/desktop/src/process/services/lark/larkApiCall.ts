/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * User-scope (user_access_token) Feishu Open API calls, made directly via
 * `fetch` — no lark-cli binary involved. Sudowork owns and refreshes the token
 * itself; these helpers handle on-demand refresh against the stored credentials.
 */

import type { IPluginCredentials } from '@/channels/types';
import { mainWarn } from '@/process/utils/mainLogger';

import { getLarkAuthService, type ILarkUserToken } from './LarkAuthService';
import { parseBrand, resolveEndpoints, PATH_USER_INFO_V1, type LarkBrand } from './larkEndpoints';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/** Coerce a stored timestamp (number, or numeric string from some providers) to a number. */
function toMillis(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.length > 0 && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/**
 * Call a Feishu Open API endpoint with a user_access_token (Bearer auth) and
 * return the parsed JSON response.
 */
export async function callLarkUserApi(opts: { brand: LarkBrand; accessToken: string; method: Method; path: string; body?: Record<string, unknown> }): Promise<Record<string, unknown>> {
  const ep = resolveEndpoints(opts.brand);
  const url = ep.open + opts.path;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const resp = await fetch(url, {
      method: opts.method,
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    const text = await resp.text();
    try {
      return text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      throw new Error(`Feishu API returned non-JSON (HTTP ${resp.status}): ${text.slice(0, 300)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export interface IEnsureTokenResult {
  brand: LarkBrand;
  accessToken: string;
  /** When set, the token was refreshed and the caller should persist these fields. */
  refreshed?: ILarkUserToken;
}

/**
 * Return a currently-valid user_access_token for the given credentials,
 * refreshing it if it expires within 5 minutes. When a refresh happens, the
 * fresh token is returned under `refreshed` so the caller can write it back to
 * the credential store. Throws if there is no token, or the refresh token has
 * expired / been rejected (the user must scan again).
 */
export async function ensureValidUserToken(creds: IPluginCredentials): Promise<IEnsureTokenResult> {
  const brand = parseBrand(creds.larkBrand);
  const accessToken = creds.larkUserAccessToken;
  if (!accessToken) {
    throw new Error('No Feishu user token — please scan to log in first.');
  }

  const expiresAt = toMillis(creds.larkUserTokenExpiresAt);
  const needsRefresh = expiresAt !== undefined && expiresAt - Date.now() < 5 * 60 * 1000;
  if (!needsRefresh) {
    return { brand, accessToken };
  }

  const refreshToken = creds.larkUserRefreshToken;
  const appId = creds.appId;
  const appSecret = creds.appSecret;
  if (!refreshToken || !appId || !appSecret) {
    // Can't refresh without these — fall back to the existing token and let the
    // API call surface any auth error.
    mainWarn('LarkApi', 'user token near expiry but missing refresh_token/app credentials; using existing token');
    return { brand, accessToken };
  }

  const refreshExpiresAt = toMillis(creds.larkUserRefreshTokenExpiresAt);
  if (refreshExpiresAt !== undefined && refreshExpiresAt <= Date.now()) {
    throw new Error('Feishu login expired — please scan to log in again.');
  }

  const fresh = await getLarkAuthService().refreshUserToken(brand, appId, appSecret, refreshToken);
  if (!fresh || !fresh.accessToken) {
    throw new Error('Feishu login expired — please scan to log in again.');
  }
  return { brand, accessToken: fresh.accessToken, refreshed: fresh };
}

export interface ILarkUserInfo {
  name?: string;
  openId?: string;
  email?: string;
}

/**
 * Fetch the OAuth user identity (the human who completed the QR login) via
 * /open-apis/authen/v1/user_info. Soft-fail variant — returns null on any error.
 */
export async function fetchLarkUserInfo(opts: { brand: LarkBrand; accessToken: string }): Promise<ILarkUserInfo | null> {
  try {
    return await fetchLarkUserInfoOrThrow(opts);
  } catch {
    return null;
  }
}

export async function fetchLarkUserInfoOrThrow(opts: { brand: LarkBrand; accessToken: string }): Promise<ILarkUserInfo> {
  const resp = await callLarkUserApi({ brand: opts.brand, accessToken: opts.accessToken, method: 'GET', path: PATH_USER_INFO_V1 });
  const code = (resp as { code?: number }).code;
  if (typeof code === 'number' && code !== 0) {
    const msg = (resp as { msg?: string }).msg ?? 'unknown error';
    throw new Error(`Feishu API error code=${code}: ${msg}`);
  }
  const data = (resp as { data?: Record<string, unknown> }).data;
  if (!data) {
    throw new Error('Feishu API returned no data');
  }
  return {
    name: typeof data.name === 'string' ? data.name : undefined,
    openId: typeof data.open_id === 'string' ? data.open_id : undefined,
    email: typeof data.email === 'string' ? data.email : undefined,
  };
}
