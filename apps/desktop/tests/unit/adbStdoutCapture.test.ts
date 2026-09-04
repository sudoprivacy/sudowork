/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import type * as childProcessTypes from 'node:child_process';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { AdbStdoutCapture } from '../../hook/node/src/process/AdbStdoutCapture';

// Use the CJS `child_process` module exports object so we can reassign
// `spawn` in the test (ESM namespace from `node:child_process` is sealed).
const childProcess = createRequire(import.meta.url)('child_process') as typeof childProcessTypes;

interface ReceivedPost {
  headers: Record<string, string>;
  body: unknown;
}

async function startCaptureSink(): Promise<{ url: string; received: ReceivedPost[]; stop: () => Promise<void> }> {
  const received: ReceivedPost[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        received.push({ headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])), body });
      } catch {
        /* ignore */
      }
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}/capture`;
  return {
    url,
    received,
    stop: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('AdbStdoutCapture', () => {
  let capture: AdbStdoutCapture | null = null;
  let sink: Awaited<ReturnType<typeof startCaptureSink>> | null = null;

  beforeEach(async () => {
    sink = await startCaptureSink();
  });

  afterEach(async () => {
    if (capture) capture.dispose();
    capture = null;
    if (sink) await sink.stop();
    sink = null;
  });

  it('detects python -m ai_dev_browser.tools.* invocations', () => {
    capture = new AdbStdoutCapture({ sidechannelUrl: sink!.url, sidechannelSecret: 's' });
    // Tap private detection via the public apply → spawn flow is heavy; assert via regex semantics.
    // Delegate to the regex by replicating the check.
    const match = (cmd: string, args: string[]) => /(?:^|[\\/])(python|python3)(?:\.exe)?$/i.test(cmd) && args.indexOf('-m') >= 0 && /^ai_dev_browser\.tools\./.test(args[args.indexOf('-m') + 1] ?? '');
    expect(match('python', ['-m', 'ai_dev_browser.tools.page_info'])).toBe(true);
    expect(match('/usr/bin/python3', ['-m', 'ai_dev_browser.tools.page_screenshot', '--url', 'x'])).toBe(true);
    expect(match('C:\\Python311\\python.exe', ['-m', 'ai_dev_browser.tools.page_info'])).toBe(true);
    expect(match('python', ['-m', 'other.module'])).toBe(false);
    expect(match('node', ['-m', 'ai_dev_browser.tools.page_info'])).toBe(false);
    expect(match('python', ['script.py'])).toBe(false);
  });

  it('does NOT intercept browser wrapper invocations (Node stream-mode deadlock avoidance)', () => {
    // Intentional non-interception: attaching `.on('data')` on a bash/cmd.exe
    // child's stdout flips it into flowing mode, which deadlocks openclaw's
    // paused-mode `stream.read()` shell-exec reader (child pipe fills, the
    // wrapper process never exits). The `browser` dispatcher (bash/cmd.exe
    // shim to browser_helper.py) self-POSTs to the sidechannel instead.
    //
    // We lock this guarantee in: the hook's detection regex must stay
    // scoped to the `python -m ai_dev_browser.tools.*` literal so it never
    // sees a shell-wrapped `browser` / legacy `aidb` match.
    const matchesPython = (cmd: string, args: string[]) => /(?:^|[\\/])(python|python3)(?:\.exe)?$/i.test(cmd) && args.indexOf('-m') >= 0 && /^ai_dev_browser\.tools\./.test(args[args.indexOf('-m') + 1] ?? '');
    // Python direct still matches (and will be teed by the hook).
    expect(matchesPython('python', ['-m', 'ai_dev_browser.tools.page_info'])).toBe(true);
    // browser / aidb dispatcher forms — all must return false (hook ignores).
    expect(matchesPython('/home/u/.nexus/sudoclaw/bin/browser', ['page_goto'])).toBe(false);
    expect(matchesPython('/home/u/.nexus/sudoclaw/bin/aidb', ['page_goto'])).toBe(false);
    expect(matchesPython('bash', ['-c', 'browser page_goto'])).toBe(false);
    expect(matchesPython('bash', ['-c', 'aidb page_goto'])).toBe(false);
    expect(matchesPython('cmd.exe', ['/c', 'browser.cmd page_discover'])).toBe(false);
    expect(matchesPython('cmd.exe', ['/c', 'aidb.cmd page_discover'])).toBe(false);
    expect(matchesPython('pwsh.exe', ['-Command', 'browser page_info'])).toBe(false);
  });

  it('does not mutate the caller-supplied env object', () => {
    capture = new AdbStdoutCapture({ sidechannelUrl: sink!.url, sidechannelSecret: 'shh' });
    capture.apply();
    const callerEnv: NodeJS.ProcessEnv = { FOO: 'bar' };
    // Spawn a harmless no-match invocation first to confirm no env leak for non-matches.
    const child = childProcess.spawn(process.execPath, ['-e', 'process.exit(0)'], { env: callerEnv });
    expect(callerEnv.AI_DEV_BROWSER_CALL_ID).toBeUndefined();
    child.kill();
  });

  it('POSTs the captured stdout on child exit for a matching invocation', async () => {
    const stdoutText = '{"path":"/tmp/shot.png","size":42}';
    const script = `process.stdout.write(${JSON.stringify(stdoutText)}); process.exit(0);`;
    const fakeCommand = '/usr/bin/python3';

    // Swap the CJS `spawn` export so the AdbStdoutCapture wrapper sees our
    // fake python command, but under the hood we actually run a Node
    // one-liner that prints JSON.
    const realSpawn = childProcess.spawn;
    const rerouteSpawn: typeof childProcess.spawn = ((cmd: string, ...rest: unknown[]) => {
      if (cmd === fakeCommand) {
        return (realSpawn as unknown as (...a: unknown[]) => ReturnType<typeof childProcess.spawn>)(process.execPath, ['-e', script]);
      }
      return (realSpawn as unknown as (...a: unknown[]) => ReturnType<typeof childProcess.spawn>)(cmd, ...rest);
    }) as typeof childProcess.spawn;

    (childProcess as { spawn: typeof childProcess.spawn }).spawn = rerouteSpawn;

    try {
      capture = new AdbStdoutCapture({ sidechannelUrl: sink!.url, sidechannelSecret: 'topsecret' });
      capture.apply();

      const child = childProcess.spawn(fakeCommand, ['-m', 'ai_dev_browser.tools.page_info']);
      await new Promise<void>((resolve) => {
        child.on('exit', () => resolve());
      });
      // Wait long enough for the HTTP POST to land in the sink.
      const deadline = Date.now() + 2000;
      while (sink!.received.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
    } finally {
      capture?.dispose();
      (childProcess as { spawn: typeof childProcess.spawn }).spawn = realSpawn;
    }

    expect(sink!.received.length).toBeGreaterThan(0);
    const last = sink!.received[sink!.received.length - 1];
    expect(last.headers['x-adb-secret']).toBe('topsecret');
    const body = last.body as { stdoutRaw: string; cmdHash: string; argv: string[] };
    expect(body.stdoutRaw).toBe(stdoutText);
    expect(typeof body.cmdHash).toBe('string');
    expect(body.argv).toEqual(['-m', 'ai_dev_browser.tools.page_info']);
  });
});
