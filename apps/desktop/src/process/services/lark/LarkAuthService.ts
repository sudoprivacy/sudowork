/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Direct (no-binary) Feishu/Lark device-flow authentication.
 *
 * Ported from the official lark-cli Go source (D:\sudo\lark\cli):
 *   - internal/auth/app_registration.go  (RequestAppRegistration / PollAppRegistration)
 *   - internal/auth/device_flow.go        (RequestDeviceAuthorization / PollDeviceToken)
 *   - internal/auth/uat_client.go          (doRefreshToken)
 *
 * Everything runs in-process via `fetch` against the OAuth endpoints — there is
 * no dependency on the lark-cli binary or its local token store. Sudowork owns
 * the resulting tokens and persists them itself.
 */

import { mainLog, mainWarn } from '@/process/utils/mainLogger';

import { type LarkBrand, resolveEndpoints, PATH_APP_REGISTRATION, PATH_DEVICE_AUTHORIZATION, PATH_OAUTH_TOKEN_V2 } from './larkEndpoints';

const TAG = 'LarkAuth';

const MAX_POLL_INTERVAL_SEC = 60;

export interface IAppRegistrationStart {
  deviceCode: string;
  userCode: string;
  /** Browser/QR verification URL ({Open}/page/cli?user_code=...). */
  verificationUrl: string;
  expiresIn: number;
  interval: number;
}

export interface IAppRegistrationResult {
  appId: string;
  appSecret: string;
  openId?: string;
  /** "feishu" | "lark" — the tenant brand the app was actually created under. */
  tenantBrand?: string;
}

export interface IDeviceAuthStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export interface ILarkUserToken {
  accessToken: string;
  refreshToken?: string;
  /** epoch-ms when the access token expires */
  expiresAt?: number;
  /** epoch-ms when the refresh token expires */
  refreshExpiresAt?: number;
  scope?: string;
}

export interface IDeviceTokenResult {
  status: 'success' | 'expired' | 'denied' | 'failed';
  token?: ILarkUserToken;
  error?: string;
}

/** A small typed wrapper around a parsed form-POST response. */
interface IFormResponse {
  status: number;
  data: Record<string, unknown>;
}

function getStr(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === 'string' ? v : '';
}

