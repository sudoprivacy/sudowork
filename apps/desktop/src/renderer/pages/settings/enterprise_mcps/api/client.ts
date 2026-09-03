/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unified fetch client for enterprise MCP APIs.
 * - Pulls Bearer token via the caller-supplied tokenProvider (kept as a function
 *   so this module stays decoupled from React context).
 * - Pulls base URL from ConfigStorage('eeclaw.serverUrl').
 * - Normalizes errors into EnterpriseMcpApiError.
 *
 * Response shapes:
 *  - Success: { success: true, data: T, ...pagination? }
 *  - Failure: { success: false, error: { code, message, ... } }
 *  - 401: server returns { error: "Unauthorized" } (no success field) — handled.
 */

import { ConfigStorage } from '@sudowork/common/storage';
import type { EnterpriseMcpApiError } from '../types';

export type TokenProvider = (forceRefresh?: boolean) => Promise<string | null>;

export class EnterpriseMcpError extends Error {
  public readonly code: string;
  public readonly httpStatus?: number;
  public readonly missing_keys?: string[];
  public readonly raw?: unknown;

  constructor(payload: EnterpriseMcpApiError, raw?: unknown) {
    super(payload.message);
    this.name = 'EnterpriseMcpError';
    this.code = payload.code;
    this.httpStatus = payload.httpStatus;
    this.missing_keys = payload.missing_keys;
    this.raw = raw;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  /** AbortSignal to cancel the request */
  signal?: AbortSignal;
}

async function resolveBaseUrl(): Promise<string> {
  const url = await ConfigStorage.get('eeclaw.serverUrl');
  if (!url || typeof url !== 'string') {
    throw new EnterpriseMcpError({
      code: 'server_url_missing',
      message: '未配置企业服务地址',
    });
  }
  return url.replace(/\/+$/, '');
}

function buildUrl(base: string, path: string, query?: RequestOptions['query']): string {
  const url = new URL(base + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function normalizeResponse<T>(res: Response): Promise<T> {
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new EnterpriseMcpError({
      code: 'invalid_response',
      message: `服务返回非 JSON 内容 (HTTP ${res.status})`,
      httpStatus: res.status,
    });
  }

  if (!res.ok) {
    // 401 special case
    if (res.status === 401) {
      throw new EnterpriseMcpError(
        {
          code: 'unauthorized',
          message: '登录已失效，请重新登录',
          httpStatus: 401,
        },
        json
      );
    }
    // Standard error envelope
    if (typeof json === 'object' && json !== null && 'error' in json) {
      const errObj = (json as { error: unknown }).error;
      if (typeof errObj === 'object' && errObj !== null) {
        const e = errObj as { code?: string; message?: string; missing_keys?: string[] };
        throw new EnterpriseMcpError(
          {
            code: e.code || 'unknown_error',
            message: e.message || `请求失败 (HTTP ${res.status})`,
            httpStatus: res.status,
            missing_keys: e.missing_keys,
          },
          json
        );
      }
      // 401-style flat error string
      if (typeof errObj === 'string') {
        throw new EnterpriseMcpError(
          {
            code: 'unknown_error',
            message: errObj,
            httpStatus: res.status,
          },
          json
        );
      }
    }
    throw new EnterpriseMcpError(
      {
        code: 'unknown_error',
        message: `请求失败 (HTTP ${res.status})`,
        httpStatus: res.status,
      },
      json
    );
  }

  // Success
  if (typeof json === 'object' && json !== null && 'success' in json) {
    const env = json as { success: boolean; data?: unknown; error?: { code?: string; message?: string } };
    if (!env.success) {
      const err = env.error;
      throw new EnterpriseMcpError(
        {
          code: err?.code || 'unknown_error',
          message: err?.message || '请求失败',
          httpStatus: res.status,
        },
        json
      );
    }
    return json as T; // caller picks `.data` or full envelope (pagination case)
  }
  return json as T;
}

export interface EnterpriseMcpClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  /** Stream events via SSE. Returns the EventSource so caller can attach listeners and close. */
  openEventStream(path: string): Promise<EventSource>;
  /** Get the resolved base URL (for SSE construction or external links). */
  getBaseUrl(): Promise<string>;
}

export function createEnterpriseMcpClient(tokenProvider: TokenProvider): EnterpriseMcpClient {
  const getToken = async (forceRefresh = false): Promise<string> => {
    const token = await tokenProvider(forceRefresh);
    if (!token) {
      throw new EnterpriseMcpError({
        code: 'unauthorized',
        message: '未登录或登录已失效',
        httpStatus: 401,
      });
    }
    return token;
  };

  return {
    async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
      const base = await resolveBaseUrl();
      const url = buildUrl(base, path, options.query);
      const token = await getToken();

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      };
      let bodyInit: BodyInit | undefined;
      if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        bodyInit = JSON.stringify(options.body);
      }

      const res = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body: bodyInit,
        signal: options.signal,
      });

      // Auto-retry once on 401 with forced token refresh
      if (res.status === 401) {
        const refreshed = await tokenProvider(true);
        if (refreshed) {
          const retryRes = await fetch(url, {
            method: options.method ?? 'GET',
            headers: { ...headers, Authorization: `Bearer ${refreshed}` },
            body: bodyInit,
            signal: options.signal,
          });
          return normalizeResponse<T>(retryRes);
        }
      }

      return normalizeResponse<T>(res);
    },

    async openEventStream(path: string): Promise<EventSource> {
      const base = await resolveBaseUrl();
      const token = await getToken();
      const url = new URL(base + path);
      url.searchParams.set('token', token);
      // EventSource cannot set headers; token is passed in query (per server spec).
      return new EventSource(url.toString());
    },

    async getBaseUrl(): Promise<string> {
      return resolveBaseUrl();
    },
  };
}
