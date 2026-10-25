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
function sourceReceipt() {
  return {
    contract: { revision: 'r1', namespace: 'support', model: 'source request', baseline: { sha256: 'source-pin' } },
    registration: {
      format: 'sudograph-source-registration/v1',
      operation_id: 'connect-1',
      initial_revision: 'r1',
      connection: { status: 'connected', provider: 'sqlite', source: 'source-1' },
      scan: { status: 'complete', structure_complete: true, inventory_exhausted: true, objects: 2, fields: 4 },
      records: { delivery: 'live', export_complete: false, rows_embedded: 0 },
    },
  };
}
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

  it('uses the private registration worker and forces on-demand record delivery', async () => {
    const process = child();
    const pending = new SudographModelClient(runtime).registerSource('registered', 'host-alice', { source: 'sqlite:///private-source.db', namespace: 'support', operationId: 'connect-1', language: 'en' });
    expect(mocks.spawn).toHaveBeenCalledWith('/operator/python', ['-m', 'compiler.registration', '--store', path.join('/operator/models', 'registered.db'), '--actor', 'host-alice'], expect.objectContaining({ cwd: '/operator/compiler', windowsHide: true }));
    expect(JSON.parse(process.stdin.read().toString())).toEqual({ source: 'sqlite:///private-source.db', namespace: 'support', operation_id: 'connect-1', language: 'en', snapshot_records: false });
    process.stdout.write(JSON.stringify({ ok: true, result: sourceReceipt() }));
    process.emit('close', 0);
    await expect(pending).resolves.toMatchObject({ registration: { initial_revision: 'r1' } });
  });

  it('preserves registration conflicts and refuses unsafe model references before starting a scan', async () => {
    const client = new SudographModelClient(runtime);
    const input = { source: 'sqlite:///private-source.db', namespace: 'support', operationId: 'connect-1', language: 'en' as const };
    await expect(client.registerSource('../another', 'host-alice', input)).rejects.toThrow('binding');
    expect(mocks.spawn).not.toHaveBeenCalled();
    const process = child();
    const pending = client.registerSource('registered', 'host-alice', input);
    process.stdout.write(JSON.stringify({ ok: false, error: { code: 'REGISTRATION_CONFLICT', reason: 'Another source owns this model', recovery: 'Open the existing project' } }));
    process.emit('close', 0);
    await expect(pending).rejects.toMatchObject({ code: 'REGISTRATION_CONFLICT', recovery: 'Open the existing project' });
  });

  it.each(['partial', 'records', 'namespace', 'operation'])('refuses a successful envelope with an invalid %s receipt', async (kind) => {
    const process = child();
    const pending = new SudographModelClient(runtime).registerSource('registered', 'host-alice', { source: 'sqlite:///private-source.db', namespace: 'support', operationId: 'connect-1', language: 'en' });
    const receipt = sourceReceipt();
    if (kind === 'partial') receipt.registration.scan.structure_complete = false;
    if (kind === 'records') receipt.registration.records.rows_embedded = 1;
    if (kind === 'namespace') receipt.contract.namespace = 'another';
    if (kind === 'operation') receipt.registration.operation_id = 'another';
    process.stdout.write(JSON.stringify({ ok: true, result: receipt }));
    process.emit('close', 0);
    await expect(pending).rejects.toMatchObject({ code: 'REGISTRATION_RECEIPT_INVALID' });
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
