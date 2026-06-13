/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PwdLoginErrorCode } from '../../src/process/services/pwdLogin/errors';
import { bufferToBase64AndZero, isBufferZeroed, passwordStringToBuffer, zeroBuffer } from '../../src/process/services/pwdLogin/memorySafety';
import { findAdapterByDomain, findAdapterByTitle, listAdapters } from '../../src/process/services/pwdLogin/pwdAdapters';

describe('pwdLogin / memorySafety', () => {
  it('passwordStringToBuffer produces a Buffer with the same bytes', () => {
    const buf = passwordStringToBuffer('hunter2');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString('utf-8')).toBe('hunter2');
  });

  it('bufferToBase64AndZero returns correct base64 and zeros the source', () => {
    const buf = passwordStringToBuffer('hunter2');
    const b64 = bufferToBase64AndZero(buf);
    expect(b64).toBe(Buffer.from('hunter2', 'utf-8').toString('base64'));
    expect(isBufferZeroed(buf)).toBe(true);
  });

  it('zeroBuffer fills with zeros and is idempotent', () => {
    const buf = passwordStringToBuffer('abc');
    zeroBuffer(buf);
    expect(isBufferZeroed(buf)).toBe(true);
    // second call still safe
    zeroBuffer(buf);
    expect(isBufferZeroed(buf)).toBe(true);
  });

  it('zeroBuffer tolerates null / undefined / empty', () => {
    expect(() => zeroBuffer(null)).not.toThrow();
    expect(() => zeroBuffer(undefined)).not.toThrow();
    expect(() => zeroBuffer(Buffer.alloc(0))).not.toThrow();
  });

  it('isBufferZeroed detects non-zero bytes', () => {
    const buf = Buffer.from([0, 0, 1, 0]);
    expect(isBufferZeroed(buf)).toBe(false);
  });
});

describe('pwdLogin / errors', () => {
  it('enum values are stable strings expected by the IPC contract', () => {
    // Renderer + audit log pin on these exact strings — changing them is a
    // breaking protocol change. Keep the assertions explicit.
    expect(PwdLoginErrorCode.EntryNotFound).toBe('entry_not_found');
    expect(PwdLoginErrorCode.ApprovalRejected).toBe('approval_rejected');
    expect(PwdLoginErrorCode.ApprovalTimeout).toBe('approval_timeout');
    expect(PwdLoginErrorCode.LoginFormNotFound).toBe('login_form_not_found');
    expect(PwdLoginErrorCode.LoginSubmitFailed).toBe('login_submit_failed');
    expect(PwdLoginErrorCode.NexusUnreachable).toBe('nexus_unreachable');
    expect(PwdLoginErrorCode.AdapterError).toBe('adapter_error');
  });
});

describe('pwdLogin / pwdAdapters', () => {
  it('title lookup is case-insensitive and whitespace-tolerant', () => {
    expect(findAdapterByTitle('GitHub')?.title).toBe('github');
    expect(findAdapterByTitle('  github  ')?.title).toBe('github');
    expect(findAdapterByTitle('GITHUB')?.title).toBe('github');
  });

  it('title miss returns undefined', () => {
    expect(findAdapterByTitle('not-a-real-site')).toBeUndefined();
  });

  it('domain lookup matches exact + subdomain', () => {
    expect(findAdapterByDomain('github.com')?.title).toBe('github');
    expect(findAdapterByDomain('www.github.com')?.title).toBe('github');
  });

  it('Day-1 adapter set covers at least 10 sites', () => {
    expect(listAdapters().length).toBeGreaterThanOrEqual(10);
  });

  it('every adapter declares required selectors + strategy', () => {
    for (const adapter of listAdapters()) {
      expect(adapter.title).toBeTruthy();
      expect(adapter.loginUrl).toMatch(/^https?:\/\//);
      expect(adapter.domains.length).toBeGreaterThan(0);
      expect(adapter.usernameSelector).toBeTruthy();
      expect(adapter.passwordSelector).toBeTruthy();
      expect(adapter.submitSelector).toBeTruthy();
      expect(['single_step', 'two_step']).toContain(adapter.strategy);
    }
  });
});

// ---------------------------------------------------------------------------
// Service-level tests with mocked NexusSecretClient (gRPC), python runtime,
// electron, and logger. The secret read now uses NexusSecretClient.getSecret
// (nexusd-cluster :12022 is gRPC-only — the old HTTP /api/v2/password_vault
// path was removed). The python runtime is mocked as not-installed so the real
// dispatchPwdFill fails fast with adapter_error (no browser/filler in units).
// ---------------------------------------------------------------------------

const getSecretCalls: Array<{ namespace: string; key: string }> = [];
let mockSecretValue: string | null = 'secret-correct-horse';
let mockSecretThrow: unknown = null;
// Batch/list fallback + storage simulation (deployed vault plugins may be missing
// secret_get/secret_put — see project_vault_plugin_secret_get_missing).
const secretStore = new Map<string, string>();
let getSecretMethodMissing = false; // simulate "secret_get: method not found"
let putSecretMethodMissing = false; // simulate "secret_put: method not found"
const batchGetCalls: Array<Array<{ namespace: string; key: string }>> = [];
const batchPutCalls: Array<Array<{ namespace: string; key: string; value: string }>> = [];
const listSecretsCalls: string[] = [];
function methodNotFound(method: string): Error {
  return new Error(`RPC error: password-vault.${method}: gRPC call failed: method not found`);
}

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}));

