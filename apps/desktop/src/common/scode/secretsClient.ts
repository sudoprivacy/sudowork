import type { SecretMetadata } from '@sudowork/common/secretTypes';
import { getScodeServiceClient, type ScodeServiceClient } from './serviceClient';

export type { SecretMetadata };

export interface VersionMetadata {
  version: number;
  createdAt?: number;
}

/** Frontend adapter for Sudocode's Vault capability. */
export class ScodeSecretsClient {
  constructor(private readonly service: () => ScodeServiceClient = getScodeServiceClient) {}

  putSecret(namespace: string, key: string, value: string, description?: string): Promise<SecretMetadata> {
    return this.service().request('vault.put', { namespace, key, value, description });
  }

  async getSecret(namespace: string, key: string, version?: number): Promise<string> {
    const value = await this.service().request<string | null>('vault.get', { namespace, key, version });
    if (value === null) throw new Error('Secret does not exist');
    return value;
  }

  deleteSecret(namespace: string, key: string): Promise<boolean> {
    return this.service().request('vault.delete', { namespace, key });
  }

  restoreSecret(namespace: string, key: string): Promise<boolean> {
    return this.service().request('vault.restore', { namespace, key });
  }

  listSecrets(namespace?: string, includeDeleted?: boolean): Promise<SecretMetadata[]> {
    return this.service().request('vault.list', { namespace, includeDeleted });
  }

  listVersions(namespace: string, key: string): Promise<VersionMetadata[]> {
    return this.service().request('vault.versions', { namespace, key });
  }

  deleteVersion(namespace: string, key: string, version: number): Promise<boolean> {
    return this.service().request('vault.deleteVersion', { namespace, key, version });
  }

  updateDescription(namespace: string, key: string, description: string): Promise<boolean> {
    return this.service().request('vault.updateDescription', { namespace, key, description });
  }

  batchPut(secrets: Array<{ namespace: string; key: string; value: string; description?: string }>): Promise<SecretMetadata[]> {
    return this.service().request('vault.batchPut', { secrets });
  }

  batchGet(queries: Array<{ namespace: string; key: string; version?: number }>): Promise<Record<string, string>> {
    return this.service().request('vault.batchGet', { queries });
  }
}

const client = new ScodeSecretsClient();

export function getScodeSecretsClient(): ScodeSecretsClient {
  return client;
}

export async function getSecretOrEmpty(namespace: string, key: string): Promise<string> {
  return (await getScodeServiceClient().request<string | null>('vault.get', { namespace, key })) ?? '';
}
