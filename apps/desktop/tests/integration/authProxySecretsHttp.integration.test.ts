/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end test of the SKILL path that user 进二 hit on v0.2.7:
 *
 *   skill subprocess
 *     → fetch SUDOWORK_AUTH_PROXY_BASE_URL/secrets/...
 *     → AuthProxyServer HTTP listen on 127.0.0.1
 *     → token validation
 *     → handleSecretsRequest dispatch
 *     → NexusSecretClient (mocked in-memory)
 *
 * Boots a real AuthProxyServer in-process, registers a test token via
 * the real `registerToken` API, then drives real HTTP `fetch` calls
 * against it. Cluster + vault dylib are mocked (covered separately by
 * `tests/integration/secrets-grpc.integration.test.ts`); this test
 * focuses on what those don't cover: HTTP transport + token auth +
 * server routing + the full skill-style request shape.
 *
 * Together with Gap 1 (resilient unit) + Gap 2 (handler integration)
 * + secrets-grpc (real cluster), this triangulates: skill HTTP →
 * authProxy → handler → resilient wrapper → real cluster. Every layer
 * has at least one test that exercises it.
 *
 * Runs in pr-integration-smoke (needs spawn + http). NOT in the cheap
 * pr-checks unit test job.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── In-memory persisting secret store (mirrors Gap 2 mock pattern) ─

interface StoredSecret {
  namespace: string;
  key: string;
  value: string;
  description?: string;
  version: number;
  deleted: boolean;
}

let store: Map<string, StoredSecret>;

function storeKey(namespace: string, key: string): string {
  return `${namespace}/${key}`;
}

function toMetadata(s: StoredSecret) {
  return { namespace: s.namespace, key: s.key, description: s.description, currentVersion: s.version, deleted: s.deleted, createdAt: Date.now(), updatedAt: Date.now() };
}

const mockClient = {
  putSecret: vi.fn((namespace: string, key: string, value: string, description?: string) => {
    const k = storeKey(namespace, key);
    const existing = store.get(k);
    const stored: StoredSecret = { namespace, key, value, description: description ?? existing?.description, version: (existing?.version ?? 0) + 1, deleted: false };
    store.set(k, stored);
    return toMetadata(stored);
  }),
  batchPut: vi.fn((items: Array<{ namespace: string; key: string; value: string; description?: string }>) => {
    return items.map((i) => mockClient.putSecret(i.namespace, i.key, i.value, i.description));
  }),
  getSecret: vi.fn((namespace: string, key: string) => {
    const s = store.get(storeKey(namespace, key));
    if (!s || s.deleted) throw new Error(`Not found: ${namespace}/${key}`);
    return s.value;
  }),
  batchGet: vi.fn(),
  deleteSecret: vi.fn((namespace: string, key: string) => {
    const k = storeKey(namespace, key);
    const existing = store.get(k);
    if (!existing) return false;
    store.set(k, { ...existing, deleted: true });
    return true;
  }),
  restoreSecret: vi.fn((namespace: string, key: string) => {
    const k = storeKey(namespace, key);
    const existing = store.get(k);
    if (!existing) throw new Error('Secret not found or not deleted');
    store.set(k, { ...existing, deleted: false });
    return true;
  }),
  listSecrets: vi.fn((namespace?: string, includeDeleted = false) => {
    return [...store.values()].filter((s) => (!namespace || s.namespace === namespace) && (includeDeleted || !s.deleted)).map(toMetadata);
  }),
};

// ─── Mock the heavy infra the handler imports ───────────────────────

vi.mock('@common/nexus/nexus-secret-client', () => ({
  getNexusSecretClient: () => mockClient,
}));
vi.mock('@common/nexus/nexus-secret-resilient', async () => {
  const { putSecretResilient } = await import('../../src/common/nexus/nexus-secret-resilient');
  return { putSecretResilient };
});
vi.mock('@common/nexus/secret-cache', () => ({
  cachePut: vi.fn(),
  cacheDelete: vi.fn(),
  resolveSecret: vi.fn(async () => null),
}));
vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));
vi.mock('@/process/initStorage', () => ({
  ProcessConfig: {
    getSync: vi.fn(() => ({})),
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
  },
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    authProxy: {
      enabledStateChanged: { emit: vi.fn() },
    },
  },
}));
vi.mock('../../src/process/services/authProxy/configItemsLoader', () => ({
  findConfigItemByNamespace: vi.fn(() => null),
  buildRuleFromRawItem: vi.fn(),
  addRuleToCache: vi.fn(),
  removeRuleFromCache: vi.fn(),
  findRuleForUrl: vi.fn(() => null),
  getRules: vi.fn(() => []),
}));
// auto-login pwd_login route — not exercised here, but imported by AuthProxyServer.
vi.mock('../../src/process/services/authProxy/pwdLoginApi', () => ({
  handlePwdLoginRequest: vi.fn(async (_req, res) => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not in test"}');
  }),
}));
vi.mock('../../src/process/services/authProxy/ssrfGuard', () => ({
  validateRemoteUrl: vi.fn(async () => ({ valid: true })),
}));

// ─── Test fixtures ──────────────────────────────────────────────────

let serverInstance: import('../../src/process/services/authProxy/AuthProxyServer').AuthProxyServer;
let port: number;
const TEST_TOKEN = 'test-token-abc123';

