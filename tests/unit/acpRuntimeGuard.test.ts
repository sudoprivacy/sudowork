import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/storage';

const h = vi.hoisted(() => ({
  createAcpAgent: vi.fn(),
  updateConversation: vi.fn(),
}));

vi.mock('@process/task/AcpAgent', () => ({
  default: vi.fn(function MockAcpAgent() {
    h.createAcpAgent();
    return { type: 'acp', kill: vi.fn() };
  }),
}));
vi.mock('@process/task/RemoteAgent', () => ({ default: vi.fn() }));
vi.mock('@process/initStorage', () => ({
  ProcessChat: { get: vi.fn() },
  ProcessConfig: { getSync: vi.fn() },
}));
vi.mock('@process/database/export', () => ({
  getDatabase: () => ({ updateConversation: h.updateConversation }),
}));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainError: vi.fn() }));

function makeConversation(backend: 'codex' | 'codebuddy'): TChatConversation {
  return {
    id: `conv-${backend}`,
    name: backend,
    type: 'acp',
    createTime: 1,
    modifyTime: 1,
    status: 'finished',
    source: 'sudowork',
    extra: { backend, workspace: '/workspace' },
  } as TChatConversation;
}

describe('ACP runtime backend guard', () => {
  beforeEach(() => {
    h.createAcpAgent.mockClear();
    h.updateConversation.mockClear();
  });

  it('rejects persisted Codex conversations before constructing an agent', async () => {
    const WorkerManage = (await import('@process/WorkerManage')).default;

    expect(WorkerManage.buildConversation(makeConversation('codex'))).toBeNull();
    expect(h.createAcpAgent).not.toHaveBeenCalled();
    expect(h.updateConversation).not.toHaveBeenCalled();
  });

  it('does not block other direct ACP backends', async () => {
    const WorkerManage = (await import('@process/WorkerManage')).default;

    expect(WorkerManage.buildConversation(makeConversation('codebuddy'))).not.toBeNull();
    expect(h.createAcpAgent).toHaveBeenCalledTimes(1);
    await WorkerManage.clear();
  });
});
