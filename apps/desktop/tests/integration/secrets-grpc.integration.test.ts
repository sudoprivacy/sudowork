/**
 * Vault Secrets gRPC Integration Tests
 *
 * Tests the full data path: TypeScript → protobuf encode → callBinary
 * → gRPC → vault plugin dispatch → AES-256-GCM encrypt → kernel syscalls.
 *
 * Prerequisites:
 *   1. nexusd-cluster running on localhost:2028 with vault plugin loaded
 *
 * Run with: NEXUS_E2E=1 bunx vitest run tests/integration/secrets-grpc.integration.test.ts
 * Without NEXUS_E2E, all tests are explicitly skipped (visible in output).
 */

import net from 'net';
import { NexusVfsClient } from '@nexus-ai-fs/vfs-client';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

async function isNexusAvailable(): Promise<boolean> {
  // nexusd-cluster is an HTTP/2 gRPC server. Node's built-in `fetch` (HTTP/1.1
  // via undici) sees the HTTP/2 SETTINGS frame and errors out on the protocol
  // mismatch even when the server is up, so a fetch-based liveness probe is a
  // false negative against gRPC. Use a plain TCP connect — gRPC requires HTTP/2
  // anyway, so a successful TCP handshake on the gRPC port is all we need
  // before the client opens its own channel.
  return await new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: 2028 });
    const done = (ok: boolean) => {
      try {
        socket.destroy();
      } catch {
        /* swallow */
      }
      resolve(ok);
    };
    socket.setTimeout(2000);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

// ── Test suite ─────────────────────────────────────────────────────

const SKIP_REASON = !process.env.NEXUS_E2E ? 'NEXUS_E2E not set — set NEXUS_E2E=1 with nexusd-cluster running to run' : '';

