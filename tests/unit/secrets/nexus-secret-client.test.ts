import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create, toBinary, fromBinary } from '@bufbuild/protobuf';
import {
  PutSecretResponseSchema,
  GetSecretResponseSchema,
  DeleteSecretResponseSchema,
  RestoreSecretResponseSchema,
  ListSecretsResponseSchema,
  ListSecretVersionsResponseSchema,
  BatchPutSecretsResponseSchema,
  BatchGetSecretsResponseSchema,
  DeleteSecretVersionResponseSchema,
  UpdateSecretDescriptionResponseSchema,
  PutSecretRequestSchema,
  GetSecretRequestSchema,
  DeleteSecretRequestSchema,
  RestoreSecretRequestSchema,
  ListSecretsRequestSchema,
  ListSecretVersionsRequestSchema,
  BatchPutSecretsRequestSchema,
  BatchGetSecretsRequestSchema,
  DeleteSecretVersionRequestSchema,
  UpdateSecretDescriptionRequestSchema,
  SecretMetadataSchema,
} from '../../../src/common/nexus/generated/nexus/secrets/v1/secrets_pb.js';
import type { NexusSecretClient } from '../../../src/common/nexus/nexus-secret-client.js';

// Mock the native binding loader so we never touch electron/napi
vi.mock('../../../src/common/nexus/nexus-secret-client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/common/nexus/nexus-secret-client.js')>();
  // We re-export everything but override the factory to avoid native loading.
  // Tests construct NexusSecretClient directly with a mock GrpcClient.
  return mod;
});

/**
 * Create a mock Nexus instance whose callBinary dispatches to a handler map.
 * The handler receives the raw protobuf bytes and returns raw protobuf response bytes,
 * exactly like the real vault plugin dispatch.
 */
function createMockNexus(handlers: Record<string, (payload: Buffer) => Buffer>) {
  return {
    callBinary: vi.fn((method: string, payload: Buffer): Buffer => {
      const handler = handlers[method];
      if (!handler) throw new Error(`Unknown method: ${method}`);
      return handler(payload);
    }),
  };
}

