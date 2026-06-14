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
 * Run with: NEXUS_E2E=1 bunx vitest run tests/integration/secrets-grpc.integration.test.ts
 * Without NEXUS_E2E, all tests are explicitly skipped (visible in output).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ── Module loading ───────────────────────────────────────────────────

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
  // nexusd-cluster is an HTTP/2 gRPC server. Node's built-in `fetch` (HTTP/1.1
  // via undici) sees the HTTP/2 SETTINGS frame and errors out on the protocol
  // mismatch even when the server is up, so a fetch-based liveness probe is a
  // false negative against gRPC. Use a plain TCP connect — gRPC requires HTTP/2
  // anyway, so a successful TCP handshake on the gRPC port is all we need
  // before the napi client opens its own channel.
  return await new Promise<boolean>((resolve) => {
    const net = require('net') as typeof import('net');
    const socket = net.connect({ host: '127.0.0.1', port: 2028 });
    const done = (ok: boolean) => {
      try { socket.destroy(); } catch { /* swallow */ }
      resolve(ok);
    };
    socket.setTimeout(2000);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

// ── Test suite ─────────────────────────────────────────────────────

const SKIP_REASON = !process.env.NEXUS_E2E
  ? 'NEXUS_E2E not set — set NEXUS_E2E=1 with nexusd-cluster + napi module to run'
  : '';

describe.skipIf(!process.env.NEXUS_E2E)('Vault Secrets gRPC Integration', () => {
  let NexusSecretClient: typeof import('../../src/common/nexus/nexus-secret-client')['NexusSecretClient'];
  let client: InstanceType<typeof NexusSecretClient>;

  // Unique test namespace to avoid collision with real data
  const TEST_NS = `__test__:${Date.now()}`;

  beforeAll(async () => {
    const napiModule = loadNapiModule();
    if (!napiModule) {
      throw new Error('NAPI module not found — build with: bun run build:native');
    }

    const serverUp = await isNexusAvailable();
    if (!serverUp) {
      throw new Error('nexusd-cluster not running on :2028 — start with vault plugin loaded');
    }

    const mod = await import('../../src/common/nexus/nexus-secret-client');
    NexusSecretClient = mod.NexusSecretClient;

    // We can't use the high-level `Nexus` wrapper here because its
    // `loadNativeBinding` reaches into `require('electron').app.getAppPath()`
    // — vitest runs under plain Node, no Electron, so that path is empty
    // and the napi module never loads. Instead, drive the raw napi client
    // and wrap it in a minimal `{ callBinary }` adapter that carries the
    // empty auth token through (the napi binding requires three args).
    const rawClient = new napiModule.NexusGrpcClient('http://localhost:2028');
    const nexusAdapter = {
      callBinary: (method: string, payload: Buffer): Buffer =>
        rawClient.callBinary(method, payload, ''),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client = new NexusSecretClient(nexusAdapter as any);
  }, 30000);

  afterAll(() => {
    try {
      const secrets = client.listSecrets(TEST_NS);
      for (const s of secrets) {
        try { client.deleteSecret(s.namespace, s.key); } catch { /* ignore */ }
      }
    } catch { /* ignore cleanup errors */ }
  });

  // ── Scenario 1: Secret Lifecycle ─────────────────────────────────

  describe('Scenario: Secret Lifecycle (put → get → updateDesc → list → delete)', () => {
    it('should complete full CRUD lifecycle', () => {
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

  describe('Scenario: Soft-Delete + Restore', () => {
    it('should restore a deleted secret with data intact', () => {
      client.putSecret(TEST_NS, 'restore_test', 'original-value');
      client.deleteSecret(TEST_NS, 'restore_test');

      const restored = client.restoreSecret(TEST_NS, 'restore_test');
      expect(restored).toBe(true);

      const value = client.getSecret(TEST_NS, 'restore_test');
      expect(value).toBe('original-value');

      client.deleteSecret(TEST_NS, 'restore_test');
    });
  });

  // ── Scenario 3: Version History ──────────────────────────────────

  describe('Scenario: Version History (rotate key → list versions → read old → prune)', () => {
    it('should track version history through key rotation', () => {
      client.putSecret(TEST_NS, 'rotated_key', 'v1-old-key');
      client.putSecret(TEST_NS, 'rotated_key', 'v2-new-key');

      const latest = client.getSecret(TEST_NS, 'rotated_key');
      expect(latest).toBe('v2-new-key');

      const versions = client.listVersions(TEST_NS, 'rotated_key');
      expect(versions.length).toBe(2);

      const oldValue = client.getSecret(TEST_NS, 'rotated_key', 1);
      expect(oldValue).toBe('v1-old-key');

      const pruned = client.deleteVersion(TEST_NS, 'rotated_key', 1);
      expect(pruned).toBe(true);

      const afterPrune = client.listVersions(TEST_NS, 'rotated_key');
      expect(afterPrune.length).toBe(1);

      client.deleteSecret(TEST_NS, 'rotated_key');
    });
  });

  // ── Scenario 4: Batch Migration ──────────────────────────────────

  describe('Scenario: Batch Migration (batchPut → batchGet → verify)', () => {
    it('should batch-migrate and verify all secrets', () => {
      const batchSecrets = [
        { namespace: TEST_NS, key: 'telegram_token', value: 'tg-token-123' },
        { namespace: TEST_NS, key: 'feishu_secret', value: 'fs-secret-456' },
        { namespace: TEST_NS, key: 'dingtalk_secret', value: 'dt-secret-789' },
      ];
      const putResults = client.batchPut(batchSecrets);
      expect(putResults).toHaveLength(3);

      const queries = batchSecrets.map(s => ({ namespace: s.namespace, key: s.key }));
      const values = client.batchGet(queries);
      expect(values[`${TEST_NS}:telegram_token`]).toBe('tg-token-123');
      expect(values[`${TEST_NS}:feishu_secret`]).toBe('fs-secret-456');
      expect(values[`${TEST_NS}:dingtalk_secret`]).toBe('dt-secret-789');

      const allSecrets = client.listSecrets(TEST_NS);
      const batchKeys = new Set(batchSecrets.map(s => s.key));
      const batchInList = allSecrets.filter(s => batchKeys.has(s.key));
      expect(batchInList.length).toBe(3);

      for (const s of batchSecrets) {
        client.deleteSecret(s.namespace, s.key);
      }
    });
  });
});
