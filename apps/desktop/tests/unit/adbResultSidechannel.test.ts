/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { AdbResultSidechannel, type AdbResultEntry } from '../../src/process/services/sudoclaw/AdbResultSidechannel';

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: () => {},
  mainWarn: () => {},
  mainError: () => {},
}));

async function post(endpoint: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number }> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status };
}

function makeEntry(overrides: Partial<AdbResultEntry> = {}): AdbResultEntry {
  return {
    callId: overrides.callId ?? 'call-1',
    cmd: overrides.cmd ?? 'python',
    argv: overrides.argv ?? ['-m', 'ai_dev_browser.tools.page_info', '--json'],
    pid: overrides.pid ?? 1234,
    ppid: overrides.ppid ?? 5678,
    startedAt: overrides.startedAt ?? Date.now() - 100,
    finishedAt: overrides.finishedAt ?? Date.now(),
    exitCode: overrides.exitCode ?? 0,
    stdoutRaw: overrides.stdoutRaw ?? '{"ok":true}',
    stdoutJson: overrides.stdoutJson ?? { ok: true },
    cmdHash: overrides.cmdHash ?? 'hash-1',
  };
}

describe('AdbResultSidechannel', () => {
  let sc: AdbResultSidechannel | null = null;

  afterEach(async () => {
    if (sc) await sc.stop();
    sc = null;
  });

  it('rejects requests missing the secret header', async () => {
    sc = new AdbResultSidechannel();
    const { port } = await sc.start();
    const { status } = await post(`http://127.0.0.1:${port}/capture`, makeEntry());
    expect(status).toBe(401);
  });

  it('rejects requests with a wrong secret', async () => {
    sc = new AdbResultSidechannel();
    const { port } = await sc.start();
    const { status } = await post(`http://127.0.0.1:${port}/capture`, makeEntry(), { 'x-adb-secret': 'not-the-secret' });
    expect(status).toBe(401);
  });

  it('accepts a well-formed entry with the correct secret and exposes it via waitForCmd', async () => {
    sc = new AdbResultSidechannel();
    const { port, secret } = await sc.start();
    const entry = makeEntry({ cmdHash: 'hash-alpha' });
    const { status } = await post(`http://127.0.0.1:${port}/capture`, entry, { 'x-adb-secret': secret });
    expect(status).toBe(204);
    const retrieved = await sc.waitForCmd('hash-alpha', 100);
    expect(retrieved?.callId).toBe('call-1');
    expect(retrieved?.stdoutRaw).toBe('{"ok":true}');
  });

  it('supports FIFO retrieval when multiple entries share a cmdHash', async () => {
    sc = new AdbResultSidechannel();
    const { port, secret } = await sc.start();
    await post(`http://127.0.0.1:${port}/capture`, makeEntry({ callId: 'a', cmdHash: 'h' }), { 'x-adb-secret': secret });
    await post(`http://127.0.0.1:${port}/capture`, makeEntry({ callId: 'b', cmdHash: 'h' }), { 'x-adb-secret': secret });
    const first = await sc.waitForCmd('h', 50);
    const second = await sc.waitForCmd('h', 50);
    expect(first?.callId).toBe('a');
    expect(second?.callId).toBe('b');
  });

  it('waitForCmd resolves when a late POST arrives within the window', async () => {
    sc = new AdbResultSidechannel();
    const { port, secret } = await sc.start();
    const pending = sc.waitForCmd('late-hash', 2000);
    setTimeout(() => {
      void post(`http://127.0.0.1:${port}/capture`, makeEntry({ callId: 'late', cmdHash: 'late-hash' }), { 'x-adb-secret': secret });
    }, 50);
    const entry = await pending;
    expect(entry?.callId).toBe('late');
  });

  it('waitForCmd returns null if the window expires before any POST arrives', async () => {
    sc = new AdbResultSidechannel();
    await sc.start();
    const entry = await sc.waitForCmd('nope', 30);
    expect(entry).toBeNull();
  });

  it('takeByCallId returns null for an unknown id and consumes on match', async () => {
    sc = new AdbResultSidechannel();
    const { port, secret } = await sc.start();
    await post(`http://127.0.0.1:${port}/capture`, makeEntry({ callId: 'only', cmdHash: 'x' }), { 'x-adb-secret': secret });
    expect(sc.takeByCallId('missing')).toBeNull();
    const taken = sc.takeByCallId('only');
    expect(taken?.callId).toBe('only');
    // Second take should fail — entry already consumed.
    expect(sc.takeByCallId('only')).toBeNull();
  });

  it('drops oversized bodies without accepting the entry', async () => {
    sc = new AdbResultSidechannel();
    const { port, secret } = await sc.start();
    const huge = 'x'.repeat(9 * 1024 * 1024); // > 8 MB
    const body = JSON.stringify(makeEntry({ stdoutRaw: huge, cmdHash: 'oversized' }));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/capture`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-adb-secret': secret },
        body,
      });
      // If the server did respond, it must not be a success status.
      expect(res.ok).toBe(false);
    } catch (err) {
      // Connection-reset is acceptable — the server destroyed the socket after
      // writing 413. Either outcome proves the entry was not stored.
      expect(err).toBeDefined();
    }
    // Most importantly, the oversized entry did not end up in the store.
    const lookup = await sc.waitForCmd('oversized', 50);
    expect(lookup).toBeNull();
  });
});
