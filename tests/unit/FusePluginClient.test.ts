import { describe, it, expect, vi } from 'vitest';

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

// The Nexus client transitively loads `electron` via its native-binding
// resolver. Tests never need the real one — every call we exercise here
// goes through the injected fake client. Stub the module exports so
// `import` doesn't blow up at module load.
vi.mock('@common/nexus/nexus-vfs-client', () => ({
  getNexusRpcClient: () => ({ callBinary: vi.fn() }),
}));

import { FusePluginClient } from '../../src/process/services/nexus-vfs/FusePluginClient';

function makeNexus(callBinary: (method: string, payload: Buffer) => Buffer | Error): { callBinary: ReturnType<typeof vi.fn> } {
  const fn = vi.fn((method: string, payload: Buffer) => {
    const result = callBinary(method, payload);
    if (result instanceof Error) throw result;
    return result;
  });
  return { callBinary: fn };
}

describe('FusePluginClient.getStatus', () => {
  it('dispatches to the `fuse.status` method with an empty payload', async () => {
    const nexus = makeNexus(() => Buffer.from('mounted', 'utf-8'));
    const client = new FusePluginClient(nexus as never);

    await client.getStatus();

    expect(nexus.callBinary).toHaveBeenCalledTimes(1);
    const [method, payload] = nexus.callBinary.mock.calls[0];
    // Routing convention `<plugin-name>.<method>` matches the nexus
    // cluster's Call RPC handler. The plugin name `fuse` is the
    // string passed to `declare_service_plugin!` in
    // nexi-lab/nexus rust/services/fuse-plugin/src/lib.rs:409.
    expect(method).toBe('fuse.status');
    expect(Buffer.isBuffer(payload)).toBe(true);
    expect((payload as Buffer).length).toBe(0);
  });

  it('parses `mounted` into status mounted', async () => {
    const client = new FusePluginClient(makeNexus(() => Buffer.from('mounted', 'utf-8')) as never);
    expect(await client.getStatus()).toEqual({ status: 'mounted', raw: 'mounted' });
  });

  it('parses `unmounted` into status unmounted', async () => {
    const client = new FusePluginClient(makeNexus(() => Buffer.from('unmounted', 'utf-8')) as never);
    expect(await client.getStatus()).toEqual({ status: 'unmounted', raw: 'unmounted' });
  });

  it('parses `fuse-t-missing` into the dedicated missing-prereq status', async () => {
    // This is the contract that lets the supervisor decide to fire
    // `fuseTInstallService.ensureInstalled()`. If the wire format
    // ever drifts (e.g. plugin starts returning `fuse_t-missing`
    // with an underscore) the supervisor stops working — fail loud.
    const client = new FusePluginClient(makeNexus(() => Buffer.from('fuse-t-missing', 'utf-8')) as never);
    expect(await client.getStatus()).toEqual({ status: 'fuse-t-missing', raw: 'fuse-t-missing' });
  });

  it('trims trailing whitespace before matching', async () => {
    // The plugin currently emits exact bytes, but a future
    // `eprintln!`-style helper could append a newline. Be tolerant
    // so a one-byte appendage doesn't downgrade a real `mounted`
    // reply to `unknown`.
    const client = new FusePluginClient(makeNexus(() => Buffer.from('mounted\n', 'utf-8')) as never);
    expect((await client.getStatus()).status).toBe('mounted');
  });

  it('returns `unknown` when the plugin replies with something unrecognised', async () => {
    const client = new FusePluginClient(makeNexus(() => Buffer.from('libfuse3-missing', 'utf-8')) as never);
    const result = await client.getStatus();
    expect(result.status).toBe('unknown');
    // Raw bytes are kept so a future supervisor extension can match
    // `libfuse3-missing` without a client-side change being needed
    // to surface the bytes (we only need to extend the union).
    expect(result.raw).toBe('libfuse3-missing');
  });

  it('collapses dispatch errors to status `unknown` instead of throwing', async () => {
    // Cluster restarting, plugin unloaded, ABI-mismatch UNIMPLEMENTED:
    // none of these mean "FUSE-T is missing". Surfacing them as
    // `unknown` keeps the supervisor from prompting for an admin
    // password on a transient cluster outage.
    const client = new FusePluginClient(makeNexus(() => new Error('UNIMPLEMENTED: fuse.status')) as never);
    const result = await client.getStatus();
    expect(result.status).toBe('unknown');
    expect(result.raw).toContain('UNIMPLEMENTED');
  });
});
