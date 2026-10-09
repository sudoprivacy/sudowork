/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for the auto-login skill's Auth-Proxy API
 * (src/process/services/authProxy/pwdLoginApi.ts) — the agent-facing contract.
 * The pwdLoginService is mocked so this is a pure routing/shape test.
 */

import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { register: unknown[]; list: number; start: unknown[] } = { register: [], list: 0, start: [] };
let startResult: Record<string, unknown> = { ok: true, tab_id: 'active' };
let registerThrows: Error | null = null;

vi.mock('@process/services/pwdLogin/pwdLoginService', () => ({
  listPwdLoginEntries: async () => {
    calls.list++;
    return [{ title: 'yidao', url: 'http://y/login', strategy: 'single_step', hasCaptcha: true, source: 'builtin', hasCredential: false }];
  },
  registerPwdLoginEntry: async (entry: unknown) => {
    if (registerThrows) throw registerThrows;
    calls.register.push(entry);
  },
  handlePwdLogin: async (params: unknown) => {
    calls.start.push(params);
    return startResult;
  },
}));

vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainError: vi.fn(), mainWarn: vi.fn() }));

import { handlePwdLoginRequest } from '../../src/process/services/authProxy/pwdLoginApi';

/** Minimal fake IncomingMessage that emits an optional JSON body. */
function fakeReq(method: string, body?: unknown): any {
  const req = new EventEmitter() as any;
  req.method = method;
  setImmediate(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body), 'utf-8'));
    req.emit('end');
  });
  req.destroy = () => {};
  return req;
}

function fakeRes(): { status: number; body: any; writeHead: any; end: any; headersSent: boolean } {
  const res: any = { status: 0, body: undefined, headersSent: false };
  res.writeHead = (code: number) => {
    res.status = code;
    res.headersSent = true;
  };
  res.end = (text: string) => {
    res.body = text ? JSON.parse(text) : undefined;
  };
  return res;
}

describe('pwdLoginApi (auto-login Auth-Proxy routes)', () => {
  beforeEach(() => {
    calls.register = [];
    calls.list = 0;
    calls.start = [];
    startResult = { ok: true, tab_id: 'active' };
    registerThrows = null;
  });
  afterEach(() => vi.clearAllMocks());

  it('GET /pwdlogin/list returns the entry list', async () => {
    const res = fakeRes();
    await handlePwdLoginRequest(fakeReq('GET'), res as any, '/pwdlogin/list');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0].title).toBe('yidao');
    expect(calls.list).toBe(1);
  });

  it('POST /pwdlogin/register forwards the (non-secret) entry', async () => {
    const entry = { title: 'mysite', url: 'http://m/login', usernameSelector: '#u', passwordSelector: '#p', submitSelector: '#s', strategy: 'single_step' };
    const res = fakeRes();
    await handlePwdLoginRequest(fakeReq('POST', entry), res as any, '/pwdlogin/register');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(calls.register).toHaveLength(1);
    // SECURITY: nothing password-like should ever be in a register payload.
    expect(Object.keys(calls.register[0] as object)).not.toContain('password');
  });

  it('POST /pwdlogin/register surfaces validation errors', async () => {
    registerThrows = new Error('pwd_login entry requires ...');
    const res = fakeRes();
    await handlePwdLoginRequest(fakeReq('POST', { title: 'bad' }), res as any, '/pwdlogin/register');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /pwdlogin/start passes only the title (allow_once) and never returns a password', async () => {
    startResult = { ok: true, tab_id: 'http://y/Frame/ChainFrame.aspx' };
    const res = fakeRes();
    await handlePwdLoginRequest(fakeReq('POST', { title: 'yidao', password: 'leak-me' }), res as any, '/pwdlogin/start');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // The handler must pass ONLY {title, optionId} to the service — no password.
    expect(calls.start[0]).toEqual({ title: 'yidao', optionId: 'allow_once' });
    expect(JSON.stringify(res.body)).not.toContain('leak-me');
  });

  it('POST /pwdlogin/start requires a title', async () => {
    const res = fakeRes();
    await handlePwdLoginRequest(fakeReq('POST', {}), res as any, '/pwdlogin/start');
    expect(res.status).toBe(400);
  });

  it('unknown path → 404', async () => {
    const res = fakeRes();
    await handlePwdLoginRequest(fakeReq('GET'), res as any, '/pwdlogin/nope');
    expect(res.status).toBe(404);
  });
});
