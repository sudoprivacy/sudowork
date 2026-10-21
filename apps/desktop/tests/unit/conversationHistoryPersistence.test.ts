import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@sudowork/common/storage';
import { mergeConversationHistories, resolveConversationUpdateTime } from '@process/database/types';

const database = vi.hoisted(() => ({
  getConversation: vi.fn(),
  updateConversation: vi.fn(),
  createConversation: vi.fn(),
  insertMessage: vi.fn(),
}));

vi.mock('@process/database', () => ({ getDatabase: () => database }));
vi.mock('@process/initStorage', () => ({ ProcessChatMessage: { get: vi.fn() } }));
vi.mock('@process/utils/mainLogger', () => ({ mainWarn: vi.fn(), mainError: vi.fn() }));

function conversation(id: string, modifyTime: number, createTime = modifyTime): TChatConversation {
  return { id, name: id, type: 'acp', createTime, modifyTime, extra: { backend: 'scode' } } as TChatConversation;
}

describe('conversation history persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges local and remote rows without replacement and sorts ties deterministically', () => {
    const duplicateOld = conversation('duplicate', 10);
    const duplicateNew = conversation('duplicate', 40);
    expect(mergeConversationHistories([conversation('local', 30), duplicateOld], [conversation('remote', 30), duplicateNew]).map((item) => [item.id, item.modifyTime])).toEqual([
      ['duplicate', 40],
      ['remote', 30],
      ['local', 30],
    ]);
  });

  it('preserves an authoritative activity time while advancing ordinary mutations', () => {
    expect(resolveConversationUpdateTime(123, 999)).toBe(123);
    expect(resolveConversationUpdateTime(undefined, 999)).toBe(999);
  });

  it('does not turn an idempotent file migration into new activity', async () => {
    database.getConversation.mockReturnValue({ success: true, data: conversation('existing', 123) });
    const { migrateConversationToDatabase } = await import('@process/bridge/migrationUtils');

    await migrateConversationToDatabase(conversation('existing', 123));

    expect(database.updateConversation).not.toHaveBeenCalled();
    expect(database.createConversation).not.toHaveBeenCalled();
  });
});