vi.mock('@/process/services/python/PythonRuntimeService', () => ({
  pythonRuntimeService: { checkInstalled: vi.fn().mockResolvedValue({ installed: false }) },
}));

// ProcessConfig holds the pwd_login custom-site registry. Mock it in-memory so
// importing the service doesn't drag in the real storage/database stack.
const mockConfigStore: Record<string, unknown> = {};
vi.mock('@/process/initStorage', () => ({
  ProcessConfig: {
    get: (key: string) => Promise.resolve(mockConfigStore[key]),
    set: (key: string, value: unknown) => {
      mockConfigStore[key] = value;
      return Promise.resolve();
    },
    getSync: (key: string) => mockConfigStore[key],
  },
}));

vi.mock('@/common/nexus/nexus-secret-client', () => ({
  getNexusSecretClient: () => ({
    getSecret: (namespace: string, key: string) => {
      getSecretCalls.push({ namespace, key });
      if (getSecretMethodMissing) throw methodNotFound('secret_get');
      if (mockSecretThrow) throw mockSecretThrow;
      const stored = secretStore.get(`${namespace}/${key}`);
      return stored !== undefined ? stored : mockSecretValue;
    },
    putSecret: (namespace: string, key: string, value: string) => {
      if (putSecretMethodMissing) throw methodNotFound('secret_put');
      secretStore.set(`${namespace}/${key}`, value);
    },
    batchGet: (queries: Array<{ namespace: string; key: string }>) => {
      batchGetCalls.push(queries);
      const out: Record<string, string> = {};
      for (const q of queries) {
        const v = secretStore.get(`${q.namespace}/${q.key}`);
        if (v !== undefined) out[`${q.namespace}/${q.key}`] = v;
      }
      return out;
    },
    batchPut: (secrets: Array<{ namespace: string; key: string; value: string }>) => {
      batchPutCalls.push(secrets);
      for (const s of secrets) secretStore.set(`${s.namespace}/${s.key}`, s.value);
    },
    listSecrets: (namespace: string) => {
      listSecretsCalls.push(namespace);
      return [...secretStore.keys()].filter((k) => k.startsWith(`${namespace}/`)).map((k) => ({ namespace, key: k.slice(namespace.length + 1) }));
    },
  }),
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainError: vi.fn(),
  mainWarn: vi.fn(),
}));

// Import AFTER vi.mock so the mocks are wired.
import { __resetPwdLoginApprovalsForTest, handlePwdLogin, registerPwdLoginEntry, deletePwdLoginEntry, listPwdLoginEntries, resolvePwdAdapter, savePwdLoginCredential } from '../../src/process/services/pwdLogin/pwdLoginService';

function resetSecretMocks(): void {
  getSecretCalls.length = 0;
  batchGetCalls.length = 0;
  batchPutCalls.length = 0;
  listSecretsCalls.length = 0;
  secretStore.clear();
  getSecretMethodMissing = false;
  putSecretMethodMissing = false;
  mockSecretValue = 'secret-correct-horse';
  mockSecretThrow = null;
}

