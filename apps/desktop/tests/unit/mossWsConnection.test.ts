import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMossRuntimeUpdateRequired } from '@sudowork/moss-client';

const sockets = vi.hoisted(() => ({ count: 0 }));

vi.mock('ws', () => {
  class MockWebSocket {
    constructor() {
      sockets.count++;
    }
    on(event: string, callback: (...args: any[]) => void) {
      if (event === 'open') {
        queueMicrotask(() => callback());
      }
      return this;
    }

    send() {
      return undefined;
    }

    close() {
      return undefined;
    }
  }

  return { default: MockWebSocket };
});

vi.mock('@/process/bridge/eeclawBridge', () => ({
  getValidToken: vi.fn(async () => 'token'),
}));

vi.mock('@/process/initStorage', () => ({
  ProcessConfig: {
    getSync: vi.fn(() => undefined),
  },
}));

vi.mock('@/process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainError: vi.fn(),
}));

describe('MossWsConnection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('retains the committed identity and reports startup refusal before opening a socket', async () => {
    sockets.count = 0;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        session_id: 'saved-session',
        ws_url: 'wss://moss.example/saved-session',
        startup: { sessionId: 'saved-session', attemptId: 'attempt', code: 'RUNTIME_UPDATE_REQUIRED', isRetryable: false, message: 'Update the runtime.' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { MossWsConnection } = await import('@/agent/remote/MossWsConnection');
    const connection = new MossWsConnection(
      { serverUrl: 'https://moss.example', authToken: 'eyJ.token' },
      {
        onMessage: vi.fn(),
        onPermissionRequest: vi.fn(),
      }
    );
    await expect(connection.connect()).rejects.toSatisfy(isMossRuntimeUpdateRequired);
    expect(connection.getSessionId()).toBe('saved-session');
    expect(connection.getWsUrl()).toBe('wss://moss.example/saved-session');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sockets.count).toBe(0);
  });

  it('does not send cwd when no remote workspace is explicitly selected', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        session_id: 'session-1',
        ws_url: 'ws://moss.example/session-1',
        work_dir: '/runtime/session-1',
        runtime: { type: 'docker' },
      }),
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const { MossWsConnection } = await import('@/agent/remote/MossWsConnection');
    const connection = new MossWsConnection(
      {
        serverUrl: 'https://moss.example.com',
        authToken: 'eyJ.test-token',
        assistantName: 'default',
      },
      {
        onMessage: vi.fn(),
        onPermissionRequest: vi.fn(),
      }
    );

    await connection.connect();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).not.toHaveProperty('cwd');
  });

  it('sends cwd when a remote workspace is explicitly selected', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        session_id: 'session-1',
        ws_url: 'ws://moss.example/session-1',
        work_dir: '/runtime/session-1',
        runtime: { type: 'docker' },
      }),
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const { MossWsConnection } = await import('@/agent/remote/MossWsConnection');
    const connection = new MossWsConnection(
      {
        serverUrl: 'https://moss.example.com',
        authToken: 'eyJ.test-token',
        cwd: '/Users/alice/workspace',
        assistantName: 'default',
      },
      {
        onMessage: vi.fn(),
        onPermissionRequest: vi.fn(),
      }
    );

    await connection.connect();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ cwd: '/Users/alice/workspace' });
  });
});
