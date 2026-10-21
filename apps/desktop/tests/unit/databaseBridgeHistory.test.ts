import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@sudowork/common/storage';

const state = vi.hoisted(() => ({
  historyProvider: undefined as ((input: { page?: number; pageSize?: number; sessionMode?: 'local' | 'remote'; includeAllExecutionTargets?: boolean }) => Promise<TChatConversation[]>) | undefined,
  localList: vi.fn(),
  remoteList: vi.fn(),
}));

vi.mock('../../src/common', () => ({
  ipcBridge: {
    database: {
      getConversationMessages: { provider: vi.fn() },
      getUserConversations: {
        provider: (callback: typeof state.historyProvider) => {
          state.historyProvider = callback;
        },
      },
    },
  },
}));
vi.mock('@process/providers', () => ({
  getProviderForConversation: vi.fn(),
  getConversationProvider: (mode?: 'local' | 'remote') => ({ listConversations: mode === 'local' ? state.localList : state.remoteList }),
}));
vi.mock('@process/utils/mainLogger', () => ({ mainError: vi.fn() }));

function conversation(id: string, modifyTime: number, type: TChatConversation['type']): TChatConversation {
  return { id, name: id, type, createTime: modifyTime, modifyTime, extra: { backend: type === 'remote-agent' ? 'remote-agent' : 'scode' } } as TChatConversation;
}

describe('database conversation history bridge', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    state.historyProvider = undefined;
    const { initDatabaseBridge } = await import('@process/bridge/databaseBridge');
    initDatabaseBridge();
  });

  it('returns one stable union of local and remote execution history', async () => {
    state.localList.mockResolvedValue([conversation('local', 20, 'acp'), conversation('same-time-a', 10, 'acp')]);
    state.remoteList.mockResolvedValue([conversation('remote', 30, 'remote-agent'), conversation('same-time-b', 10, 'remote-agent')]);

    await expect(state.historyProvider?.({ page: 0, pageSize: 10000, includeAllExecutionTargets: true })).resolves.toEqual([
      expect.objectContaining({ id: 'remote' }),
      expect.objectContaining({ id: 'local' }),
      expect.objectContaining({ id: 'same-time-b' }),
      expect.objectContaining({ id: 'same-time-a' }),
    ]);
    expect(state.localList).toHaveBeenCalledWith(0, 10000);
    expect(state.remoteList).toHaveBeenCalledWith(0, 10000);
  });

  it('keeps the target-specific query for callers that explicitly request it', async () => {
    state.remoteList.mockResolvedValue([conversation('remote', 30, 'remote-agent')]);

    await expect(state.historyProvider?.({ sessionMode: 'remote' })).resolves.toEqual([expect.objectContaining({ id: 'remote' })]);
    expect(state.remoteList).toHaveBeenCalledWith(0, 10000);
    expect(state.localList).not.toHaveBeenCalled();
  });
});
