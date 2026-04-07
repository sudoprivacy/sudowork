/**
 * Secret Store Client - HTTP client for Nexus Secrets API.
 *
 * Provides typed interface to the Nexus /api/v2/secrets endpoints.
 */

import { FetchClient } from './fetch-client.js';

export interface SecretMetadata {
  id: string;
  namespace: string;
  key: string;
  description?: string;
  enabled: boolean;
  currentVersion: number;
  deletedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface VersionMetadata {
  version: number;
  createdAt: number;
}

export interface PutSecretRequest {
  namespace: string;
  key: string;
  value: string;
  description?: string;
}

export interface GetSecretRequest {
  namespace: string;
  key: string;
  version?: number;
}

export interface SecretStoreClientOptions {
  apiKey?: string;
  baseUrl?: string;
  subject?: string;
  agentId?: string;
  zoneId?: string;
}

export class SecretStoreClient {
  private readonly client: FetchClient;

  constructor(options: SecretStoreClientOptions) {
    const resolvedBaseUrl = options.baseUrl ?? 'http://localhost:12012';
    console.log('[SecretStoreClient] Created with baseUrl:', resolvedBaseUrl, 'apiKey length:', options.apiKey?.length ?? 0);
    this.client = new FetchClient({
      apiKey: options.apiKey ?? '',
      baseUrl: resolvedBaseUrl,
      subject: options.subject,
      agentId: options.agentId,
      zoneId: options.zoneId,
    });
  }

  async putSecret(
    namespace: string,
    key: string,
    value: string,
    description?: string,
  ): Promise<SecretMetadata> {
    return this.client.put<SecretMetadata>(`/api/v2/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`, {
      value,
      description,
    });
  }

  async getSecret(namespace: string, key: string, version?: number): Promise<string> {
    const params = version !== undefined ? `?version=${version}` : '';
    const result = await this.client.get<{ namespace: string; key: string; value: string; version?: number }>(
      `/api/v2/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}${params}`,
    );
    return result.value;
  }

  async deleteSecret(namespace: string, key: string): Promise<boolean> {
    const result = await this.client.delete<{ namespace: string; key: string; deleted: boolean }>(
      `/api/v2/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`,
    );
    return result.deleted;
  }

  async restoreSecret(namespace: string, key: string): Promise<boolean> {
    const result = await this.client.post<{ namespace: string; key: string; restored: boolean }>(
      `/api/v2/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}/restore`,
      undefined,
    );
    return result.restored;
  }

  async enableSecret(namespace: string, key: string): Promise<boolean> {
    const result = await this.client.put<{ namespace: string; key: string; enabled: boolean }>(
      `/api/v2/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}/enable`,
      undefined,
    );
    return result.enabled;
  }

  async disableSecret(namespace: string, key: string): Promise<boolean> {
    const result = await this.client.put<{ namespace: string; key: string; enabled: boolean }>(
      `/api/v2/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}/disable`,
      undefined,
    );
    return !result.enabled;
  }

  async listSecrets(namespace?: string, includeDeleted?: boolean): Promise<SecretMetadata[]> {
    const params = new URLSearchParams();
    if (namespace) params.set('namespace', namespace);
    if (includeDeleted) params.set('include_deleted', 'true');
    const qs = params.toString() ? `?${params.toString()}` : '';
    const result = await this.client.get<{ secrets: SecretMetadata[]; count: number }>(`/api/v2/secrets${qs}`);
    return result.secrets;
  }

  async listVersions(namespace: string, key: string): Promise<VersionMetadata[]> {
    const result = await this.client.get<{ namespace: string; key: string; versions: VersionMetadata[]; count: number }>(
      `/api/v2/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}/versions`,
    );
    return result.versions;
  }

  async deleteVersion(namespace: string, key: string, version: number): Promise<boolean> {
    const result = await this.client.delete<{ namespace: string; key: string; version: number; deleted: boolean }>(
      `/api/v2/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}/versions/${version}`,
    );
    return result.deleted;
  }

  async updateDescription(namespace: string, key: string, description: string): Promise<boolean> {
    const result = await this.client.put<{ namespace: string; key: string; description: string }>(
      `/api/v2/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}/description`,
      { description },
    );
    return result.description === description;
  }

  async batchPut(secrets: PutSecretRequest[]): Promise<SecretMetadata[]> {
    const result = await this.client.post<{ secrets: SecretMetadata[]; count: number }>('/api/v2/secrets/batch', secrets);
    return result.secrets;
  }

  async batchGet(queries: GetSecretRequest[]): Promise<Record<string, string>> {
    const result = await this.client.post<{ secrets: Record<string, string>; count: number }>('/api/v2/secrets/batch/get', queries);
    return result.secrets;
  }
}
