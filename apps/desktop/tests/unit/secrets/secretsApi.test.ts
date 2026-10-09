/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration test for `handleSecretsRequest` — the authProxy /secrets
 * route handler that external skill subprocesses hit. Covers the
 * regression surface that pure-unit tests of `NexusSecretClient` miss:
 * URL parsing, method dispatch, body validation, JSON shape, error
 * mapping, and the cross-handler data flow (PUT → LIST sees the key
 * → DELETE → LIST no longer sees the key) — the actual user journey
 * a skill walks through when saving / retrieving API keys.
 *
 * Real client integration (napi → cluster → vault) is covered by
 * `tests/integration/secrets-grpc.integration.test.ts`; this test
 * uses a persisting in-memory client so PUT followed by LIST actually
 * shows the secret, but doesn't require a running cluster (so it runs
 * in the cheap Secrets Unit Tests CI job).
 *
 * Real user journey driving each test:
 *   PUT → LIST: "Save my API key, then verify it's in the list"
 *   PUT same key with new value: "Rotate my API key in place"
 *   PUT → DELETE → LIST: "Remove my old API key, verify it's gone"
 *   GET missing key → 405: route correctness for unhappy URL shapes
 *   PUT with invalid body → 400: skill body-validation contract
 *
 * What this guards against (the 进二 v0.2.7 bug class):
 *   - A handler returning 200 when the underlying secret_put failed
 *     (the failure path that surfaces as "key disappeared next time")
 *   - PUT response not reflecting the actual stored metadata
 *   - LIST silently missing newly-PUT entries (cache race / forgot to
 *     emit enabledStateChanged etc.)
 *   - URL parsing accepting paths that bypass the namespace/key check
 */

import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── In-memory client that persists across calls within one test ────
// (the alternative — re-mocking per call — defeats the data-flow tests
// where PUT must be visible to subsequent LIST).
interface StoredSecret {
  namespace: string;
  key: string;
  value: string;
  description?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
}

let store: Map<string, StoredSecret>;

function storeKey(namespace: string, key: string): string {
  return `${namespace}/${key}`;
}

function toMetadata(s: StoredSecret) {
  return { namespace: s.namespace, key: s.key, description: s.description, currentVersion: s.version, deleted: s.deleted, createdAt: s.createdAt, updatedAt: s.updatedAt };
}

const mockClient = {
  putSecret: vi.fn((namespace: string, key: string, value: string, description?: string) => {
    const k = storeKey(namespace, key);
    const existing = store.get(k);
    const now = Date.now();
    const stored: StoredSecret = {
      namespace,
      key,
      value,
      description: description ?? existing?.description,
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deleted: false,
    };
    store.set(k, stored);
    return toMetadata(stored);
  }),
  batchPut: vi.fn(),
  getSecret: vi.fn(),
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
    if (!existing) {
      // Match the real client: restore of a non-existent / never-deleted
      // secret throws. The handler catches and ignores — that's the
      // common-case for first-time PUT.
      throw new Error('Secret not found or not deleted');
    }
    store.set(k, { ...existing, deleted: false });
    return true;
  }),
  listSecrets: vi.fn((namespace?: string, includeDeleted = false) => {
    return [...store.values()].filter((s) => (!namespace || s.namespace === namespace) && (includeDeleted || !s.deleted)).map(toMetadata);
  }),
};

// ─── Mock everything the handler imports that isn't load-bearing for
//     handler logic. The handler's job is route → client; the cache,
//     config, and bridge layers have their own tests. ─────────────────