describe.skipIf(!process.env.NEXUS_E2E)('Vault Secrets gRPC Integration', () => {
  let NexusSecretClient: (typeof import('../../src/common/nexus/nexus-secret-client'))['NexusSecretClient'];
  let client: InstanceType<typeof NexusSecretClient>;

  // Unique test namespace to avoid collision with real data
  const TEST_NS = `__test__:${Date.now()}`;

  beforeAll(async () => {
    const serverUp = await isNexusAvailable();
    if (!serverUp) {
      throw new Error('nexusd-cluster not running on :2028 — start with vault plugin loaded');
    }

    const mod = await import('../../src/common/nexus/nexus-secret-client');
    NexusSecretClient = mod.NexusSecretClient;

    // Drive the client directly rather than the high-level `Nexus` wrapper:
    // this test runs under plain Node, and a minimal `{ callBinary }` adapter
    // is all NexusSecretClient needs. It carries the empty auth token through.
    const rawClient = new NexusVfsClient('http://localhost:2028');
    const nexusAdapter = {
      callBinary: (method: string, payload: Buffer): Promise<Buffer> => rawClient.callBinary(method, payload, ''),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client = new NexusSecretClient(nexusAdapter as any);
  }, 30000);

  afterAll(async () => {
    try {
      const secrets = await client.listSecrets(TEST_NS);
      for (const s of secrets) {
        try {
          await client.deleteSecret(s.namespace, s.key);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore cleanup errors */
    }
  });

  // ── Scenario 1: Secret Lifecycle ─────────────────────────────────

  describe('Scenario: Secret Lifecycle (put → get → updateDesc → list → delete)', () => {
    it('should complete full CRUD lifecycle', async () => {
      // Step 1: Store a new secret
      const meta = await client.putSecret(TEST_NS, 'api_key', 'sk-live-abc123', 'Production API key');
      expect(meta.namespace).toBe(TEST_NS);
      expect(meta.key).toBe('api_key');
      expect(meta.currentVersion).toBe(1);
      expect(meta.deleted).toBe(false);

      // Step 2: Read it back — verify data integrity
      const value = await client.getSecret(TEST_NS, 'api_key');
      expect(value).toBe('sk-live-abc123');

      // Step 3: Update description (metadata-only, no new version)
      const descOk = await client.updateDescription(TEST_NS, 'api_key', 'Rotated 2026-06-09');
      expect(descOk).toBe(true);

      // Step 4: Find it in list — confirm metadata visible
      const secrets = await client.listSecrets(TEST_NS);
      expect(secrets.length).toBeGreaterThanOrEqual(1);
      const found = secrets.find((s) => s.key === 'api_key');
      expect(found).toBeDefined();
      expect(found!.currentVersion).toBe(1);

      // Step 5: Soft-delete
      const deleted = await client.deleteSecret(TEST_NS, 'api_key');
      expect(deleted).toBe(true);

      // Step 6: Confirm read fails after delete
      await expect(client.getSecret(TEST_NS, 'api_key')).rejects.toThrow();
    });
  });

  // ── Scenario 2: Soft-Delete + Restore ────────────────────────────

  describe('Scenario: Soft-Delete + Restore', () => {
    it('should restore a deleted secret with data intact', async () => {
      await client.putSecret(TEST_NS, 'restore_test', 'original-value');
      await client.deleteSecret(TEST_NS, 'restore_test');

      const restored = await client.restoreSecret(TEST_NS, 'restore_test');
      expect(restored).toBe(true);

      const value = await client.getSecret(TEST_NS, 'restore_test');
      expect(value).toBe('original-value');

      await client.deleteSecret(TEST_NS, 'restore_test');
    });
  });

  // ── Scenario 3: Version History ──────────────────────────────────

  describe('Scenario: Version History (rotate key → list versions → read old → prune)', () => {
    it('should track version history through key rotation', async () => {
      await client.putSecret(TEST_NS, 'rotated_key', 'v1-old-key');
      await client.putSecret(TEST_NS, 'rotated_key', 'v2-new-key');

      const latest = await client.getSecret(TEST_NS, 'rotated_key');
      expect(latest).toBe('v2-new-key');

      const versions = await client.listVersions(TEST_NS, 'rotated_key');
      expect(versions.length).toBe(2);

      const oldValue = await client.getSecret(TEST_NS, 'rotated_key', 1);
      expect(oldValue).toBe('v1-old-key');

      const pruned = await client.deleteVersion(TEST_NS, 'rotated_key', 1);
      expect(pruned).toBe(true);

      const afterPrune = await client.listVersions(TEST_NS, 'rotated_key');
      expect(afterPrune.length).toBe(1);

      await client.deleteSecret(TEST_NS, 'rotated_key');
    });
  });

  // ── Scenario 4: Batch Migration ──────────────────────────────────

  describe('Scenario: Batch Migration (batchPut → batchGet → verify)', () => {
    it('should batch-migrate and verify all secrets', async () => {
      const batchSecrets = [
        { namespace: TEST_NS, key: 'telegram_token', value: 'tg-token-123' },
        { namespace: TEST_NS, key: 'feishu_secret', value: 'fs-secret-456' },
        { namespace: TEST_NS, key: 'dingtalk_secret', value: 'dt-secret-789' },
      ];
      const putResults = await client.batchPut(batchSecrets);
      expect(putResults).toHaveLength(3);

      const queries = batchSecrets.map((s) => ({ namespace: s.namespace, key: s.key }));
      const values = await client.batchGet(queries);
      expect(values[`${TEST_NS}:telegram_token`]).toBe('tg-token-123');
      expect(values[`${TEST_NS}:feishu_secret`]).toBe('fs-secret-456');
      expect(values[`${TEST_NS}:dingtalk_secret`]).toBe('dt-secret-789');

      const allSecrets = await client.listSecrets(TEST_NS);
      const batchKeys = new Set(batchSecrets.map((s) => s.key));
      const batchInList = allSecrets.filter((s) => batchKeys.has(s.key));
      expect(batchInList.length).toBe(3);

      for (const s of batchSecrets) {
        await client.deleteSecret(s.namespace, s.key);
      }
    });
  });
});
