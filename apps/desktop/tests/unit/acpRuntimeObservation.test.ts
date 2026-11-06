import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@process/telemetry', () => ({ recordFirstToken: vi.fn() }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn() }));
vi.mock('@process/utils/shellEnv', () => ({ resolveNpxPath: vi.fn() }));
vi.mock('@process/services/authProxy', () => ({ ensureLocalAgentApiPort: vi.fn(), getCredentialProxyUrl: vi.fn(), registerToken: vi.fn(), revokeToken: vi.fn() }));
vi.mock('@/agent/acp/acpConnectors', () => ({ connectClaude: vi.fn(), connectCodebuddy: vi.fn(), connectCodex: vi.fn(), prepareCleanEnv: vi.fn(), spawnGenericBackend: vi.fn() }));

import { AcpConnection } from '@/agent/acp/AcpConnection';

const background = { terminals: 0, agents: 0, execution_unconfirmed: 0, tool_operations: 0 };

function connect(sessionId = 'shared-sid', version: unknown = 1) {
  const connection = new AcpConnection();
  const sent: Array<{ id: number; method: string; params: unknown }> = [];
  const transport = { connected: true, send: vi.fn((request) => sent.push(request)), close: vi.fn() };
  // Keep the production JSON-RPC request/correlation/timeout handling intact.
  const harness = connection as unknown as { transport: typeof transport; sessionId: string; initializeResponse: unknown; handleMessage: (response: unknown) => void; closeTransport: () => Promise<void> };
  harness.transport = transport;
  harness.sessionId = sessionId;
  harness.initializeResponse = { _meta: { sudocode: { runtimeStatus: { version } } } };
  const reply = (result: unknown) => harness.handleMessage({ jsonrpc: '2.0', id: sent.at(-1)!.id, result });
  return { connection, harness, transport, sent, reply };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('negotiated ACP runtime observations', () => {
  it('observes quiet work and typed input waits without sending a prompt or changing background counts', async () => {
    const { connection, sent, reply } = connect();
    for (const foreground of [{ state: 'running' }, { state: 'awaiting_input', waiting_for: 'question' }, { state: 'awaiting_input', waiting_for: 'permission' }, { state: 'idle' }]) {
      const pending = connection.getRuntimeObservation();
      const snapshot = { foreground, background: { ...background, terminals: 1, agents: 2, execution_unconfirmed: 3, tool_operations: 4 } };
      reply(snapshot);
      await expect(pending).resolves.toMatchObject({ availability: 'available', sessionId: 'shared-sid', snapshot });
    }
    expect(sent).toHaveLength(4);
    expect(sent.every((request) => request.method === '_sudocode/session/status' && (request.params as { sessionId: string }).sessionId === 'shared-sid')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never probes unsupported, future-version or disconnected hosts', async () => {
    for (const version of [undefined, 0, 2, '1']) {
      const { connection, sent } = connect('sid', version);
      // An absent capability is distinct from the helper's default argument.
      if (version === undefined) (connection as unknown as { initializeResponse: unknown }).initializeResponse = {};
      await expect(connection.getRuntimeObservation()).resolves.toMatchObject({ availability: 'unsupported' });
      expect(sent).toEqual([]);
    }
    const { connection, transport, sent } = connect();
    transport.connected = false;
    await expect(connection.getRuntimeObservation()).resolves.toMatchObject({ availability: 'unattached' });
    expect(sent).toEqual([]);
  });

  it('rejects a delayed same-SID response after the owning transport is replaced', async () => {
    const { connection, harness, transport, reply } = connect();
    const pending = connection.getRuntimeObservation();
    harness.transport = { ...transport, send: vi.fn() };
    reply({ foreground: { state: 'idle' }, background });
    await expect(pending).resolves.toMatchObject({ availability: 'changed' });
    expect((await pending).snapshot).toBeUndefined();
  });

  it('preserves separate incarnations for two engines with the same SID', async () => {
    const first = connect();
    const second = connect();
    const pendingA = first.connection.getRuntimeObservation();
    const pendingB = second.connection.getRuntimeObservation();
    first.reply({ foreground: { state: 'running' }, background });
    second.reply({ foreground: { state: 'idle' }, background });
    const [a, b] = await Promise.all([pendingA, pendingB]);
    expect(a.sessionId).toBe(b.sessionId);
    expect(a.instanceId).not.toBe(b.instanceId);
    expect(a.snapshot?.foreground.state).toBe('running');
    expect(b.snapshot?.foreground.state).toBe('idle');
  });

  it('deduplicates simultaneous reads and reports timeout as unknown without retrying', async () => {
    const { connection, sent } = connect();
    const first = connection.getRuntimeObservation();
    const second = connection.getRuntimeObservation();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(first).resolves.toMatchObject({ availability: 'unreachable' });
    await expect(second).resolves.toMatchObject({ availability: 'unreachable' });
    expect(sent).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { foreground: { state: 'idle', waiting_for: 'question' }, background },
    { foreground: { state: 'awaiting_input' }, background },
    { foreground: { state: 'sleeping' }, background },
    { foreground: { state: 'idle' }, background: { ...background, terminals: -1 } },
    { foreground: { state: 'idle' }, background: { ...background, tool_operations: 0.5 } },
    { foreground: { state: 'idle' }, background: {} },
  ])('keeps invalid host facts unknown: %j', async (snapshot) => {
    const { connection, reply } = connect();
    const pending = connection.getRuntimeObservation();
    reply(snapshot);
    await expect(pending).resolves.toMatchObject({ availability: 'invalid' });
    expect((await pending).snapshot).toBeUndefined();
  });
});
