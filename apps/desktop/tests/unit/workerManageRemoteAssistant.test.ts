import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@sudowork/common/storage';

const h = vi.hoisted(() => ({ remoteAgent: vi.fn() }));
vi.mock('@/process/task/RemoteAgent', () => ({ default: h.remoteAgent }));
vi.mock('@/process/task/AcpAgent', () => ({ default: vi.fn() }));
vi.mock('@/process/initStorage', () => ({
  ProcessConfig: { getSync: vi.fn() },
  ProcessChat: { get: vi.fn() },
}));
vi.mock('@/process/database/export', () => ({ getDatabase: vi.fn() }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainError: vi.fn() }));

import WorkerManage from '@/process/WorkerManage';

describe('WorkerManage remote assistant identity', () => {
  beforeEach(() => {
    h.remoteAgent.mockReset();
    h.remoteAgent.mockImplementation(function () {});
  });

  it.each([
    { agentName: 'Remote Agent', presetAssistantId: 'Remote Agent', expected: undefined },
    { agentName: 'Moss Server', presetAssistantId: 'Moss Server', expected: undefined },
    { agentName: 'Remote Agent', expected: undefined },
    { agentName: undefined, expected: undefined },
    { agentName: 'Remote Agent', presetAssistantId: 'installed-agent-id', expected: 'installed-agent-id' },
    { agentName: 'Finance assistant', expected: 'Finance assistant' },
  ])('resolves the server identity from $agentName / $presetAssistantId', ({ agentName, presetAssistantId, expected }) => {
    WorkerManage.buildConversation(
      {
        id: 'remote-test',
        type: 'remote-agent',
        name: 'Conversation',
        createTime: 1,
        modifyTime: 1,
        extra: {
          backend: 'remote-agent',
          mossServerUrl: 'https://moss.example.invalid',
          mossSessionPending: true,
          agentName,
          presetAssistantId,
        },
      } as TChatConversation,
      { skipCache: true }
    );
    expect(h.remoteAgent).toHaveBeenCalledWith(expect.objectContaining({ assistantName: expected, mossSessionPending: true }));
  });

  it('clears local execution without disconnecting a cloud session', async () => {
    const local = { type: 'acp', kill: vi.fn() } as unknown as Parameters<typeof WorkerManage.addTask>[1];
    const remote = { type: 'remote-agent', kill: vi.fn(), detach: vi.fn() };
    WorkerManage.addTask('local-grant-test', local);
    WorkerManage.addTask('cloud-grant-test', remote as unknown as Parameters<typeof WorkerManage.addTask>[1]);
    await WorkerManage.clear(true);
    expect(local.kill).toHaveBeenCalledOnce();
    expect(remote.kill).not.toHaveBeenCalled();
    expect(remote.detach).not.toHaveBeenCalled();
    expect(WorkerManage.getTaskById('cloud-grant-test')).toBe(remote);
    expect(WorkerManage.getTaskById('local-grant-test')).toBeUndefined();
    await WorkerManage.clear();
  });
});
