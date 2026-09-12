import { describe, expect, it, vi } from 'vitest';

// Covers the ACP → nexus cutover wiring added alongside the nexusd-cluster
// repoint: AcpConnection.doConnect routes scode through the managed_agent
// tunnel when ACP_GRPC_ENDPOINT is set, and degrades to a local spawn if the
// tunnel connect fails — the tunnel is an optimization, never a hard dep.

type ConnectImpl = () => Promise<void>;
type SpawnImpl = () => Promise<unknown>;

async function loadAcpConnection(opts: { grpcConnect: ConnectImpl; spawnGeneric: SpawnImpl }) {
  vi.resetModules();
  vi.doMock('@process/telemetry', () => ({ recordFirstToken: vi.fn() }));
  const mainLog = vi.fn();
  const mainWarn = vi.fn();
  vi.doMock('@process/utils/mainLogger', () => ({ mainLog, mainWarn }));
  vi.doMock('@process/utils/shellEnv', () => ({ resolveNpxPath: vi.fn(() => 'npx') }));
  vi.doMock('@process/services/authProxy', () => ({
    getAuthProxyPort: vi.fn(() => null),
    registerToken: vi.fn(),
    revokeToken: vi.fn(),
  }));
  vi.doMock('@/agent/acp/modelInfo', () => ({
    buildAcpModelInfo: vi.fn(() => null),
    summarizeAcpModelInfo: vi.fn(() => null),
  }));
  vi.doMock('@/agent/acp/perf', () => ({ ACP_PERF_LOG: false }));

  const grpcConnect = vi.fn(opts.grpcConnect);
  const grpcClose = vi.fn().mockResolvedValue(undefined);
  const spawnGeneric = vi.fn(opts.spawnGeneric);
  const buildSpec = vi.fn().mockResolvedValue({ cmd: 'scode', args: [], env: {}, cwd: '/tmp/ws' });

  vi.doMock('@/agent/acp/acpConnectors', () => ({
    createGenericSpawnConfig: vi.fn(),
    buildGenericSpawnSpec: buildSpec,
    connectClaude: vi.fn(),
    connectCodebuddy: vi.fn(),
    connectCodex: vi.fn(),
    prepareCleanEnv: vi.fn(() => process.env),
    spawnGenericBackend: spawnGeneric,
  }));

  const grpcSent: Array<{ id?: number; method?: string }> = [];
  class MockGrpcAcpTransport {
    connect = grpcConnect;
    close = grpcClose;
    send = vi.fn((message: { id?: number; method?: string }) => {
      grpcSent.push(message);
    });
    get connected() {
      return false;
    }
    get pid() {
      return undefined;
    }
  }
  class MockStdioAcpTransport {
    send = vi.fn();
    close = vi.fn().mockResolvedValue(undefined);
    getStderr() {
      return '';
    }
    get connected() {
      return true;
    }
    get pid() {
      return 4242;
    }
  }
  vi.doMock('@/agent/acp/transport', () => ({
    GrpcAcpTransport: MockGrpcAcpTransport,
    StdioAcpTransport: MockStdioAcpTransport,
  }));

  const mod = await import('@/agent/acp/AcpConnection');
  return { AcpConnection: mod.AcpConnection, grpcConnect, spawnGeneric, buildSpec, mainLog, mainWarn, grpcSent };
}