vi.mock('@common/nexus/nexus-secret-client', () => ({
  getNexusSecretClient: () => mockClient,
}));
vi.mock('@common/nexus/nexus-secret-resilient', async () => {
  const { putSecretResilient: realPut } = await import('../../../src/common/nexus/nexus-secret-resilient');
  return { putSecretResilient: realPut };
});
vi.mock('@common/nexus/secret-cache', () => ({
  cachePut: vi.fn(),
  cacheDelete: vi.fn(),
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
vi.mock('../../../src/process/services/authProxy/configItemsLoader', () => ({
  findConfigItemByNamespace: vi.fn(() => null),
  buildRuleFromRawItem: vi.fn(),
  addRuleToCache: vi.fn(),
  removeRuleFromCache: vi.fn(),
}));

// Lazy import so the mocks above land before the handler resolves them.
let handleSecretsRequest: (req: IncomingMessage, res: ServerResponse, pathname: string, parsedUrl: URL) => Promise<void>;

// ─── Mock req / res helpers ─────────────────────────────────────────

class MockRequest extends EventEmitter {
  method: string;
  constructor(method: string, body?: string) {
    super();
    this.method = method;
    // Defer body emit so the handler can attach listeners first.
    if (body !== undefined) {
      setImmediate(() => {
        this.emit('data', Buffer.from(body, 'utf-8'));
        this.emit('end');
      });
    } else {
      setImmediate(() => this.emit('end'));
    }
  }
  destroy() {}
}

class MockResponse {
  statusCode = 0;
  headers: Record<string, string> = {};
  body = '';
  headersSent = false;
  writeHead(status: number, headers: Record<string, string>): void {
    this.statusCode = status;
    this.headers = headers;
    this.headersSent = true;
  }
  end(payload: string): void {
    this.body = payload;
  }
}

async function invoke(method: string, pathname: string, body?: unknown): Promise<MockResponse> {
  const req = new MockRequest(method, body !== undefined ? JSON.stringify(body) : undefined) as unknown as IncomingMessage;
  const res = new MockResponse();
  const parsedUrl = new URL(`http://localhost${pathname}`);
  await handleSecretsRequest(req, res as unknown as ServerResponse, parsedUrl.pathname, parsedUrl);
  return res;
}

function parseBody(res: MockResponse): { success: boolean; data?: unknown; msg?: string } {
  return JSON.parse(res.body);
}

// ─── Setup ──────────────────────────────────────────────────────────

beforeEach(async () => {
  store = new Map();
  vi.clearAllMocks();
  // Re-import per test so the singleton state inside the handler module
  // doesn't bleed between tests (vi.resetModules would also work but is
  // heavier).
  const mod = await import('../../../src/process/services/authProxy/secretsApi');
  handleSecretsRequest = mod.handleSecretsRequest;
});

// ─── Real user journeys ────────────────────────────────────────────

describe('handleSecretsRequest — full user journeys', () => {
  it('Journey: skill saves an API key → lists secrets → sees the key', async () => {
    // Step 1: PUT — skill saves API key for ShareOne
    const putRes = await invoke('PUT', '/secrets/service:shareone/api_key', { value: 'sk-test-abc', description: 'ShareOne prod key' });
    expect(putRes.statusCode).toBe(200);
    const putBody = parseBody(putRes);
    expect(putBody.success).toBe(true);
    expect((putBody.data as { key: string }).key).toBe('api_key');

    // Step 2: LIST — skill verifies the key shows up
    const listRes = await invoke('GET', '/secrets?namespace=service:shareone');
    expect(listRes.statusCode).toBe(200);
    const listBody = parseBody(listRes);
    expect(listBody.success).toBe(true);
    const entries = listBody.data as Array<{ namespace: string; key: string }>;
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatchObject({ namespace: 'service:shareone', key: 'api_key' });
  });

  it('Journey: rotate an API key in place (second PUT bumps version)', async () => {
    await invoke('PUT', '/secrets/service:shareone/api_key', { value: 'sk-old' });
    const rotateRes = await invoke('PUT', '/secrets/service:shareone/api_key', { value: 'sk-new' });

    expect(rotateRes.statusCode).toBe(200);
    const data = parseBody(rotateRes).data as { currentVersion: number };
    expect(data.currentVersion).toBe(2);

    // Verify only ONE entry in list (rotation, not duplicate)
    const listBody = parseBody(await invoke('GET', '/secrets?namespace=service:shareone'));
    expect((listBody.data as unknown[]).length).toBe(1);
  });

  it('Journey: delete a key and verify it disappears from list', async () => {
    await invoke('PUT', '/secrets/service:shareone/api_key', { value: 'sk-test' });

    const deleteRes = await invoke('DELETE', '/secrets/service:shareone/api_key');
    expect(deleteRes.statusCode).toBe(200);
    expect(parseBody(deleteRes).success).toBe(true);

    const listBody = parseBody(await invoke('GET', '/secrets?namespace=service:shareone'));
    expect((listBody.data as unknown[]).length).toBe(0);
  });

  it('Journey: LIST scoped to namespace ignores other namespaces', async () => {
    await invoke('PUT', '/secrets/service:shareone/api_key', { value: 'a' });
    await invoke('PUT', '/secrets/service:other/api_key', { value: 'b' });

    const listBody = parseBody(await invoke('GET', '/secrets?namespace=service:shareone'));
    expect((listBody.data as Array<{ namespace: string }>).every((s) => s.namespace === 'service:shareone')).toBe(true);
    expect((listBody.data as unknown[]).length).toBe(1);
  });
});

// ─── Handler contract / negative paths ──────────────────────────────

describe('handleSecretsRequest — input validation & error mapping', () => {
  it('PUT with missing "value" field → 400', async () => {
    const res = await invoke('PUT', '/secrets/ns/k', { description: 'no value here' });
    expect(res.statusCode).toBe(400);
    expect(parseBody(res).msg).toMatch(/value/);
  });

  it('PUT with invalid JSON body → 400', async () => {
    const req = new MockRequest('PUT', '{not json}') as unknown as IncomingMessage;
    const res = new MockResponse();
    const url = new URL('http://localhost/secrets/ns/k');
    await handleSecretsRequest(req, res as unknown as ServerResponse, url.pathname, url);
    expect(res.statusCode).toBe(400);
    expect(parseBody(res).msg).toMatch(/JSON/);
  });

  it('PUT with body over 64KB → 413', async () => {
    // 65KB string just past the 64KB limit
    const oversized = 'x'.repeat(64 * 1024 + 1);
    const res = await invoke('PUT', '/secrets/ns/k', { value: oversized });
    expect(res.statusCode).toBe(413);
  });

  it('unsupported method on /secrets/ns/k → 405', async () => {
    const res = await invoke('PATCH', '/secrets/ns/k');
    expect(res.statusCode).toBe(405);
  });

  it('unknown path shape → 404', async () => {
    const res = await invoke('GET', '/secrets/ns/k/extra/segment');
    expect(res.statusCode).toBe(404);
  });

  it('client throwing non-method-missing error → 500 with msg', async () => {
    mockClient.putSecret.mockImplementationOnce(() => {
      throw new Error('plugin API version mismatch: plugin=3, kernel=5');
    });
    const res = await invoke('PUT', '/secrets/ns/k', { value: 'v' });
    expect(res.statusCode).toBe(500);
    expect(parseBody(res).msg).toMatch(/version mismatch/);
  });
});

// ─── The 进二 bug class — fallback resilience at the handler level ─

describe('handleSecretsRequest — vault method-missing resilience', () => {
  it('PUT succeeds via batch_put fallback when secret_put is method-not-found', async () => {
    // Vault dylib missing secret_put — the recurring 进二 bug class
    mockClient.putSecret.mockImplementationOnce(() => {
      throw new Error('method not found');
    });
    mockClient.batchPut.mockReturnValueOnce([{ namespace: 'service:shareone', key: 'api_key', currentVersion: 1, deleted: false, description: undefined }]);

    const res = await invoke('PUT', '/secrets/service:shareone/api_key', { value: 'sk-test' });

    expect(res.statusCode).toBe(200);
    expect(parseBody(res).success).toBe(true);
    expect(mockClient.batchPut).toHaveBeenCalledWith([{ namespace: 'service:shareone', key: 'api_key', value: 'sk-test', description: undefined }]);
  });

  it('PUT succeeds via batch_put fallback for UNIMPLEMENTED gRPC status too', async () => {
    mockClient.putSecret.mockImplementationOnce(() => {
      throw new Error('14 UNIMPLEMENTED: no method password-vault.secret_put');
    });
    mockClient.batchPut.mockReturnValueOnce([{ namespace: 'ns', key: 'k', currentVersion: 1, deleted: false, description: undefined }]);

    const res = await invoke('PUT', '/secrets/ns/k', { value: 'v' });
    expect(res.statusCode).toBe(200);
    expect(mockClient.batchPut).toHaveBeenCalled();
  });
});