describe('NexusSecretClient', () => {
  // Dynamically import so the mock above takes effect
  let NexusSecretClientClass: typeof import('../../../src/common/nexus/nexus-secret-client.js')['NexusSecretClient'];

  beforeEach(async () => {
    const mod = await import('../../../src/common/nexus/nexus-secret-client.js');
    NexusSecretClientClass = mod.NexusSecretClient;
  });

  it('putSecret: encodes PutSecretRequest and decodes PutSecretResponse', () => {
    const mockClient = createMockNexus({
      'password-vault.secret_put': (payload) => {
        const req = fromBinary(PutSecretRequestSchema, new Uint8Array(payload));
        expect(req.namespace).toBe('provider:openai');
        expect(req.key).toBe('api_key');
        expect(req.value).toBe('sk-test-123');
        expect(req.description).toBe('OpenAI key');

        const meta = create(SecretMetadataSchema, {
          namespace: 'provider:openai', key: 'api_key', currentVersion: 1, deleted: false,
        });
        const resp = create(PutSecretResponseSchema, { metadata: meta });
        return Buffer.from(toBinary(PutSecretResponseSchema, resp));
      },
    });

    const client = new NexusSecretClientClass(mockClient as any);
    const result = client.putSecret('provider:openai', 'api_key', 'sk-test-123', 'OpenAI key');

    expect(result.namespace).toBe('provider:openai');
    expect(result.key).toBe('api_key');
    expect(result.currentVersion).toBe(1);
    expect(mockClient.callBinary).toHaveBeenCalledTimes(1);
  });

  it('getSecret: encodes GetSecretRequest and returns value string', () => {
    const mockClient = createMockNexus({
      'password-vault.secret_get': (payload) => {
        const req = fromBinary(GetSecretRequestSchema, new Uint8Array(payload));
        expect(req.namespace).toBe('auth:jwt');
        expect(req.key).toBe('webui_secret');

        const resp = create(GetSecretResponseSchema, {
          namespace: 'auth:jwt', key: 'webui_secret', value: 'jwt-secret-value', version: 1,
        });
        return Buffer.from(toBinary(GetSecretResponseSchema, resp));
      },
    });

    const client = new NexusSecretClientClass(mockClient as any);
    const value = client.getSecret('auth:jwt', 'webui_secret');

    expect(value).toBe('jwt-secret-value');
  });

  it('deleteSecret: returns deleted boolean', () => {
    const mockClient = createMockNexus({
      'password-vault.secret_delete': (payload) => {
        const req = fromBinary(DeleteSecretRequestSchema, new Uint8Array(payload));
        expect(req.namespace).toBe('channel:telegram:1');
        expect(req.key).toBe('token');

        const resp = create(DeleteSecretResponseSchema, {
          namespace: 'channel:telegram:1', key: 'token', deleted: true,
        });
        return Buffer.from(toBinary(DeleteSecretResponseSchema, resp));
      },
    });

    const client = new NexusSecretClientClass(mockClient as any);
    expect(client.deleteSecret('channel:telegram:1', 'token')).toBe(true);
  });

  it('restoreSecret: returns restored boolean', () => {
    const mockClient = createMockNexus({
      'password-vault.secret_restore': (payload) => {
        const req = fromBinary(RestoreSecretRequestSchema, new Uint8Array(payload));
        const resp = create(RestoreSecretResponseSchema, {
          namespace: req.namespace, key: req.key, restored: true, currentVersion: 2,
        });
        return Buffer.from(toBinary(RestoreSecretResponseSchema, resp));
      },
    });

    const client = new NexusSecretClientClass(mockClient as any);
    expect(client.restoreSecret('ns', 'k')).toBe(true);
  });

  it('listSecrets: returns array of SecretMetadata', () => {
    const mockClient = createMockNexus({
      'password-vault.secret_list': (payload) => {
        const req = fromBinary(ListSecretsRequestSchema, new Uint8Array(payload));
        expect(req.namespace).toBe('provider:*');

        const resp = create(ListSecretsResponseSchema, {
          secrets: [
            create(SecretMetadataSchema, { namespace: 'provider:openai', key: 'api_key', currentVersion: 1, deleted: false }),
            create(SecretMetadataSchema, { namespace: 'provider:anthropic', key: 'api_key', currentVersion: 3, deleted: false }),
          ],
          count: 2,
        });
        return Buffer.from(toBinary(ListSecretsResponseSchema, resp));
      },
    });

    const client = new NexusSecretClientClass(mockClient as any);
    const secrets = client.listSecrets('provider:*');

    expect(secrets).toHaveLength(2);
    expect(secrets[0].namespace).toBe('provider:openai');
    expect(secrets[1].currentVersion).toBe(3);
  });

  it('listVersions: returns array of VersionMetadata', () => {
    const mockClient = createMockNexus({
      'password-vault.secret_list_versions': (payload) => {
        const req = fromBinary(ListSecretVersionsRequestSchema, new Uint8Array(payload));
        const resp = create(ListSecretVersionsResponseSchema, {
          namespace: req.namespace, key: req.key, count: 2,
          versions: [{ version: 1, tombstoned: false }, { version: 2, tombstoned: false }],
        });
        return Buffer.from(toBinary(ListSecretVersionsResponseSchema, resp));
      },
    });

    const client = new NexusSecretClientClass(mockClient as any);
    const versions = client.listVersions('ns', 'k');
    expect(versions).toHaveLength(2);
    expect(versions[0].version).toBe(1);
  });

  it('batchPut: encodes array of PutSecretRequest', () => {
    const mockClient = createMockNexus({
      'password-vault.secret_batch_put': (payload) => {
        const req = fromBinary(BatchPutSecretsRequestSchema, new Uint8Array(payload));
        expect(req.secrets).toHaveLength(2);

        const resp = create(BatchPutSecretsResponseSchema, {
          results: [
            create(SecretMetadataSchema, { namespace: 'ns', key: 'k1', currentVersion: 1, deleted: false }),
            create(SecretMetadataSchema, { namespace: 'ns', key: 'k2', currentVersion: 1, deleted: false }),
          ],
          count: 2,
        });
        return Buffer.from(toBinary(BatchPutSecretsResponseSchema, resp));
      },
    });

    const client = new NexusSecretClientClass(mockClient as any);
    const results = client.batchPut([
      { namespace: 'ns', key: 'k1', value: 'v1' },
      { namespace: 'ns', key: 'k2', value: 'v2' },
    ]);
    expect(results).toHaveLength(2);
  });

  it('batchGet: returns key→value map', () => {
    const mockClient = createMockNexus({
      'password-vault.secret_batch_get': (payload) => {
        const req = fromBinary(BatchGetSecretsRequestSchema, new Uint8Array(payload));
        expect(req.queries).toHaveLength(2);

        const resp = create(BatchGetSecretsResponseSchema, {
          secrets: { 'ns:k1': 'v1', 'ns:k2': 'v2' },
          count: 2,
        });
        return Buffer.from(toBinary(BatchGetSecretsResponseSchema, resp));
      },
    });

    const client = new NexusSecretClientClass(mockClient as any);
    const map = client.batchGet([
      { namespace: 'ns', key: 'k1' },
      { namespace: 'ns', key: 'k2' },
    ]);
    expect(map['ns:k1']).toBe('v1');
    expect(map['ns:k2']).toBe('v2');
  });

  it('deleteVersion: returns deleted boolean', () => {
    const mockClient = createMockNexus({
      'password-vault.secret_delete_version': (payload) => {
        const req = fromBinary(DeleteSecretVersionRequestSchema, new Uint8Array(payload));
        expect(req.version).toBe(2);

        const resp = create(DeleteSecretVersionResponseSchema, {
          namespace: req.namespace, key: req.key, version: 2, deleted: true,
        });
        return Buffer.from(toBinary(DeleteSecretVersionResponseSchema, resp));
      },
    });

    const client = new NexusSecretClientClass(mockClient as any);
    expect(client.deleteVersion('ns', 'k', 2)).toBe(true);
  });

  it('updateDescription: returns success boolean', () => {
    const mockClient = createMockNexus({
      'password-vault.secret_update_description': (payload) => {
        const req = fromBinary(UpdateSecretDescriptionRequestSchema, new Uint8Array(payload));
        expect(req.description).toBe('new desc');

        const resp = create(UpdateSecretDescriptionResponseSchema, {
          namespace: req.namespace, key: req.key, description: 'new desc',
        });
        return Buffer.from(toBinary(UpdateSecretDescriptionResponseSchema, resp));
      },
    });

    const client = new NexusSecretClientClass(mockClient as any);
    expect(client.updateDescription('ns', 'k', 'new desc')).toBe(true);
  });

  it('dispatch error propagates to caller', () => {
    const mockClient = createMockNexus({
      'password-vault.secret_get': () => { throw new Error('gRPC call failed: NOT_FOUND'); },
    });

    const client = new NexusSecretClientClass(mockClient as any);
    expect(() => client.getSecret('ns', 'missing')).toThrow('gRPC call failed: NOT_FOUND');
  });
});