describe('pwdLogin / pwdLoginService', () => {
  beforeEach(() => {
    resetSecretMocks();
    for (const k of Object.keys(mockConfigStore)) delete mockConfigStore[k];
    __resetPwdLoginApprovalsForTest();
  });

  afterEach(() => {
    // Safety net: never leak decisions across tests
    __resetPwdLoginApprovalsForTest();
  });

  it('rejects empty title before any secret read', async () => {
    const result = await handlePwdLogin({ title: '   ', optionId: 'allow_once' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe(PwdLoginErrorCode.EntryNotFound);
    expect(getSecretCalls.length).toBe(0);
  });

  it('returns approval_rejected on reject_once without cache consultation', async () => {
    const result = await handlePwdLogin({ title: 'github', optionId: 'reject_once' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe(PwdLoginErrorCode.ApprovalRejected);
    expect(getSecretCalls.length).toBe(0);
  });

  it('returns approval_rejected when no decision supplied and cache empty', async () => {
    const result = await handlePwdLogin({ title: 'github' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe(PwdLoginErrorCode.ApprovalRejected);
  });

  it('allow_always caches approval for subsequent call', async () => {
    const first = await handlePwdLogin({ title: 'github', optionId: 'allow_always' });
    // First call progresses past approval; fails at fill dispatch (python mocked off)
    expect(first.error).toBe(PwdLoginErrorCode.AdapterError);

    // Second call without optionId should find cached approval and reach dispatch
    const second = await handlePwdLogin({ title: 'github' });
    expect(second.error).toBe(PwdLoginErrorCode.AdapterError);
  });

  it('login_form_not_found when title has no adapter entry', async () => {
    const result = await handlePwdLogin({ title: 'unknown-site', optionId: 'allow_once' });
    expect(result.error).toBe(PwdLoginErrorCode.LoginFormNotFound);
    // secret should not be read for a title with no adapter
    expect(getSecretCalls.length).toBe(0);
  });

  it('two_step adapter returns login_form_not_found in Phase 1', async () => {
    // "google" is registered as two_step in pwdAdapters.ts
    const result = await handlePwdLogin({ title: 'google', optionId: 'allow_once' });
    expect(result.error).toBe(PwdLoginErrorCode.LoginFormNotFound);
    expect(result.detail).toContain('two_step');
  });

  it('empty/missing secret → entry_not_found', async () => {
    mockSecretValue = '';
    const result = await handlePwdLogin({ title: 'github', optionId: 'allow_once' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe(PwdLoginErrorCode.EntryNotFound);
  });

  it('secret_get throws → nexus_unreachable', async () => {
    mockSecretThrow = new Error('RPC error');
    const result = await handlePwdLogin({ title: 'github', optionId: 'allow_once' });
    expect(result.error).toBe(PwdLoginErrorCode.NexusUnreachable);
  });

  it('happy path reads the secret (gRPC) then reaches fill dispatch', async () => {
    const result = await handlePwdLogin({ title: 'github', optionId: 'allow_once' });
    expect(result.ok).toBe(false);
    // python runtime mocked as not-installed → adapter_error from dispatchPwdFill
    expect(result.error).toBe(PwdLoginErrorCode.AdapterError);
    // secret was read once from the pwd_login namespace, keyed by title
    expect(getSecretCalls.length).toBe(1);
    expect(getSecretCalls[0]).toEqual({ namespace: 'service:pwdlogin', key: 'github' });
  });

  it('parses JSON {username,password} secret values', async () => {
    mockSecretValue = JSON.stringify({ username: 'admin', password: 'p@ss' });
    const result = await handlePwdLogin({ title: 'github', optionId: 'allow_once' });
    // Still hits the (mocked-off) python dispatch, but the read+parse succeeded.
    expect(result.error).toBe(PwdLoginErrorCode.AdapterError);
    expect(getSecretCalls[0]).toEqual({ namespace: 'service:pwdlogin', key: 'github' });
  });
});

describe('pwdLogin / entry registry', () => {
  beforeEach(() => {
    resetSecretMocks();
    for (const k of Object.keys(mockConfigStore)) delete mockConfigStore[k];
    mockSecretValue = '';
  });

  it('registerPwdLoginEntry persists a custom site, dedupes by title', async () => {
    await registerPwdLoginEntry({ title: 'Yidao', url: 'http://x/login', usernameSelector: '#u', passwordSelector: '#p', submitSelector: '#s', strategy: 'single_step' });
    await registerPwdLoginEntry({ title: 'yidao', url: 'http://x/login2', usernameSelector: '#u2', passwordSelector: '#p', submitSelector: '#s', strategy: 'single_step' });
    const reg = mockConfigStore['pwdLogin.entries'] as unknown[];
    expect(reg.length).toBe(1); // same title (case-insensitive) → updated, not duplicated
  });

  it('registerPwdLoginEntry rejects incomplete entries', async () => {
    await expect(registerPwdLoginEntry({ title: 'bad', url: '', usernameSelector: '', passwordSelector: '', submitSelector: '', strategy: 'single_step' })).rejects.toThrow();
  });

  it('resolvePwdAdapter prefers a custom registry entry over a built-in', async () => {
    await registerPwdLoginEntry({ title: 'github', url: 'http://custom/login', usernameSelector: '#cu', passwordSelector: '#cp', submitSelector: '#cs', strategy: 'single_step' });
    const adapter = await resolvePwdAdapter('github');
    expect(adapter?.loginUrl).toBe('http://custom/login');
    expect(adapter?.usernameSelector).toBe('#cu');
  });

  it('listPwdLoginEntries merges custom + built-in and flags captcha/credential', async () => {
    await registerPwdLoginEntry({ title: 'mysite', url: 'http://m/login', usernameSelector: '#u', passwordSelector: '#p', submitSelector: '#s', captchaSelector: '#c', captchaImageSelector: '#ci', strategy: 'single_step' });
    const list = await listPwdLoginEntries();
    const mysite = list.find((e) => e.title === 'mysite');
    const yidao = list.find((e) => e.title === 'yidao'); // built-in adapter
    expect(mysite?.source).toBe('custom');
    expect(mysite?.hasCaptcha).toBe(true);
    expect(yidao?.source).toBe('builtin');
    expect(yidao?.hasCaptcha).toBe(true); // yidao adapter has a captcha
  });

  it('deletePwdLoginEntry removes a custom entry', async () => {
    await registerPwdLoginEntry({ title: 'tmp', url: 'http://t/login', usernameSelector: '#u', passwordSelector: '#p', submitSelector: '#s', strategy: 'single_step' });
    await deletePwdLoginEntry('tmp');
    const reg = (mockConfigStore['pwdLogin.entries'] as unknown[]) || [];
    expect(reg.length).toBe(0);
  });
});

describe('pwdLogin / vault resilience + security invariants', () => {
  beforeEach(() => {
    resetSecretMocks();
    for (const k of Object.keys(mockConfigStore)) delete mockConfigStore[k];
    __resetPwdLoginApprovalsForTest();
  });

  it('reads the credential via batchGet when secret_get is method-not-found', async () => {
    await savePwdLoginCredential('github', 'admin', 'pw'); // stored (putSecret works here)
    getSecretMethodMissing = true; // deployed plugin missing secret_get
    const r = await handlePwdLogin({ title: 'github', optionId: 'allow_once' });
    // Reaching the (python-off) fill dispatch means the read+parse succeeded via batch.
    expect(r.error).toBe(PwdLoginErrorCode.AdapterError);
    expect(batchGetCalls.length).toBeGreaterThan(0);
  });

  it('saves the credential via batchPut when secret_put is method-not-found', async () => {
    putSecretMethodMissing = true; // deployed plugin missing secret_put
    await savePwdLoginCredential('github', 'admin', 'pw');
    expect(batchPutCalls.length).toBe(1);
    // Stored as JSON {username,password} at the pwd_login namespace.
    expect(JSON.parse(secretStore.get('service:pwdlogin/github') as string)).toEqual({ username: 'admin', password: 'pw' });
  });

  it('round-trips creds through the batch fallback (save → start reads back)', async () => {
    putSecretMethodMissing = true;
    getSecretMethodMissing = true;
    await savePwdLoginCredential('github', 'admin', 'pw');
    const r = await handlePwdLogin({ title: 'github', optionId: 'allow_once' });
    expect(r.error).toBe(PwdLoginErrorCode.AdapterError); // read+parse via batchGet worked
  });

  it('hasCredential reflects a saved cred via listSecrets (not secret_get)', async () => {
    await savePwdLoginCredential('yidao', 'admin', 'pw');
    const list = await listPwdLoginEntries();
    expect(list.find((e) => e.title === 'yidao')?.hasCredential).toBe(true);
    expect(listSecretsCalls.length).toBeGreaterThan(0);
  });

  it('SECURITY: the registry stores only non-secret selectors — never a password/username/value', async () => {
    await registerPwdLoginEntry({ title: 'mysite', url: 'http://m/login', usernameSelector: '#u', passwordSelector: '#p', submitSelector: '#s', strategy: 'single_step' });
    const entry = (mockConfigStore['pwdLogin.entries'] as Array<Record<string, unknown>>)[0];
    for (const forbidden of ['password', 'username', 'value', 'secret']) {
      expect(Object.prototype.hasOwnProperty.call(entry, forbidden)).toBe(false);
    }
  });

  it('SECURITY: a successful start result carries no password bytes', async () => {
    // python runtime is mocked off → dispatch fails before any fill, but assert the
    // contract: the IPC result shape only ever exposes ok/tab_id/error/detail.
    await savePwdLoginCredential('github', 'admin', 'sup3r-secret-pw');
    const r = await handlePwdLogin({ title: 'github', optionId: 'allow_once' });
    expect(JSON.stringify(r)).not.toContain('sup3r-secret-pw');
  });
});
