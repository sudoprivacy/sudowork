/**
 * Nexus Secret Client — gRPC protobuf client for vault secrets.
 *
 * Replaces SecretStoreClient (HTTP /api/v2/secrets) with direct gRPC
 * plugin dispatch via NexusGrpcClient.callBinary(). Wire format is
 * protobuf (nexus.secrets.v1), decoded with @bufbuild/protobuf.
 */

import { create, toBinary, fromBinary } from '@bufbuild/protobuf';
import {
  PutSecretRequestSchema,
  PutSecretResponseSchema,
  GetSecretRequestSchema,
  GetSecretResponseSchema,
  DeleteSecretRequestSchema,
  DeleteSecretResponseSchema,
  RestoreSecretRequestSchema,
  RestoreSecretResponseSchema,
  ListSecretsRequestSchema,
  ListSecretsResponseSchema,
  ListSecretVersionsRequestSchema,
  ListSecretVersionsResponseSchema,
  BatchPutSecretsRequestSchema,
  BatchPutSecretsResponseSchema,
  BatchGetSecretsRequestSchema,
  BatchGetSecretsResponseSchema,
  DeleteSecretVersionRequestSchema,
  DeleteSecretVersionResponseSchema,
  UpdateSecretDescriptionRequestSchema,
  UpdateSecretDescriptionResponseSchema,
} from './generated/nexus/secrets/v1/secrets_pb.js';
import type {
  SecretMetadata as ProtoSecretMetadata,
  SecretVersion,
} from './generated/nexus/secrets/v1/secrets_pb.js';

// Re-export compatible types for callers
export interface SecretMetadata {
  namespace: string;
  key: string;
  description?: string;
  currentVersion: number;
  deleted: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface VersionMetadata {
  version: number;
  createdAt?: number;
}

function toSecretMetadata(proto: ProtoSecretMetadata): SecretMetadata {
  return {
    namespace: proto.namespace,
    key: proto.key,
    description: proto.description ?? undefined,
    currentVersion: proto.currentVersion,
    deleted: proto.deleted,
    createdAt: proto.createdAt ? Number(proto.createdAt.seconds) * 1000 + proto.createdAt.nanos / 1_000_000 : undefined,
    updatedAt: proto.updatedAt ? Number(proto.updatedAt.seconds) * 1000 + proto.updatedAt.nanos / 1_000_000 : undefined,
  };
}

function toVersionMetadata(proto: SecretVersion): VersionMetadata {
  return {
    version: proto.version,
    createdAt: proto.createdAt ? Number(proto.createdAt.seconds) * 1000 + proto.createdAt.nanos / 1_000_000 : undefined,
  };
}

// Lazy-load the native addon (same pattern as nexus-vfs-client.ts).
function loadNativeBinding(): typeof import('../../../native/nexus-napi') {
  try {
    const { app } = require('electron');
    const path = require('path');
    const appRoot = app.isPackaged
      ? app.getAppPath().replace('app.asar', 'app.asar.unpacked')
      : app.getAppPath();
    return require(path.join(appRoot, 'native', 'nexus-napi'));
  } catch {
    throw new Error('nexus-napi native module not available. Run `bun run build:native` first.');
  }
}

type GrpcClient = InstanceType<ReturnType<typeof loadNativeBinding>['NexusGrpcClient']>;

export class NexusSecretClient {
  private readonly client: GrpcClient;
  private readonly authToken: string;

  constructor(client: GrpcClient, authToken: string) {
    this.client = client;
    this.authToken = authToken;
  }

  private dispatch(method: string, payload: Uint8Array): Buffer {
    return this.client.callBinary(`password-vault.${method}`, Buffer.from(payload), this.authToken);
  }

  putSecret(namespace: string, key: string, value: string, description?: string): SecretMetadata {
    const req = create(PutSecretRequestSchema, { namespace, key, value, description });
    const resp = fromBinary(PutSecretResponseSchema, new Uint8Array(this.dispatch('secret_put', toBinary(PutSecretRequestSchema, req))));
    return toSecretMetadata(resp.metadata!);
  }

