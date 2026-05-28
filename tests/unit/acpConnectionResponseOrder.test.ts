import { describe, expect, it, vi } from 'vitest';

type AcpConnectionCtor = typeof import('@/agent/acp/AcpConnection');

type AcpConnectionInstance = InstanceType<AcpConnectionCtor['AcpConnection']>;

type AcpConnectionTestHarness = AcpConnectionInstance & {
  pendingRequests: Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      method: string;
      isPaused: boolean;
      startTime: number;
      timeoutDuration: number;
      timeoutId?: NodeJS.Timeout;
    }
  >;
  handleMessage: (message: unknown) => void;
};

async function loadAcpConnection() {
  vi.resetModules();
  vi.doMock('@process/telemetry', () => ({
    recordFirstToken: vi.fn(),
  }));
  vi.doMock('@process/utils/mainLogger', () => ({
    mainLog: vi.fn(),
  }));
  vi.doMock('@process/utils/shellEnv', () => ({
    resolveNpxPath: vi.fn(() => 'npx'),
  }));
  vi.doMock('@process/services/authProxy', () => ({
    getAuthProxyPort: vi.fn(() => null),
    registerToken: vi.fn(),
    revokeToken: vi.fn(),
  }));
  vi.doMock('@/agent/acp/modelInfo', () => ({
    buildAcpModelInfo: vi.fn(() => null),
    summarizeAcpModelInfo: vi.fn(() => null),
  }));
  vi.doMock('@/agent/acp/acpConnectors', () => ({
    ACP_PERF_LOG: false,
    connectClaude: vi.fn(),
    connectCodebuddy: vi.fn(),
    connectCodex: vi.fn(),
    prepareCleanEnv: vi.fn(() => process.env),
    spawnGenericBackend: vi.fn(),
  }));

  return await import('@/agent/acp/AcpConnection');
}

describe('AcpConnection prompt response ordering', () => {
  it('emits usage before end_turn for completed prompt responses', async () => {
    const { AcpConnection } = await loadAcpConnection();
    const connection = new AcpConnection();
    const harness = connection as unknown as AcpConnectionTestHarness;
    const order: string[] = [];
    const resolve = vi.fn();

    connection.onPromptUsage = () => {
      order.push('usage');
    };
    connection.onEndTurn = () => {
      order.push('end_turn');
    };

    harness.pendingRequests.set(1, {
      resolve,
      reject: vi.fn(),
      method: 'session/prompt',
      isPaused: false,
      startTime: Date.now(),
      timeoutDuration: 300000,
    });

    harness.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      result: {
        stopReason: 'end_turn',
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          totalTokens: 3,
          cachedReadTokens: 0,
          cachedWriteTokens: 0,
        },
      },
    });

    expect(order).toEqual(['usage', 'end_turn']);
    expect(resolve).toHaveBeenCalledWith({
      stopReason: 'end_turn',
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
      },
    });
  });

  it('merges Sudocode context metadata into prompt usage', async () => {
    const { AcpConnection } = await loadAcpConnection();
    const connection = new AcpConnection();
    const harness = connection as unknown as AcpConnectionTestHarness;
    const usageSpy = vi.fn();

    connection.onPromptUsage = usageSpy;

    harness.pendingRequests.set(2, {
      resolve: vi.fn(),
      reject: vi.fn(),
      method: 'session/prompt',
      isPaused: false,
      startTime: Date.now(),
      timeoutDuration: 300000,
    });

    harness.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      result: {
        stopReason: 'end_turn',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        _meta: {
          sudocode: {
            contextWindowTokens: 1048576,
            estimatedSessionTokens: 42000,
          },
        },
      },
    });

    expect(usageSpy).toHaveBeenCalledWith({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      contextWindowTokens: 1048576,
      estimatedSessionTokens: 42000,
    });
  });

  it('ignores invalid Sudocode context metadata values', async () => {
    const { AcpConnection } = await loadAcpConnection();
    const connection = new AcpConnection();
    const harness = connection as unknown as AcpConnectionTestHarness;
    const usageSpy = vi.fn();

    connection.onPromptUsage = usageSpy;

    harness.pendingRequests.set(3, {
      resolve: vi.fn(),
      reject: vi.fn(),
      method: 'session/prompt',
      isPaused: false,
      startTime: Date.now(),
      timeoutDuration: 300000,
    });

    harness.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      result: {
        stopReason: 'end_turn',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        _meta: {
          sudocode: {
            contextWindowTokens: '1048576',
            estimatedSessionTokens: Number.NaN,
          },
        },
      },
    });

    expect(usageSpy).toHaveBeenCalledWith({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
  });

  it('abandons cancel locally after timeout without disconnecting the session', async () => {
    const { AcpConnection } = await loadAcpConnection();
    const connection = new AcpConnection();
    const harness = connection as unknown as AcpConnectionTestHarness & {
      child: { killed: boolean } | null;
      sessionId: string | null;
      sendMessage: (message: unknown) => void;
      disconnect: () => Promise<void>;
    };
    const resolve = vi.fn();
    const disconnectSpy = vi.fn().mockResolvedValue(undefined);

    harness.child = { killed: false };
    harness.sessionId = 'session-1';
    harness.sendMessage = vi.fn();
    harness.disconnect = disconnectSpy;

    harness.pendingRequests.set(7, {
      resolve,
      reject: vi.fn(),
      method: 'session/prompt',
      isPaused: false,
      startTime: Date.now(),
      timeoutDuration: 300000,
      timeoutId: undefined,
    });

    const result = await connection.cancel(5);

    expect(result).toBe('abandoned');
    expect(resolve).toHaveBeenCalledWith({ stopReason: 'cancelled' });
    expect(harness.pendingRequests.has(7)).toBe(false);
    expect(disconnectSpy).not.toHaveBeenCalled();
  });
});
