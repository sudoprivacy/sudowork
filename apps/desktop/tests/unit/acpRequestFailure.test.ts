import { afterEach, describe, expect, it, vi } from 'vitest';
import AcpAgent from '@process/task/AcpAgent';
import { ipcBridge } from '@/common';
import { cronBusyGuard } from '@process/services/cron/CronBusyGuard';
import { channelEventBus } from '@/channels/agent/ChannelEventBus';

vi.mock('@/utils/configureChromium', () => ({ cdpPort: 9230 }));
vi.mock('@process/i18n', () => ({ default: { t: (key: string) => key }, i18nReady: Promise.resolve() }));

interface IAgentHarness {
  conversation_id: string;
  turnActive: boolean;
  extra: { backend: string; acpSessionId: string };
  connection: { isConnected: boolean; hasActiveSession: boolean; sendPrompt: ReturnType<typeof vi.fn> };
  adapter: { resetMessageTracking: ReturnType<typeof vi.fn> };
  acpAvailableSlashCommands: never[];
  streamTextBuffer: { flushAll: ReturnType<typeof vi.fn> };
  flushThinkFilters: ReturnType<typeof vi.fn>;
  emitMessage: ReturnType<typeof vi.fn>;
  logAgentError: ReturnType<typeof vi.fn>;
  attemptScodeLateReconciliation: ReturnType<typeof vi.fn>;
  initAgent: ReturnType<typeof vi.fn>;
  sendToConnection: (text: string, msgId?: string, images?: never[], isStartSkipped?: boolean) => Promise<{ success: boolean }>;
  emitErrorMessage: (text: string, withFinish?: boolean) => void;
  handleSignalEvent: (message: unknown) => Promise<void>;
  archiveCurrentTurnFiles: ReturnType<typeof vi.fn>;
  currentTurnProtectedFinalPaths: Set<string>;
  cronAccumulator: { currentMsgContent: string };
}

function createRunningAgent() {
  const agent = Object.create(AcpAgent.prototype) as AcpAgent;
  const internal = agent as unknown as IAgentHarness;
  Object.assign(internal, {
    conversation_id: 'failed-request',
    turnActive: true,
    extra: { backend: 'scode', acpSessionId: 'durable-history' },
    connection: { isConnected: true, hasActiveSession: true, sendPrompt: vi.fn() },
    adapter: { resetMessageTracking: vi.fn() },
    acpAvailableSlashCommands: [],
    streamTextBuffer: { flushAll: vi.fn() },
    flushThinkFilters: vi.fn(),
    emitMessage: vi.fn(),
    logAgentError: vi.fn(),
    attemptScodeLateReconciliation: vi.fn(),
    initAgent: vi.fn(),
    archiveCurrentTurnFiles: vi.fn().mockResolvedValue(undefined),
    currentTurnProtectedFinalPaths: new Set(),
    cronAccumulator: { currentMsgContent: '' },
  });
  agent.options = { backend: 'scode', conversation_id: 'failed-request', acpSessionId: 'durable-history' };
  agent.status = 'running';
  agent.processingStartTime = 123;
  cronBusyGuard.setProcessing('failed-request', true);
  return { agent, internal };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ACP request failure recovery', () => {
  it.each(['api returned 500 Internal Server Error (new_api_error)', 'LLM request timed out after 300 seconds'])('ends the execution state and retains the native session after %s', async (reason) => {
    const { agent, internal } = createRunningAgent();
    internal.connection.sendPrompt.mockRejectedValueOnce(new Error(reason));
    const busy = vi.spyOn(cronBusyGuard, 'setProcessing');
    const emit = vi.spyOn(ipcBridge.acpConversation.responseStream, 'emit');
    const channel = vi.spyOn(channelEventBus, 'emitAgentMessage');

    expect((await internal.sendToConnection('convert this document', undefined, undefined, true)).success).toBe(false);
    expect(internal.connection.sendPrompt).toHaveBeenCalledTimes(1);
    expect(agent.status).toBe('finished');
    expect(agent.processingStartTime).toBeUndefined();
    expect(internal.turnActive).toBe(false);
    expect(busy).toHaveBeenCalledWith('failed-request', false);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'finish', conversation_id: 'failed-request' }));
    expect(channel).toHaveBeenCalledWith('failed-request', expect.objectContaining({ type: 'finish' }));
    expect(internal.extra.acpSessionId).toBe('durable-history');
    expect(agent.options.acpSessionId).toBe('durable-history');

    internal.connection.sendPrompt.mockResolvedValueOnce({});
    expect(await internal.sendToConnection('continue reviewing', undefined, undefined, true)).toEqual({ success: true, data: null });
  });

  it('finishes a turn whose automatic reconnect fails', async () => {
    const { agent, internal } = createRunningAgent();
    internal.connection.isConnected = false;
    internal.initAgent.mockRejectedValueOnce(new Error('Connection refused'));
    expect((await internal.sendToConnection('retry')).success).toBe(false);
    expect(agent.status).toBe('finished');
    expect(internal.turnActive).toBe(false);
    expect(agent.processingStartTime).toBeUndefined();
    expect(internal.connection.sendPrompt).not.toHaveBeenCalled();
  });

  it('leaves the next turn timer intact after a successful previous turn', async () => {
    vi.useFakeTimers();
    const { agent, internal } = createRunningAgent();
    await internal.handleSignalEvent({ type: 'finish', conversation_id: 'failed-request', msg_id: 'done', data: null });
    expect(agent.status).toBe('finished');
    expect(agent.processingStartTime).toBeUndefined();
    agent.processingStartTime = 456;
    agent.status = 'running';
    internal.turnActive = true;
    vi.advanceTimersByTime(2000);
    expect(agent.processingStartTime).toBe(456);
    expect(agent.status).toBe('running');
  });
});
