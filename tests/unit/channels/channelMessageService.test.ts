/**
 * Verifies the channel path (WeChat etc.) routes concurrent messages through the shared
 * turnInputCoordinator — a 2nd message while a turn runs is QUEUED or INTERRUPTS instead of
 * being dropped (the old behaviour). Uses the REAL coordinator; mocks only process deps.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getTaskByIdRollbackBuild, configGet, getConversation } = vi.hoisted(() => ({
  getTaskByIdRollbackBuild: vi.fn(),
  configGet: vi.fn(),
  getConversation: vi.fn(() => ({ success: true, data: { source: 'wechat' } })),
}));

vi.mock('@process/utils/mainLogger', () => ({ mainWarn: vi.fn(), mainLog: vi.fn(), mainError: vi.fn() }));
vi.mock('@/process/WorkerManage', () => ({ default: { getTaskByIdRollbackBuild } }));
vi.mock('@/process/initStorage', () => ({ ProcessConfig: { get: configGet } }));
vi.mock('@/process/database', () => ({ getDatabase: () => ({ getConversation }) }));
vi.mock('@/process/bridge/conversationBridge', () => ({ queueConversationWorkspaceSkillSync: vi.fn() }));

import { ChannelMessageService } from '@/channels/agent/ChannelMessageService';

const flush = () => new Promise((r) => setTimeout(r, 0));

interface FakeTask {
  sendMessage: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

describe('ChannelMessageService → turnInputCoordinator', () => {
  let svc: ChannelMessageService;
  let task: FakeTask;

  beforeEach(() => {
    // A turn that stays active until we resolve its stream (never self-resolves).
    task = { sendMessage: vi.fn(() => new Promise(() => {})), stop: vi.fn(() => Promise.resolve()) };
    getTaskByIdRollbackBuild.mockReset().mockResolvedValue(task);
    getConversation.mockReturnValue({ success: true, data: { source: 'wechat' } });
    svc = new ChannelMessageService();
  });

  it('queue mode: a 2nd concurrent message is queued (not dropped), then flushed after the first finishes', async () => {
    configGet.mockImplementation((k: string) => Promise.resolve(k === 'agent.messageQueue')); // queue ON, interrupt OFF
    const onStream = vi.fn();
    void svc.sendMessage('s', 'convQ', 'A', undefined, onStream);
    await flush();
    expect(task.sendMessage).toHaveBeenCalledTimes(1); // A running

    void svc.sendMessage('s', 'convQ', 'B', undefined, onStream);
    await flush();
    expect(task.sendMessage).toHaveBeenCalledTimes(1); // B queued — NOT sent, NOT dropped

    // Finish A → the queued B flushes.
    const stream = (svc as unknown as { activeStreams: Map<string, { resolve: (m: string) => void; msgId: string }> }).activeStreams.get('convQ');
    stream?.resolve(stream.msgId);
    await flush();
    expect(task.sendMessage).toHaveBeenCalledTimes(2); // B ran after A
  });

  it('auto-interrupt: a 2nd concurrent message cancels the running turn', async () => {
    configGet.mockImplementation((k: string) => Promise.resolve(k === 'agent.autoInterrupt')); // interrupt ON
    const onStream = vi.fn();
    void svc.sendMessage('s', 'convI', 'A', undefined, onStream);
    await flush();
    void svc.sendMessage('s', 'convI', 'B', undefined, onStream);
    await flush();
    expect(task.stop).toHaveBeenCalled(); // interrupted, not dropped
  });
});
