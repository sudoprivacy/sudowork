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

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}));

vi.mock('@/process/services/python/PythonRuntimeService', () => ({
  pythonRuntimeService: { checkInstalled: vi.fn().mockResolvedValue({ installed: false }) },
}));

vi.mock('@/common/nexus/nexus-secret-client', () => ({
  getNexusSecretClient: () => ({
    getSecret: (namespace: string, key: string) => {
      getSecretCalls.push({ namespace, key });
      if (mockSecretThrow) throw mockSecretThrow;
      return mockSecretValue;
    },
  }),
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainError: vi.fn(),
  mainWarn: vi.fn(),
}));

// Import AFTER vi.mock so the mocks are wired.
import { __resetPwdLoginApprovalsForTest, handlePwdLogin } from '../../src/process/services/pwdLogin/pwdLoginService';

describe('pwdLogin / pwdLoginService', () => {
  beforeEach(() => {
    getSecretCalls.length = 0;
    mockSecretValue = 'secret-correct-horse';
    mockSecretThrow = null;
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
