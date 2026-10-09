import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MossWsConnection } from '@/agent/remote/MossWsConnection';

interface TestSocket {
  url: string;
  sent: unknown[];
  emit: (event: string, ...args: unknown[]) => boolean;
}

const state = vi.hoisted(() => ({ sockets: [] as TestSocket[] }));

vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  class SessionSocket extends EventEmitter {
    static readonly OPEN = 1;
    readyState = SessionSocket.OPEN;
    readonly sent: unknown[] = [];

    constructor(readonly url: string) {
      super();
      state.sockets.push(this);
      queueMicrotask(() => this.emit('open'));
    }

    send(payload: string): void {
      this.sent.push(JSON.parse(payload));
    }

    close(): void {
      this.readyState = 3;
      this.emit('close', 1000);
    }
  }
  return { default: SessionSocket };
});

vi.mock('@/process/bridge/eeclawBridge', () => ({ getValidToken: vi.fn(async () => 'test-token') }));
vi.mock('@/process/initStorage', () => ({ ProcessConfig: { getSync: vi.fn() } }));
vi.mock('@/process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainError: vi.fn() }));

const sessions = ['session-a', 'session-b'];
let connections: MossWsConnection[];
let callbacks: Array<{ onMessage: ReturnType<typeof vi.fn>; onPermissionRequest: ReturnType<typeof vi.fn> }>;

function receive(socketIndex: number, frame: unknown): void {
  state.sockets[socketIndex].emit('message', Buffer.from(JSON.stringify(frame)));
}

describe('desktop conversations belonging to the same agent', () => {
  beforeEach(async () => {
    state.sockets = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('Resuming a session must not create another session');
      })
    );
    callbacks = sessions.map(() => ({ onMessage: vi.fn(), onPermissionRequest: vi.fn() }));
    connections = sessions.map(
      (sessionId, index) =>
        new MossWsConnection(
          {
            serverUrl: 'https://moss.test',
            assistantName: 'user-owner',
            sessionId,
            wsUrl: `wss://moss.test/ws/sessions/${sessionId}`,
          },
          callbacks[index]
        )
    );
    // Open sequentially so socket indexes remain deterministic.
    for (const connection of connections) await connection.connect();
  });

  afterEach(() => {
    for (const connection of connections) connection.disconnect();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('routes messages and interleaved tool events to their own session', () => {
    connections[0].sendMessage({ content: 'First task', msg_id: 'message-1' });
    connections[1].sendMessage({ content: 'Second task', msg_id: 'message-1' });
    expect(state.sockets[0].sent).toMatchObject([{ session_id: 'session-a', uuid: 'message-1' }]);
    expect(state.sockets[1].sent).toMatchObject([{ session_id: 'session-b', uuid: 'message-1' }]);

    receive(1, { type: 'tool_use', id: 'tool-1', name: 'Write', input: {} });
    receive(0, { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} });
    expect(callbacks[0].onMessage.mock.calls.map(([frame]) => frame.data)).toMatchObject([{ sessionId: 'session-a', update: { toolCallId: 'tool-1', title: 'Read' } }]);
    expect(callbacks[1].onMessage.mock.calls.map(([frame]) => frame.data)).toMatchObject([{ sessionId: 'session-b', update: { toolCallId: 'tool-1', title: 'Write' } }]);
  });

  it('returns permission decisions only on the requesting session socket', () => {
    const requestA = { tool_name: 'Read', input: { path: '/a' } };
    const requestB = { tool_name: 'Write', input: { path: '/b' } };
    receive(0, { type: 'control_request', request_id: 'request-1', request: requestA });
    receive(1, { type: 'control_request', request_id: 'request-1', request: requestB });
    expect(callbacks[0].onPermissionRequest.mock.calls).toEqual([[requestA, 'request-1']]);
    expect(callbacks[1].onPermissionRequest.mock.calls).toEqual([[requestB, 'request-1']]);

    connections[0].respondToPermissionRequest('request-1', 'allow_once');
    connections[1].respondToPermissionRequest('request-1', 'reject_once');
    expect(state.sockets[0].sent).toMatchObject([{ type: 'control_response', response: { request_id: 'request-1', response: { behavior: 'allow_once' } } }]);
    expect(state.sockets[1].sent).toMatchObject([{ type: 'control_response', response: { request_id: 'request-1', response: { behavior: 'reject_once' } } }]);
  });

  it('keeps cancellation and its acknowledgement scoped to the interrupted session', async () => {
    const onConfirmed = vi.fn();
    const confirmation = connections[0].sendInterruptAndWait().then(onConfirmed);
    const interrupt = state.sockets[0].sent[0] as { request_id: string };
    expect(state.sockets[1].sent).toEqual([]);
    receive(1, { type: 'control_response', request_id: interrupt.request_id });
    await Promise.resolve();
    expect(onConfirmed).not.toHaveBeenCalled();
    receive(0, { type: 'control_response', request_id: interrupt.request_id });
    await confirmation;
    expect(onConfirmed).toHaveBeenCalledWith(true);

    receive(0, { type: 'result', result_type: 'user' });
    const reply = { type: 'assistant', message: { content: [{ type: 'text', text: 'Still working' }] } };
    receive(0, reply);
    receive(1, reply);
    expect(callbacks[0].onMessage.mock.calls.map(([frame]) => frame.type)).toEqual(['finish']);
    expect(callbacks[1].onMessage.mock.calls.map(([frame]) => frame.data)).toEqual(['Still working']);
  });

  it('reconnects the interrupted socket using its existing session without creating a new one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    state.sockets[0].emit('close', 1006);
    expect(connections[1].isConnected()).toBe(true);
    await vi.advanceTimersByTimeAsync(1250);

    expect(state.sockets).toHaveLength(3);
    expect(new URL(state.sockets[2].url).pathname).toBe('/ws/sessions/session-a');
    expect(connections.map((connection) => connection.getSessionId())).toEqual(sessions);
    expect(connections.every((connection) => connection.isConnected())).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    receive(2, { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} });
    expect(callbacks[0].onMessage).toHaveBeenCalledTimes(1);
    expect(callbacks[1].onMessage).not.toHaveBeenCalled();
  });
});
