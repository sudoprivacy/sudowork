/**
 * Vault Secrets gRPC Integration Tests
 *
 * Tests the full data path: TypeScript → protobuf encode → napi callBinary
 * → gRPC → vault plugin dispatch → AES-256-GCM encrypt → kernel syscalls.
 *
 * Prerequisites:
 *   1. nexusd-cluster running on localhost:2028 with vault plugin loaded
 *   2. nexus-napi native module built (bun run build:native)
 *
 * When prerequisites are unavailable, all tests skip gracefully — CI green.
 * When available, these tests exercise real multi-step user workflows.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ── Module loading (graceful skip if unavailable) ──────────────────

type NapiModule = typeof import('../../native/nexus-napi');

function loadNapiModule(): NapiModule | null {
  const candidates = [
    path.join(__dirname, '..', '..', 'native', 'nexus-napi', 'nexus-napi.darwin-arm64.node'),
    path.join(__dirname, '..', '..', 'native', 'nexus-napi', 'nexus-napi.darwin-x64.node'),
    path.join(__dirname, '..', '..', 'native', 'nexus-napi', 'index.node'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return require(candidate);
    } catch { /* try next */ }
  }
  return null;
}

async function isNexusAvailable(): Promise<boolean> {
  try {
    const resp = await fetch('http://localhost:2028', { signal: AbortSignal.timeout(2000) });
    return true; // Any response means server is up
  } catch {
    return false;
  }
}

// ── Test suite ─────────────────────────────────────────────────────