  getSecret(namespace: string, key: string, version?: number): string {
    const req = create(GetSecretRequestSchema, { namespace, key, version });
    const resp = fromBinary(GetSecretResponseSchema, new Uint8Array(this.dispatch('secret_get', toBinary(GetSecretRequestSchema, req))));
    return resp.value;
  }

  deleteSecret(namespace: string, key: string): boolean {
    const req = create(DeleteSecretRequestSchema, { namespace, key });
    const resp = fromBinary(DeleteSecretResponseSchema, new Uint8Array(this.dispatch('secret_delete', toBinary(DeleteSecretRequestSchema, req))));
    return resp.deleted;
  }

  restoreSecret(namespace: string, key: string): boolean {
    const req = create(RestoreSecretRequestSchema, { namespace, key });
    const resp = fromBinary(RestoreSecretResponseSchema, new Uint8Array(this.dispatch('secret_restore', toBinary(RestoreSecretRequestSchema, req))));
    return resp.restored;
  }

  listSecrets(namespace?: string, includeDeleted?: boolean): SecretMetadata[] {
    const req = create(ListSecretsRequestSchema, { namespace, includeDeleted: includeDeleted ?? false });
    const resp = fromBinary(ListSecretsResponseSchema, new Uint8Array(this.dispatch('secret_list', toBinary(ListSecretsRequestSchema, req))));
    return resp.secrets.map(toSecretMetadata);
  }

  listVersions(namespace: string, key: string): VersionMetadata[] {
    const req = create(ListSecretVersionsRequestSchema, { namespace, key });
    const resp = fromBinary(ListSecretVersionsResponseSchema, new Uint8Array(this.dispatch('secret_list_versions', toBinary(ListSecretVersionsRequestSchema, req))));
    return resp.versions.map(toVersionMetadata);
  }

  deleteVersion(namespace: string, key: string, version: number): boolean {
    const req = create(DeleteSecretVersionRequestSchema, { namespace, key, version });
    const resp = fromBinary(DeleteSecretVersionResponseSchema, new Uint8Array(this.dispatch('secret_delete_version', toBinary(DeleteSecretVersionRequestSchema, req))));
    return resp.deleted;
  }

  updateDescription(namespace: string, key: string, description: string): boolean {
    const req = create(UpdateSecretDescriptionRequestSchema, { namespace, key, description });
    const resp = fromBinary(UpdateSecretDescriptionResponseSchema, new Uint8Array(this.dispatch('secret_update_description', toBinary(UpdateSecretDescriptionRequestSchema, req))));
    return resp.description === description;
  }

  batchPut(secrets: Array<{ namespace: string; key: string; value: string; description?: string }>): SecretMetadata[] {
    const items = secrets.map(s => create(PutSecretRequestSchema, s));
    const req = create(BatchPutSecretsRequestSchema, { secrets: items });
    const resp = fromBinary(BatchPutSecretsResponseSchema, new Uint8Array(this.dispatch('secret_batch_put', toBinary(BatchPutSecretsRequestSchema, req))));
    return resp.results.map(toSecretMetadata);
  }

  batchGet(queries: Array<{ namespace: string; key: string; version?: number }>): Record<string, string> {
    const items = queries.map(q => create(GetSecretRequestSchema, q));
    const req = create(BatchGetSecretsRequestSchema, { queries: items });
    const resp = fromBinary(BatchGetSecretsResponseSchema, new Uint8Array(this.dispatch('secret_batch_get', toBinary(BatchGetSecretsRequestSchema, req))));
    return { ...resp.secrets };
  }
}

// ── Singleton ────────────────────────────────────────────────────────

let instance: NexusSecretClient | null = null;

export function getNexusSecretClient(): NexusSecretClient {
  if (!instance) {
    const { NexusGrpcClient } = loadNativeBinding();
    const client = new NexusGrpcClient('http://localhost:12022');
    instance = new NexusSecretClient(client, '');
  }
  return instance;
}
