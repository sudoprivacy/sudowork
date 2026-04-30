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
});