describe('AcpConnection nexus-tunnel routing', () => {
  it('falls back to a local spawn when the tunnel connect fails', async () => {
    // grpc tunnel unavailable (e.g. daemon lacks managed_agent) → the local
    // spawn path must run. It rejects with a distinct marker so we can prove
    // control flow reached it after the tunnel failure.
    const { AcpConnection, grpcConnect, spawnGeneric, buildSpec } = await loadAcpConnection({
      grpcConnect: () => Promise.reject(new Error('TUNNEL_UNAVAILABLE')),
      spawnGeneric: () => Promise.reject(new Error('LOCAL_SPAWN_REACHED')),
    });
    const connection = new AcpConnection();

    await expect(connection.connect('scode', '/opt/scode', '/tmp/ws', [], { ACP_GRPC_ENDPOINT: '127.0.0.1:65535' })).rejects.toThrow('LOCAL_SPAWN_REACHED');

    expect(buildSpec).toHaveBeenCalledTimes(1); // tunnel path built the spawn-spec
    expect(grpcConnect).toHaveBeenCalledTimes(1); // tunnel connect was attempted
    expect(spawnGeneric).toHaveBeenCalledTimes(1); // …then fell back to local spawn
  });

  it('says which path a session took, in both directions', async () => {
    // The defect this pins: two of the three outcomes used to be silent, so a
    // session that never reached nexus read exactly like one that ran wholly
    // over the tunnel. Asserting the log IS the regression guard — there is no
    // other artefact that distinguishes them after the fact.
    const failed = await loadAcpConnection({
      grpcConnect: () => Promise.reject(new Error('TUNNEL_UNAVAILABLE')),
      spawnGeneric: () => Promise.reject(new Error('LOCAL_SPAWN_REACHED')),
    });
    await expect(new failed.AcpConnection().connect('scode', '/opt/scode', '/tmp/ws', [], { ACP_GRPC_ENDPOINT: '127.0.0.1:65535' })).rejects.toThrow('LOCAL_SPAWN_REACHED');
    expect(failed.mainWarn).toHaveBeenCalledWith('[ACP]', expect.stringContaining('falling back to local spawn'));

    const ok = await loadAcpConnection({
      grpcConnect: () => Promise.resolve(),
      spawnGeneric: () => Promise.reject(new Error('LOCAL_SPAWN_MUST_NOT_RUN')),
    });
    const connection = new ok.AcpConnection();
    const connecting = connection.connect('scode', '/opt/scode', '/tmp/ws', [], {
      ACP_GRPC_ENDPOINT: '127.0.0.1:12022',
    });
    // The tunnel connects, then the ACP handshake runs. Answer it, or the
    // connect never resolves and the success line is never reached.
    await vi.waitFor(() => {
      expect(ok.grpcSent.some((m) => m.method === 'initialize')).toBe(true);
    });
    const init = ok.grpcSent.find((m) => m.method === 'initialize')!;
    (connection as unknown as { handleMessage: (m: unknown) => void }).handleMessage({
      jsonrpc: '2.0',
      id: init.id,
      result: { protocolVersion: 1 },
    });
    await connecting;

    expect(ok.spawnGeneric).not.toHaveBeenCalled();
    // Names the endpoint, so the log says WHICH daemon served it, not merely
    // that something did.
    expect(ok.mainLog).toHaveBeenCalledWith('[ACP]', expect.stringContaining('127.0.0.1:12022'));
  });

  it('never attempts the tunnel when no endpoint is advertised', async () => {
    const { AcpConnection, grpcConnect, spawnGeneric } = await loadAcpConnection({
      grpcConnect: () => Promise.resolve(),
      spawnGeneric: () => Promise.reject(new Error('LOCAL_SPAWN_REACHED')),
    });
    const connection = new AcpConnection();

    await expect(connection.connect('scode', '/opt/scode', '/tmp/ws', [], {})).rejects.toThrow('LOCAL_SPAWN_REACHED');

    expect(grpcConnect).not.toHaveBeenCalled(); // no ACP_GRPC_ENDPOINT ⇒ straight to local
    expect(spawnGeneric).toHaveBeenCalledTimes(1);
  });

  it('never tunnels npx bridges even when an endpoint is advertised', async () => {
    // claude/codex/codebuddy are npx bridges that must spawn locally; the
    // tunnel is scoped to direct-CLI backends.
    const { AcpConnection, grpcConnect } = await loadAcpConnection({
      grpcConnect: () => Promise.resolve(),
      spawnGeneric: () => Promise.reject(new Error('unused')),
    });
    const connection = new AcpConnection();

    // connectClaude is mocked to a no-op, so connect resolves; the point is the
    // tunnel was NOT dialed for an npx backend.
    await connection.connect('claude', undefined, '/tmp/ws', [], { ACP_GRPC_ENDPOINT: '127.0.0.1:65535' });

    expect(grpcConnect).not.toHaveBeenCalled();
  });
});

describe('DynamicNexusVfsService.acpTunnelEndpoint', () => {
  async function loadService() {
    vi.resetModules();
    const { dynamicNexusVfsService } = await import('@process/services/nexus-vfs/DynamicNexusVfsService');
    return dynamicNexusVfsService as unknown as { _running: boolean; _port: number; acpTunnelEndpoint: string | null };
  }

  it('is null when the daemon is not running', async () => {
    const svc = await loadService();
    svc._running = false;
    svc._port = 12022;
    expect(svc.acpTunnelEndpoint).toBeNull();
  });

  it('is null when running without a bound port', async () => {
    const svc = await loadService();
    svc._running = true;
    svc._port = 0;
    expect(svc.acpTunnelEndpoint).toBeNull();
  });

  it('is the loopback host:port when the daemon is serving', async () => {
    const svc = await loadService();
    svc._running = true;
    svc._port = 12022;
    expect(svc.acpTunnelEndpoint).toBe('127.0.0.1:12022');
  });
});
