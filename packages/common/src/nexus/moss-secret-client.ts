/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

export interface MossSecretEntry {
  namespace: string;
  key: string;
  enabled: boolean;
  status: 'enabled' | 'disabled';
  version: number;
}

/** User-scoped secret resource shared by desktop and web frontend adapters. */
export function mossSecretPath(namespace: string, key: string, action?: 'enable' | 'disable'): string {
  const path = `/api/v1/me/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`;
  return action ? `${path}/${action}` : path;
}

export interface MossResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export function mossSecretResult<T>(body: MossResponse<T>): T {
  if (!body.success) throw new Error(body.error?.message || body.error?.code || 'Moss secret request failed');
  return body.data as T;
}

export class MossSecretClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(mossServerUrl: string, authToken: string, _userId: string) {
    this.baseUrl = mossServerUrl.replace(/\/+$/, '');
    this.headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    };
  }

  private url(namespace: string, key: string, action?: 'enable' | 'disable'): string {
    return `${this.baseUrl}${mossSecretPath(namespace, key, action)}`;
  }

  private async request<T>(url: string, options: RequestInit): Promise<T> {
    const res = await fetch(url, {
      ...options,
      headers: { ...this.headers, ...options.headers },
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404) {
      return null as T;
    }
    const body = (await res.json()) as MossResponse<T>;
    return mossSecretResult(body);
  }

  async getSecret(namespace: string, key: string): Promise<string | null> {
    const data = await this.request<{ value: string } | null>(this.url(namespace, key), { method: 'GET' });
    return data?.value ?? null;
  }

  async putSecret(namespace: string, key: string, value: string): Promise<void> {
    await this.request<void>(this.url(namespace, key), {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
  }

  async deleteSecret(namespace: string, key: string): Promise<void> {
    const res = await fetch(this.url(namespace, key), {
      method: 'DELETE',
      headers: this.headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '');
      throw new Error(`Moss DELETE ${namespace}/${key} failed: ${res.status} ${text}`);
    }
  }

  async enableSecret(namespace: string, key: string): Promise<void> {
    await this.request<void>(this.url(namespace, key, 'enable'), {
      method: 'POST',
    });
  }

  async disableSecret(namespace: string, key: string): Promise<void> {
    await this.request<void>(this.url(namespace, key, 'disable'), {
      method: 'POST',
    });
  }

  async listSecrets(): Promise<MossSecretEntry[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/me/secrets`, {
      headers: this.headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Moss LIST failed: ${res.status} ${text}`);
    }
    const body = (await res.json()) as MossResponse<MossSecretEntry[]>;
    return mossSecretResult(body) ?? [];
  }
}
