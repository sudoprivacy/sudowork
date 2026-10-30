import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), fetch: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
import { LocalBrowserWorker } from '@process/services/browserPanel/LocalBrowserWorker';

class FixtureProcess extends EventEmitter {
  exitCode: number | null = null;
  signalCode: string | null = null;
  stdout = new PassThrough();
  stderr = new PassThrough();
  input = '';
  stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      this.input += chunk.toString();
      callback();
    },
  });
  kill = vi.fn(() => {
    this.signalCode = 'SIGTERM';
    queueMicrotask(() => this.emit('exit', null, 'SIGTERM'));
    return true;
  });
}

let root: string;
let worker: LocalBrowserWorker;
let host: FixtureProcess;
let helper: FixtureProcess;
let metadata: { python: string; script: string } | null;
const binding = { orgId: 'local', userId: 'owner', sessionId: 'conversation' };
const action = { kind: 'show-window', targetId: 'chosen-tab', controlEpoch: 17, targetEpoch: 9 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('process', { ...process, platform: 'win32' });
  root = mkdtempSync(path.join(os.tmpdir(), 'native-window-adapter-'));
  metadata = { python: path.join(root, 'base', 'python.exe'), script: path.join(root, 'runtime', 'Lib', 'site-packages', 'ai_dev_browser', 'remote', 'native_window.py') };
  host = new FixtureProcess();
  helper = new FixtureProcess();
  mocks.spawn.mockImplementation((_executable, args: string[]) => (args[0] === '-I' ? helper : host));
  mocks.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify(url.endsWith('/binding') ? { nativeWindowHelper: metadata } : { session: { state: 'stopped' } }), { status: 200 }));
  vi.stubGlobal('fetch', mocks.fetch);
  worker = new LocalBrowserWorker({ root: path.join(root, 'profile'), python: path.join(root, 'runtime', 'Scripts', 'python.exe'), binding });
});

afterEach(async () => {
  await worker.close();
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

it('spawns the actual interpreter directly and sends checked identity and credentials only on stdin', async () => {
  await worker.start();
  helper.stdin.on('finish', () => {
    helper.stdout.write(JSON.stringify({ nativeWindow: { foreground: true }, session: { activeTargetId: action.targetId } }));
    helper.emit('close', 0);
  });
  await expect(worker.invoke(action)).resolves.toMatchObject({ nativeWindow: { foreground: true } });
  const [executable, args, options] = mocks.spawn.mock.calls[1];
  expect(executable).toBe(metadata!.python);
  expect(args).toEqual(['-I', metadata!.script]);
  expect(options).toEqual({ windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const payload = JSON.parse(helper.input);
  const workerEnvironment = mocks.spawn.mock.calls[0][2].env;
  expect(payload).toMatchObject({ binding, parentPid: process.pid, action: { ...action, kind: 'prepare-native-window' }, token: workerEnvironment.AI_DEV_BROWSER_WORKER_HOST_TOKEN });
  expect(payload.controller).toMatch(/^user-[a-f0-9]{32}$/);
  expect(JSON.stringify([executable, args, options])).not.toContain(payload.token);
});

it('rejects helper scripts outside the pinned installation before running them', async () => {
  metadata!.script = path.join(root, 'untrusted', 'native_window.py');
  await expect(worker.start()).rejects.toThrow('outside its pinned runtime');
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
  expect(host.kill).toHaveBeenCalledOnce();
});

it('requires a supporting runtime and does not fall back to a tab-only success', async () => {
  metadata = null;
  await worker.start();
  await expect(worker.invoke(action)).rejects.toThrow('native_window_runtime_upgrade_required');
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
  expect(mocks.fetch.mock.calls.some(([, options]) => options?.body?.includes('select-tab'))).toBe(false);
});

it('preserves a changed-foreground failure without retrying or reporting success', async () => {
  await worker.start();
  helper.stdin.on('finish', () => {
    helper.stdout.write(JSON.stringify({ error: 'native_window_foreground_changed' }));
    helper.emit('close', 1);
  });
  await expect(worker.invoke(action)).rejects.toThrow('native_window_foreground_changed');
  expect(mocks.spawn).toHaveBeenCalledTimes(2);
  expect(mocks.fetch.mock.calls.some(([, options]) => options?.body?.includes('select-tab'))).toBe(false);
});
