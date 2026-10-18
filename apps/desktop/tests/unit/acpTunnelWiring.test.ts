import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// A configured Nexus endpoint uses the session mailbox and fails closed.

type ConnectImpl = () => Promise<void>;
type SpawnImpl = () => Promise<unknown>;

async function loadAcpConnection(opts: { grpcConnect: ConnectImpl; spawnGeneric: SpawnImpl; localApiPort?: number }) {
  vi.resetModules();
  vi.doMock('@process/telemetry', () => ({ recordFirstToken: vi.fn() }));
  const mainLog = vi.fn();
  const mainWarn = vi.fn();
  vi.doMock('@process/utils/mainLogger', () => ({ mainLog, mainWarn }));
  vi.doMock('@process/utils/shellEnv', () => ({ resolveNpxPath: vi.fn(() => 'npx') }));
  vi.doMock('@process/services/authProxy', () => ({
    ensureLocalAgentApiPort: vi.fn(async () => opts.localApiPort ?? null),
    getCredentialProxyUrl: vi.fn(() => null),
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
  const grpcOptions: Array<{ agentId: string }> = [];
  class MockScodeAcpTransport {
    constructor(options: { agentId: string }) {
      grpcOptions.push(options);
    }
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
    ScodeAcpTransport: MockScodeAcpTransport,
    StdioAcpTransport: MockStdioAcpTransport,
  }));

  const mod = await import('@/agent/acp/AcpConnection');
  return { AcpConnection: mod.AcpConnection, grpcClose, grpcConnect, spawnGeneric, buildSpec, mainLog, mainWarn, grpcSent, grpcOptions };
}

describe('AcpConnection Nexus session routing', () => {
  it.each([false, true])('isolates ontology mailboxes across reconnects without changing ordinary identities: ontology=%s', async (isOntologySession) => {
    const fixture = await loadAcpConnection({ grpcConnect: async () => {}, spawnGeneric: async () => {} });
    const connection = new fixture.AcpConnection({ isOntologySession });
    connection.conversationId = 'existing-chat';
    connection.managedAgentId = 'personal-agent';
    const harness = connection as unknown as { initialize: () => Promise<void>; sendRequest: ReturnType<typeof vi.fn> };
    harness.initialize = async () => {};
    const tools = [{ name: 'ontology-agent', command: '/node' }];
    const workspace = path.resolve('original-workspace');
    for (let attempt = 0; attempt < 2; attempt++) {
      await connection.connect('scode', '/scode', workspace, ['acp'], { SCODE_MANAGED_SERVICE: '1' });
      harness.sendRequest = vi.fn().mockResolvedValue({});
      await connection.loadSession('original-acp-history', workspace, tools);
      expect(harness.sendRequest).toHaveBeenCalledWith('session/load', expect.objectContaining({ sessionId: 'original-acp-history', cwd: workspace, mcpServers: tools }));
      await connection.disconnect();
    }
    const ids = fixture.grpcOptions.map((options) => options.agentId);
    if (isOntologySession) {
      expect(ids[0]).toMatch(/^sudowork-ontology-existing-chat-/);
      expect(ids[1]).not.toBe(ids[0]);
    } else {
      expect(ids).toEqual(['personal-agent', 'personal-agent']);
    }
  });
  it('gives online local agents a media endpoint without a credential proxy', async () => {
    const { AcpConnection, spawnGeneric } = await loadAcpConnection({
      localApiPort: 43210,
      grpcConnect: () => Promise.resolve(),
      spawnGeneric: () => Promise.reject(new Error('LOCAL_SPAWN_REACHED')),
    });
    await expect(new AcpConnection().connect('scode', '/opt/scode', '/tmp/ws', [], {})).rejects.toThrow('LOCAL_SPAWN_REACHED');
    expect(spawnGeneric).toHaveBeenCalledWith('scode', '/opt/scode', '/tmp/ws', [], expect.objectContaining({ SUDOWORK_AUTH_PROXY_BASE_URL: 'http://127.0.0.1:43210', SUDOWORK_AUTH_PROXY_TOKEN: expect.any(String) }));
    expect(spawnGeneric.mock.calls[0]).not.toEqual(expect.arrayContaining([expect.objectContaining({ SUDOWORK_AUTH_PROXY_URL: expect.anything() })]));
  });

  it('reports mailbox connection failure without spawning locally', async () => {
    const { AcpConnection, grpcClose, grpcConnect, spawnGeneric, buildSpec } = await loadAcpConnection({
      grpcConnect: () => Promise.reject(new Error('MAILBOX_UNAVAILABLE')),
      spawnGeneric: () => Promise.reject(new Error('LOCAL_SPAWN_MUST_NOT_RUN')),
    });
    const connection = new AcpConnection();
    await expect(connection.connect('scode', '/opt/scode', '/tmp/ws', [], { SCODE_MANAGED_SERVICE: '1' })).rejects.toThrow('MAILBOX_UNAVAILABLE');
    expect(buildSpec).toHaveBeenCalledTimes(1);
    expect(grpcConnect).toHaveBeenCalledTimes(1);
    expect(grpcClose).toHaveBeenCalledTimes(1);
    expect(spawnGeneric).not.toHaveBeenCalled();
  });

  it('reports the connected Sudocode session service after initialize', async () => {
    const ok = await loadAcpConnection({
      grpcConnect: () => Promise.resolve(),
      spawnGeneric: () => Promise.reject(new Error('LOCAL_SPAWN_MUST_NOT_RUN')),
    });
    const connection = new ok.AcpConnection();
    const connecting = connection.connect('scode', '/opt/scode', '/tmp/ws', [], {
      SCODE_MANAGED_SERVICE: '1',
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
    expect(ok.mainLog).toHaveBeenCalledWith('[ACP]', expect.stringContaining("Sudocode's session service"));
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
    await connection.connect('claude', undefined, '/tmp/ws', [], { SCODE_MANAGED_SERVICE: '1' });

    expect(grpcConnect).not.toHaveBeenCalled();
  });
});
