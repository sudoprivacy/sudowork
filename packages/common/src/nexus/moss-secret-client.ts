/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

export interface MossSecretEntry {
  id: string;
  namespace: string;
  key: string;
  description: string | null;
  enabled: boolean;
  current_version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MossResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
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

  private url(namespace: string, key: string, action?: string): string {
    const ns = encodeURIComponent(namespace);
    const k = encodeURIComponent(key);
    const base = `${this.baseUrl}/api/v1/me/secrets/${ns}/${k}`;
    return action ? `${base}/${action}` : base;
  }

  private async request<T>(url: string, options: RequestInit): Promise<T> {
    const res = await fetch(url, { ...options, headers: { ...this.headers, ...options.headers }, signal: AbortSignal.timeout(10000) });
    if (res.status === 404) {
      return null as T;
    }
    const body = (await res.json()) as MossResponse<T>;
    if (!body.success) {
      const msg = body.error?.message || body.error?.code || `HTTP ${res.status}`;
      throw new Error(`Moss API error: ${msg}`);
    }
    return body.data as T;
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
    await this.request<void>(this.url(namespace, key, 'enable'), { method: 'POST' });
  }

  async disableSecret(namespace: string, key: string): Promise<void> {
    await this.request<void>(this.url(namespace, key, 'disable'), { method: 'POST' });
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
    return body.data ?? [];
  }
}
