import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSudographModelClient, SudographCompilerError, SudographModelClient } from '@process/services/ontology/SudographModelClient';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));

function child() {
  const process = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  mocks.spawn.mockReturnValue(process);
  return process;
}

const runtime = { python: '/operator/python', compilerRoot: '/operator/compiler', modelDirectory: '/operator/models' };
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('Sudograph host compiler transport', () => {
  it('binds the worker to registered paths and the host actor', async () => {
    const process = child();
    const pending = new SudographModelClient(runtime).invoke('registered', 'alice', { operation: 'contract' });
    expect(mocks.spawn).toHaveBeenCalledWith('/operator/python', ['-m', 'compiler.workspace', '--store', path.join('/operator/models', 'registered.db'), '--actor', 'alice'], expect.objectContaining({ cwd: '/operator/compiler', windowsHide: true }));
    expect(process.stdin.read().toString()).toBe('{"operation":"contract"}\n');
    process.stdout.write('{"ok":true,"result":{"revision":"r1"}}\n');
    process.emit('close', 0);
    await expect(pending).resolves.toEqual({ revision: 'r1' });
  });

  it('preserves actionable compiler conflicts instead of reporting success', async () => {
    const process = child();
    const pending = new SudographModelClient(runtime).invoke('registered', 'alice', { operation: 'apply' });
    process.stdout.write(JSON.stringify({ ok: false, error: { code: 'MODEL_CONFLICT', reason: 'Same definition changed', recovery: { paths: ['definitions.refund'] } } }));
    process.emit('close', 0);
    await expect(pending).rejects.toMatchObject({ code: 'MODEL_CONFLICT', recovery: { paths: ['definitions.refund'] } });
    await expect(pending).rejects.toBeInstanceOf(SudographCompilerError);
  });

  it('refuses path-like model references before spawning any process', async () => {
    for (const modelRef of ['../another', 'C:\\another', '', '/absolute']) await expect(new SudographModelClient(runtime).invoke(modelRef, 'alice', {})).rejects.toThrow('binding');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('reports worker crashes and missing deployment configuration explicitly', async () => {
    const process = child();
    const pending = new SudographModelClient(runtime).invoke('registered', 'alice', {});
    process.stderr.write('worker unavailable');
    process.emit('close', 1);
    await expect(pending).rejects.toThrow('worker unavailable');
    vi.stubEnv('SUDOGRAPH_PYTHON', '');
    vi.stubEnv('SUDOGRAPH_COMPILER_ROOT', '');
    vi.stubEnv('SUDOGRAPH_MODEL_DIRECTORY', '');
    expect(() => getSudographModelClient()).toThrow('not configured');
  });
});
