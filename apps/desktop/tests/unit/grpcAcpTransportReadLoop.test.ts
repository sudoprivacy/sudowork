import { describe, expect, it, vi } from 'vitest';

// The GrpcAcpTransport stdout reader is a blocking long-poll loop (nexus #219):
// data → deliver + advance offset; eof (nothing ready / long-poll timeout) →
// re-read the SAME offset; a client rejection (is_error) → disconnect. This
// locks that contract in fast CI (the live path is the linux-e2e integration
// test, which only runs in the slower e2e leg).

type ReadStep = { data?: Buffer; nextOffset?: string; eof?: boolean; reject?: boolean };

async function loadTransport(readSeq: ReadStep[]) {
  vi.resetModules();
  const streamReadAtCalls: Array<{ offset: string; blocking?: boolean; timeoutMs?: number }> = [];
  let i = 0;
  const client = {
    call: vi.fn(async (method: string) => (method === 'managed_agent.start_session_v1' ? { session_id: 's1', os_pid: 7 } : {})),
    streamReadAt: vi.fn(async (_path: string, offset: string, opts: { blocking?: boolean; timeoutMs?: number } = {}) => {
      streamReadAtCalls.push({ offset, blocking: opts.blocking, timeoutMs: opts.timeoutMs });
      const step = readSeq[Math.min(i, readSeq.length - 1)];
      i += 1;
      if (step.reject) throw new Error('stream closed');
      return { data: step.data ?? Buffer.alloc(0), nextOffset: step.nextOffset ?? offset, eof: step.eof ?? false };
    }),
    streamWrite: vi.fn(async () => {}),
    close: vi.fn(),
  };
  vi.doMock('@common/nexus/nexusVfsGrpcClient', () => ({
    NexusVfsGrpcClient: vi.fn(function () {
      return client;
    }),
  }));
  const mod = await import('@/agent/acp/transport');
  return { GrpcAcpTransport: mod.GrpcAcpTransport, client, streamReadAtCalls };
}

const frame = (method: string): Buffer => Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`, 'utf-8');

describe('GrpcAcpTransport blocking long-poll reader', () => {
  it('delivers frames, re-reads the same offset on eof, disconnects on error — all via blocking reads', async () => {
    const { GrpcAcpTransport, streamReadAtCalls } = await loadTransport([
      { data: frame('a'), nextOffset: '30', eof: false }, // deliver a → advance to 30
      { data: Buffer.alloc(0), nextOffset: '30', eof: true }, // idle/timeout → re-read same offset 30
      { data: frame('b'), nextOffset: '60', eof: false }, // deliver b → advance to 60
      { reject: true }, // stream closed → disconnect
    ]);

    const msgs: string[] = [];
    let closed = false;
    const t = new GrpcAcpTransport({
      endpoint: '127.0.0.1:1',
      authToken: '',
      agentId: 'x',
      spawnSpec: { cmd: 'x', args: [], env: {}, cwd: '/' },
      events: {
        onMessage: (m) => msgs.push((m as { method: string }).method),
        onClose: () => {
          closed = true;
        },
        onSetupError: () => {},
      },
    });

    await t.connect();
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !closed) await new Promise((r) => setTimeout(r, 10));

    expect(msgs).toEqual(['a', 'b']); // both frames delivered, idle frame carried nothing
    expect(closed).toBe(true); // is_error rejection = real disconnect
    expect(streamReadAtCalls.every((c) => c.blocking === true)).toBe(true); // long-poll, not the old 30ms non-blocking poll
    expect(streamReadAtCalls.map((c) => c.offset)).toEqual(['0', '30', '30', '60']); // eof → same offset re-read
  });
});