beforeAll(async () => {
  // Use real AuthProxyServer to drive REAL HTTP + token auth + routing.
  // Pass a no-op minimatch — not exercised by /secrets routes.
  const { AuthProxyServer } = await import('../../src/process/services/authProxy/AuthProxyServer');
  serverInstance = new AuthProxyServer(() => false);
  port = await serverInstance.start();
  serverInstance.registerToken(TEST_TOKEN, process.pid);
});

afterAll(async () => {
  await serverInstance.stop();
});

beforeEach(() => {
  store = new Map();
  vi.clearAllMocks();
});

// ─── Skill-style fetch helper ──────────────────────────────────────

interface SkillResponse {
  status: number;
  body: { success: boolean; data?: unknown; msg?: string; error?: string };
}

async function skillFetch(method: string, path: string, body?: unknown, opts?: { token?: string }): Promise<SkillResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${opts?.token ?? TEST_TOKEN}`,
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

// ─── Real user journeys (HTTP-level, the actual skill path) ─────────

describe('AuthProxy /secrets HTTP — full skill round-trip', () => {
  it('Journey: skill saves API key → GETs list → sees it', async () => {
    // Real fetch, real HTTP, real AuthProxyServer routing, real token auth
    const put = await skillFetch('PUT', '/secrets/service:shareone/api_key', { value: 'sk-prod-xyz', description: 'ShareOne live' });
    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);
    expect((put.body.data as { key: string }).key).toBe('api_key');

    const list = await skillFetch('GET', '/secrets?namespace=service:shareone');
    expect(list.status).toBe(200);
    const entries = list.body.data as Array<{ namespace: string; key: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ namespace: 'service:shareone', key: 'api_key' });
  });

  it('Journey: skill rotates API key (second PUT bumps version, single entry)', async () => {
    await skillFetch('PUT', '/secrets/ns/k', { value: 'v1' });
    const rotate = await skillFetch('PUT', '/secrets/ns/k', { value: 'v2' });
    expect(rotate.status).toBe(200);
    expect((rotate.body.data as { currentVersion: number }).currentVersion).toBe(2);

    const list = await skillFetch('GET', '/secrets?namespace=ns');
    expect((list.body.data as unknown[]).length).toBe(1);
  });

  it('Journey: skill DELETEs key → list no longer shows it', async () => {
    await skillFetch('PUT', '/secrets/ns/k', { value: 'v' });
    const del = await skillFetch('DELETE', '/secrets/ns/k');
    expect(del.status).toBe(200);

    const list = await skillFetch('GET', '/secrets?namespace=ns');
    expect((list.body.data as unknown[]).length).toBe(0);
  });
});

// ─── Token auth (the HTTP-layer protection unit tests can't reach) ──

describe('AuthProxy /secrets HTTP — token authentication', () => {
  it('rejects request with no Authorization header → 401', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/secrets/ns/k`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"value":"v"}' });
    expect(res.status).toBe(401);
  });

  it('rejects request with unregistered token → 401', async () => {
    const res = await skillFetch('PUT', '/secrets/ns/k', { value: 'v' }, { token: 'fake-token' });
    expect(res.status).toBe(401);
  });

  it('accepts request with a registered token → 200', async () => {
    const fresh = 'fresh-token-xyz';
    serverInstance.registerToken(fresh, process.pid);
    const res = await skillFetch('PUT', '/secrets/ns/k', { value: 'v' }, { token: fresh });
    expect(res.status).toBe(200);
    serverInstance.revokeToken(fresh);
  });

  it('rejects after revokeToken even if previously valid → 401', async () => {
    const revoked = 'revoked-token';
    serverInstance.registerToken(revoked, process.pid);
    serverInstance.revokeToken(revoked);
    const res = await skillFetch('PUT', '/secrets/ns/k', { value: 'v' }, { token: revoked });
    expect(res.status).toBe(401);
  });

  it('health check is unauthenticated → 200 with no token', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });
});

// ─── HTTP-layer body / contract correctness ─────────────────────────

describe('AuthProxy /secrets HTTP — request body + response shape', () => {
  it('PUT with empty body → 400 (skill should never send this)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/secrets/ns/k`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TEST_TOKEN}` } });
    expect(res.status).toBe(400);
  });

  it('GET /secrets returns JSON array under data', async () => {
    await skillFetch('PUT', '/secrets/ns/k1', { value: 'v1' });
    await skillFetch('PUT', '/secrets/ns/k2', { value: 'v2' });
    const list = await skillFetch('GET', '/secrets?namespace=ns');
    expect(Array.isArray(list.body.data)).toBe(true);
    expect((list.body.data as unknown[]).length).toBe(2);
  });
});

// ─── The 进二 bug class — full HTTP round-trip with vault method-missing ─

describe('AuthProxy /secrets HTTP — vault method-missing resilience', () => {
  it('skill PUT returns 200 even when single-secret dispatch is missing (batch fallback)', async () => {
    // Simulate the v0.2.7 / future-regression scenario: vault dylib
    // missing secret_put. Without resilience, skill sees 500 →
    // discards the API key → falls back to credits → 进二's exact
    // bug.
    mockClient.putSecret.mockImplementationOnce(() => {
      throw new Error('method not found');
    });
    mockClient.batchPut.mockReturnValueOnce([{ namespace: 'ns', key: 'k', currentVersion: 1, deleted: false, description: undefined, createdAt: Date.now(), updatedAt: Date.now() }]);

    const res = await skillFetch('PUT', '/secrets/ns/k', { value: 'v' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockClient.batchPut).toHaveBeenCalled();
  });
});