function getNum(data: Record<string, unknown>, key: string, fallback: number): number {
  const v = data[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.length > 0 && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class LarkAuthService {
  /** POST an application/x-www-form-urlencoded body and parse the JSON response. */
  private async postForm(url: string, form: Record<string, string>, headers?: Record<string, string>, signal?: AbortSignal): Promise<IFormResponse> {
    const body = new URLSearchParams(form).toString();
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
      body,
      signal,
    });
    const text = await resp.text();
    let data: Record<string, unknown> = {};
    if (text) {
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new Error(`HTTP ${resp.status} – response not JSON`);
      }
    }
    return { status: resp.status, data };
  }

  /**
   * Begin app registration (mirrors RequestAppRegistration). The registration
   * "begin" endpoint always uses the feishu accounts host, but the verification
   * URL is built from the requested brand's Open host.
   */
  async requestAppRegistration(brand: LarkBrand): Promise<IAppRegistrationStart> {
    const ep = resolveEndpoints(brand);
    const feishuAccounts = resolveEndpoints('feishu').accounts; // registration begin always uses feishu
    const { status, data } = await this.postForm(feishuAccounts + PATH_APP_REGISTRATION, {
      action: 'begin',
      archetype: 'PersonalAgent',
      auth_method: 'client_secret',
      request_user_info: 'open_id tenant_brand',
    });
    if (status >= 400 || data.error) {
      throw new Error(`app registration failed: ${getStr(data, 'error_description') || getStr(data, 'error') || 'Unknown error'}`);
    }
    const userCode = getStr(data, 'user_code');
    return {
      deviceCode: getStr(data, 'device_code'),
      userCode,
      verificationUrl: `${ep.open}/page/cli?user_code=${userCode}`,
      expiresIn: getNum(data, 'expires_in', 300),
      interval: getNum(data, 'interval', 5),
    };
  }

  /**
   * Poll the app registration endpoint until the app is created (mirrors
   * PollAppRegistration). When the first poll cycle returns no client_secret
   * but tenant_brand === "lark", the whole flow is retried against the lark
   * accounts host so we can read the secret there.
   */
  async pollAppRegistration(brand: LarkBrand, deviceCode: string, interval: number, expiresIn: number, signal?: AbortSignal): Promise<IAppRegistrationResult> {
    const result = await this.pollAppRegistrationOnce(brand, deviceCode, interval, expiresIn, signal);
    if (!result.appSecret && result.tenantBrand === 'lark' && brand !== 'lark') {
      mainLog(TAG, 'app registered under lark tenant; retrying registration against lark host');
      const lark = await this.requestAppRegistration('lark');
      return this.pollAppRegistrationOnce('lark', lark.deviceCode, lark.interval, lark.expiresIn, signal);
    }
    return result;
  }

  private async pollAppRegistrationOnce(brand: LarkBrand, deviceCode: string, interval: number, expiresIn: number, signal?: AbortSignal): Promise<IAppRegistrationResult> {
    const ep = resolveEndpoints(brand);
    const endpoint = ep.accounts + PATH_APP_REGISTRATION;
    const deadline = Date.now() + expiresIn * 1000;
    let curInterval = Math.max(1, interval);

    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error('cancelled');
      await sleep(curInterval * 1000);
      if (signal?.aborted) throw new Error('cancelled');

      let resp: IFormResponse;
      try {
        resp = await this.postForm(endpoint, { action: 'poll', device_code: deviceCode }, undefined, signal);
      } catch (err) {
        if (signal?.aborted) throw new Error('cancelled');
        mainWarn(TAG, 'app-registration poll error', err);
        curInterval = Math.min(curInterval + 1, MAX_POLL_INTERVAL_SEC);
        continue;
      }
      const { data } = resp;
      const errStr = getStr(data, 'error');

      if (!errStr && getStr(data, 'client_id')) {
        const userInfo = (data.user_info ?? {}) as Record<string, unknown>;
        return {
          appId: getStr(data, 'client_id'),
          appSecret: getStr(data, 'client_secret'),
          openId: getStr(userInfo, 'open_id') || undefined,
          tenantBrand: getStr(userInfo, 'tenant_brand') || undefined,
        };
      }

      if (errStr === 'authorization_pending') continue;
      if (errStr === 'slow_down') {
        curInterval = Math.min(curInterval + 5, MAX_POLL_INTERVAL_SEC);
        continue;
      }
      if (errStr === 'access_denied') throw new Error('app registration denied by user');
      if (errStr === 'expired_token' || errStr === 'invalid_grant') throw new Error('device code expired, please try again');

      throw new Error(`app registration failed: ${getStr(data, 'error_description') || errStr || 'Unknown error'}`);
    }
    throw new Error('app registration timed out, please try again');
  }

  /**
   * Request device authorization for the user OAuth step (mirrors
   * RequestDeviceAuthorization). `offline_access` is appended automatically so
   * we get a refresh_token back.
   */
  async requestDeviceAuthorization(brand: LarkBrand, appId: string, appSecret: string, scope: string): Promise<IDeviceAuthStart> {
    const ep = resolveEndpoints(brand);
    let effectiveScope = scope;
    if (!effectiveScope.includes('offline_access')) {
      effectiveScope = effectiveScope ? `${effectiveScope} offline_access` : 'offline_access';
    }
    const basicAuth = Buffer.from(`${appId}:${appSecret}`).toString('base64');
    const { status, data } = await this.postForm(ep.accounts + PATH_DEVICE_AUTHORIZATION, { client_id: appId, scope: effectiveScope }, { Authorization: `Basic ${basicAuth}` });
    if (status >= 400 || data.error) {
      throw new Error(`Device authorization failed: ${getStr(data, 'error_description') || getStr(data, 'error') || 'Unknown error'}`);
    }
    const verificationUri = getStr(data, 'verification_uri');
    const verificationUriComplete = getStr(data, 'verification_uri_complete') || verificationUri;
    return {
      deviceCode: getStr(data, 'device_code'),
      userCode: getStr(data, 'user_code'),
      verificationUri,
      verificationUriComplete,
      expiresIn: getNum(data, 'expires_in', 240),
      interval: getNum(data, 'interval', 5),
    };
  }

  /**
   * Poll the token endpoint until the user completes authorization (mirrors
   * PollDeviceToken). Resolves with status 'success' + token, or a terminal
   * 'expired'/'denied'/'failed'.
   */
  async pollDeviceToken(brand: LarkBrand, appId: string, appSecret: string, deviceCode: string, interval: number, expiresIn: number, signal?: AbortSignal): Promise<IDeviceTokenResult> {
    const ep = resolveEndpoints(brand);
    const endpoint = ep.open + PATH_OAUTH_TOKEN_V2;
    const deadline = Date.now() + expiresIn * 1000;
    let curInterval = Math.max(1, interval);

    while (Date.now() < deadline) {
      if (signal?.aborted) return { status: 'failed', error: 'cancelled' };
      await sleep(curInterval * 1000);
      if (signal?.aborted) return { status: 'failed', error: 'cancelled' };

      let resp: IFormResponse;
      try {
        resp = await this.postForm(
          endpoint,
          {
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            device_code: deviceCode,
            client_id: appId,
            client_secret: appSecret,
          },
          undefined,
          signal
        );
      } catch (err) {
        if (signal?.aborted) return { status: 'failed', error: 'cancelled' };
        mainWarn(TAG, 'device-flow poll error', err);
        curInterval = Math.min(curInterval + 1, MAX_POLL_INTERVAL_SEC);
        continue;
      }
      const { data } = resp;
      const errStr = getStr(data, 'error');

      if (!errStr && getStr(data, 'access_token')) {
        return { status: 'success', token: this.parseTokenResponse(data) };
      }

      if (errStr === 'authorization_pending') continue;
      if (errStr === 'slow_down') {
        curInterval = Math.min(curInterval + 5, MAX_POLL_INTERVAL_SEC);
        continue;
      }
      if (errStr === 'access_denied') {
        return { status: 'denied', error: getStr(data, 'error_description') || 'Authorization denied by user' };
      }
      if (errStr === 'expired_token' || errStr === 'invalid_grant') {
        return { status: 'expired', error: getStr(data, 'error_description') || 'Device code expired, please try again' };
      }
      // Unexpected error — treat as terminal failure.
      return { status: 'failed', error: getStr(data, 'error_description') || errStr || 'Unknown error' };
    }
    return { status: 'expired', error: 'Authorization timed out, please try again' };
  }

  /**
   * Exchange a refresh_token for a fresh access token (mirrors doRefreshToken).
   * Returns null when the refresh token is rejected/expired — the caller must
   * then prompt the user to scan again. Throws only on network errors.
   */
  async refreshUserToken(brand: LarkBrand, appId: string, appSecret: string, refreshToken: string): Promise<ILarkUserToken | null> {
    const ep = resolveEndpoints(brand);
    const { data } = await this.postForm(ep.open + PATH_OAUTH_TOKEN_V2, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: appId,
      client_secret: appSecret,
    });

    const code = getNum(data, 'code', -1);
    const errStr = getStr(data, 'error');
    if ((code !== -1 && code !== 0) || errStr) {
      mainWarn(TAG, `token refresh failed (code=${code}, error=${errStr})`);
      return null;
    }
    if (!getStr(data, 'access_token')) {
      mainWarn(TAG, 'token refresh returned no access_token');
      return null;
    }
    const token = this.parseTokenResponse(data);
    // The endpoint may omit refresh_token on refresh — keep the existing one.
    if (!token.refreshToken) token.refreshToken = refreshToken;
    return token;
  }

  /** Parse the common token-response shape (expires_in → epoch-ms expiresAt). */
  private parseTokenResponse(data: Record<string, unknown>): ILarkUserToken {
    const now = Date.now();
    const expiresIn = getNum(data, 'expires_in', 7200);
    const refreshExpiresIn = getNum(data, 'refresh_token_expires_in', 0);
    return {
      accessToken: getStr(data, 'access_token'),
      refreshToken: getStr(data, 'refresh_token') || undefined,
      expiresAt: now + expiresIn * 1000,
      refreshExpiresAt: refreshExpiresIn > 0 ? now + refreshExpiresIn * 1000 : undefined,
      scope: getStr(data, 'scope') || undefined,
    };
  }
}

let instance: LarkAuthService | null = null;
export function getLarkAuthService(): LarkAuthService {
  if (!instance) instance = new LarkAuthService();
  return instance;
}