describe('Vault Secrets gRPC Integration', () => {
  let NexusSecretClient: typeof import('../../src/common/nexus/nexus-secret-client')['NexusSecretClient'];
  let client: InstanceType<typeof NexusSecretClient>;
  let available = false;

  // Unique test namespace to avoid collision with real data
  const TEST_NS = `__test__:${Date.now()}`;

  beforeAll(async () => {
    const napiModule = loadNapiModule();
    if (!napiModule) {
      console.log('[secrets-grpc] NAPI module not found, tests will skip');
      return;
    }

    const serverUp = await isNexusAvailable();
    if (!serverUp) {
      console.log('[secrets-grpc] nexusd-cluster not running on :2028, tests will skip');
      return;
    }

    // Dynamic import to avoid module-load errors when napi missing
    const mod = await import('../../src/common/nexus/nexus-secret-client');
    NexusSecretClient = mod.NexusSecretClient;

    const grpcClient = new napiModule.NexusGrpcClient('http://localhost:2028');
    client = new NexusSecretClient(grpcClient, '');
    available = true;
  }, 30000);

  afterAll(() => {
    if (!available) return;
    // Cleanup: delete all test secrets
    try {
      const secrets = client.listSecrets(TEST_NS);
      for (const s of secrets) {
        try { client.deleteSecret(s.namespace, s.key); } catch { /* ignore */ }
      }
    } catch { /* ignore cleanup errors */ }
  });

  // ── Scenario 1: Secret Lifecycle ─────────────────────────────────
  // Real workflow: create API key → verify it's stored → update desc → find in list → revoke

  describe('Scenario: Secret Lifecycle (put → get → updateDesc → list → delete)', () => {
    it('should complete full CRUD lifecycle', () => {
      if (!available) return;

      // Step 1: Store a new secret
      const meta = client.putSecret(TEST_NS, 'api_key', 'sk-live-abc123', 'Production API key');
      expect(meta.namespace).toBe(TEST_NS);
      expect(meta.key).toBe('api_key');
      expect(meta.currentVersion).toBe(1);
      expect(meta.deleted).toBe(false);

      // Step 2: Read it back — verify data integrity
      const value = client.getSecret(TEST_NS, 'api_key');
      expect(value).toBe('sk-live-abc123');

      // Step 3: Update description (metadata-only, no new version)
      const descOk = client.updateDescription(TEST_NS, 'api_key', 'Rotated 2026-06-09');
      expect(descOk).toBe(true);

      // Step 4: Find it in list — confirm metadata visible
      const secrets = client.listSecrets(TEST_NS);
      expect(secrets.length).toBeGreaterThanOrEqual(1);
      const found = secrets.find(s => s.key === 'api_key');
      expect(found).toBeDefined();
      expect(found!.currentVersion).toBe(1);

      // Step 5: Soft-delete
      const deleted = client.deleteSecret(TEST_NS, 'api_key');
      expect(deleted).toBe(true);

      // Step 6: Confirm read fails after delete
      expect(() => client.getSecret(TEST_NS, 'api_key')).toThrow();
    });
  });

  // ── Scenario 2: Soft-Delete + Restore ────────────────────────────
  // Real workflow: accidentally delete a credential → restore it → verify data intact

  describe('Scenario: Soft-Delete + Restore', () => {
    it('should restore a deleted secret with data intact', () => {
      if (!available) return;

      // Step 1: Create secret
      client.putSecret(TEST_NS, 'restore_test', 'original-value');

      // Step 2: Soft-delete
      client.deleteSecret(TEST_NS, 'restore_test');

      // Step 3: Restore
      const restored = client.restoreSecret(TEST_NS, 'restore_test');
      expect(restored).toBe(true);

      // Step 4: Read — data should be intact
      const value = client.getSecret(TEST_NS, 'restore_test');
      expect(value).toBe('original-value');

      // Cleanup
      client.deleteSecret(TEST_NS, 'restore_test');
    });
  });

  // ── Scenario 3: Version History ──────────────────────────────────
  // Real workflow: rotate API key multiple times → check history → read old version → prune old

  describe('Scenario: Version History (rotate key → list versions → read old → prune)', () => {
    it('should track version history through key rotation', () => {
      if (!available) return;

      // Step 1: Create initial version
      client.putSecret(TEST_NS, 'rotated_key', 'v1-old-key');

      // Step 2: Rotate — creates version 2
      client.putSecret(TEST_NS, 'rotated_key', 'v2-new-key');

      // Step 3: Latest read returns v2
      const latest = client.getSecret(TEST_NS, 'rotated_key');
      expect(latest).toBe('v2-new-key');

      // Step 4: List versions — should have 2
      const versions = client.listVersions(TEST_NS, 'rotated_key');
      expect(versions.length).toBe(2);

      // Step 5: Read historical v1
      const oldValue = client.getSecret(TEST_NS, 'rotated_key', 1);
      expect(oldValue).toBe('v1-old-key');

      // Step 6: Delete old version (prune)
      const pruned = client.deleteVersion(TEST_NS, 'rotated_key', 1);
      expect(pruned).toBe(true);

      // Step 7: Verify only 1 version remains
      const afterPrune = client.listVersions(TEST_NS, 'rotated_key');
      expect(afterPrune.length).toBe(1);

      // Cleanup
      client.deleteSecret(TEST_NS, 'rotated_key');
    });
  });

  // ── Scenario 4: Batch Migration ──────────────────────────────────
  // Real workflow: sudowork startup migrates all channel credentials in one batch

  describe('Scenario: Batch Migration (batchPut → batchGet → verify)', () => {
    it('should batch-migrate and verify all secrets', () => {
      if (!available) return;

      // Step 1: Batch put — simulating migration of 3 channel credentials
      const batchSecrets = [
        { namespace: TEST_NS, key: 'telegram_token', value: 'tg-token-123' },
        { namespace: TEST_NS, key: 'feishu_secret', value: 'fs-secret-456' },
        { namespace: TEST_NS, key: 'dingtalk_secret', value: 'dt-secret-789' },
      ];
      const putResults = client.batchPut(batchSecrets);
      expect(putResults).toHaveLength(3);

      // Step 2: Batch get — verify all values match
      const queries = batchSecrets.map(s => ({ namespace: s.namespace, key: s.key }));
      const values = client.batchGet(queries);
      expect(values[`${TEST_NS}:telegram_token`]).toBe('tg-token-123');
      expect(values[`${TEST_NS}:feishu_secret`]).toBe('fs-secret-456');
      expect(values[`${TEST_NS}:dingtalk_secret`]).toBe('dt-secret-789');

      // Step 3: List — verify count matches
      const allSecrets = client.listSecrets(TEST_NS);
      const batchKeys = new Set(batchSecrets.map(s => s.key));
      const batchInList = allSecrets.filter(s => batchKeys.has(s.key));
      expect(batchInList.length).toBe(3);

      // Cleanup
      for (const s of batchSecrets) {
        client.deleteSecret(s.namespace, s.key);
      }
    });
  });
});
