import { describe, expect, it, vi } from 'vitest';
import type { NexusSessionEndpoint, SessionRpcMessage } from '@nexus-ai-fs/vfs-client';

const endpoint: NexusSessionEndpoint = {
  protocol: 'acp-mailbox/1',
  channel_id: 'connection-1',
  agent: 'worker',
  controller: 'operator',
  transcript: '/conversations/0123456789abcdef0123456789abcdef/transcript',
};

async function loadTransport(supportsMailbox = true) {
  vi.resetModules();
  let events: { onMessage: (message: SessionRpcMessage) => void; onClose: (error?: Error) => void } | undefined;
  const mailbox = { connected: true, start: vi.fn(), send: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const client = {
    call: vi.fn(async (method: string) => (method === 'managed_agent.start_session_v1' ? { session_id: 'pid-1', os_pid: 7, ...(supportsMailbox ? { session_endpoint: endpoint } : {}) } : {})),
    openSession: vi.fn((_endpoint: NexusSessionEndpoint, handlers: NonNullable<typeof events>) => {
      events = handlers;
      return mailbox;
    }),
    close: vi.fn(),
  };
  vi.doMock('@common/nexus/nexusVfsGrpcClient', () => ({
    NexusVfsGrpcClient: vi.fn(function () {
      return client;
    }),
  }));
  const { NexusAcpTransport } = await import('@/agent/acp/transport');
  return { NexusAcpTransport, client, mailbox, getEvents: () => events! };
}

describe('Nexus session mailbox transport', () => {
  it.each([false, true])('uses the same transport with subprocess hosting=%s', async (subprocess) => {
    const { NexusAcpTransport, client, mailbox, getEvents } = await loadTransport();
    const onMessage = vi.fn();
    const onClose = vi.fn();
    const transport = new NexusAcpTransport({
      endpoint: 'localhost:1',
      authToken: '',
      agentId: 'worker',
      ...(subprocess ? { spawnSpec: { cmd: 'scode', args: ['acp'], env: {}, cwd: '/' } } : {}),
      events: { onMessage, onClose, onSetupError: vi.fn() },
    });
    await transport.connect();
    expect(client.openSession).toHaveBeenCalledWith(endpoint, expect.any(Object));
    expect(mailbox.start).toHaveBeenCalledOnce();
    const permission: SessionRpcMessage = { jsonrpc: '2.0', id: 0, method: 'session/request_permission', params: { sessionId: 'durable' } };
    getEvents().onMessage(permission);
    expect(onMessage).toHaveBeenCalledWith(permission);
    const answer = { jsonrpc: '2.0', id: 0, result: { outcome: { outcome: 'cancelled' } } };
    transport.send(answer);
    expect(mailbox.send).toHaveBeenCalledWith(answer);
    await transport.close();
    expect(mailbox.close).toHaveBeenCalledOnce();
    expect(client.call).toHaveBeenLastCalledWith('managed_agent.cancel_v1', { session_id: 'pid-1', mode: 'session' });
    expect(client.close).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refuses an old daemon and reaps the process it created', async () => {
    const { NexusAcpTransport, client } = await loadTransport(false);
    const onSetupError = vi.fn();
    const transport = new NexusAcpTransport({ endpoint: 'localhost:1', authToken: '', agentId: 'worker', events: { onMessage: vi.fn(), onClose: vi.fn(), onSetupError } });
    await expect(transport.connect()).rejects.toThrow('does not support session mailboxes');
    expect(client.openSession).not.toHaveBeenCalled();
    expect(client.call).toHaveBeenLastCalledWith('managed_agent.cancel_v1', { session_id: 'pid-1', mode: 'session' });
    expect(onSetupError).toHaveBeenCalledOnce();
  });
});
