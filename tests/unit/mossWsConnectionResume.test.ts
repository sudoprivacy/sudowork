/**
 * Regression tests for issue #849: enterprise resume must fail fast (never
 * hang) on a rejected WS handshake, and must recover from a 401 by force
 * refreshing the access token once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Controls how the next MockWebSocket instances behave: each entry is either
// 'open' or an error message to emit on the handshake.
const wsScript: Array<'open' | string> = [];

vi.mock('ws', () => {
  class MockWebSocket {
    static OPEN = 1;
    readyState = 1;
    private handlers: Record<string, Array<(...args: unknown[]) => void>> = {};

    constructor() {
      queueMicrotask(() => {
        const step = wsScript.shift() ?? 'open';
        if (step === 'open') {
          this.emit('open');
        } else {
          this.emit('error', new Error(step));
          this.emit('close', 1006, Buffer.from(''));
        }
      });
    }

    on(event: string, callback: (...args: unknown[]) => void) {
      (this.handlers[event] ||= []).push(callback);
      return this;
    }

    private emit(event: string, ...args: unknown[]) {
      for (const callback of this.handlers[event] || []) callback(...args);
    }

    send() {
      return undefined;
    }

    close() {
      return undefined;
    }
  }

  return { default: MockWebSocket, WebSocket: MockWebSocket };
});

const getValidTokenMock = vi.fn(async (_forceRefresh?: boolean) => 'fresh-token');

vi.mock('@/process/bridge/eeclawBridge', () => ({
  getValidToken: (forceRefresh?: boolean) => getValidTokenMock(forceRefresh),
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

function resumeConfig() {
  return {
    serverUrl: 'https://moss.example.com',
    authToken: 'eyJ.pinned-stale-token',
    wsUrl: 'ws://moss.example/ws/sessions/session-1',
    sessionId: 'session-1',
  };
}

describe('MossWsConnection resume (issue #849)', () => {
  beforeEach(() => {
    wsScript.length = 0;
    getValidTokenMock.mockClear();
    getValidTokenMock.mockImplementation(async () => 'fresh-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sources the token from auth storage instead of the pinned JWT', async () => {
    wsScript.push('open');
    const { MossWsConnection } = await import('@/agent/remote/MossWsConnection');
    const connection = new MossWsConnection(resumeConfig(), {
      onMessage: vi.fn(),
      onPermissionRequest: vi.fn(),
    });

    await connection.connect();

    expect(getValidTokenMock).toHaveBeenCalled();
  });

  it('rejects instead of hanging when the WS handshake fails persistently', async () => {
    wsScript.push('Unexpected server response: 401', 'Unexpected server response: 401');
    const { MossWsConnection } = await import('@/agent/remote/MossWsConnection');
    const connection = new MossWsConnection(resumeConfig(), {
      onMessage: vi.fn(),
      onPermissionRequest: vi.fn(),
      onError: vi.fn(),
    });

    await expect(connection.connect()).rejects.toThrow('401');
  });

  it('force-refreshes the token and retries once on a 401 handshake', async () => {
    wsScript.push('Unexpected server response: 401', 'open');
    const { MossWsConnection } = await import('@/agent/remote/MossWsConnection');
    const connection = new MossWsConnection(resumeConfig(), {
      onMessage: vi.fn(),
      onPermissionRequest: vi.fn(),
      onError: vi.fn(),
    });

    await connection.connect();

    expect(getValidTokenMock).toHaveBeenCalledWith(true);
    expect(connection.isConnected()).toBe(true);
  });

  it('does not force-refresh on non-auth handshake failures', async () => {
    wsScript.push('Unexpected server response: 404');
    const { MossWsConnection } = await import('@/agent/remote/MossWsConnection');
    const connection = new MossWsConnection(resumeConfig(), {
      onMessage: vi.fn(),
      onPermissionRequest: vi.fn(),
      onError: vi.fn(),
    });

    await expect(connection.connect()).rejects.toThrow('404');
    expect(getValidTokenMock).not.toHaveBeenCalledWith(true);
  });
});
