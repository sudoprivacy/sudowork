import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TChatConversation } from '@/common/storage';

const h = vi.hoisted(() => {
  const conversation: TChatConversation = {
    id: 'conv-1',
    name: 'Conversation',
    type: 'acp',
    createTime: 1,
    modifyTime: 1,
    extra: { backend: 'scode', workspace: '/workspace' },
    status: 'finished',
    source: 'sudowork',
  } as TChatConversation;

  return {
    conversation,
    createAcpAgent: vi.fn(async () => ({ ...conversation })),
    createConversation: vi.fn(() => ({ success: true, data: true })),
    buildConversation: vi.fn(),
  };
});

vi.mock('@process/initAgent', () => ({ createAcpAgent: h.createAcpAgent }));
vi.mock('@process/database', () => ({ getDatabase: () => ({ createConversation: h.createConversation }) }));
vi.mock('@process/WorkerManage', () => ({ default: { buildConversation: h.buildConversation } }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));

describe('ConversationService.createConversation', () => {
  beforeEach(() => {
    h.createAcpAgent.mockClear();
    h.createConversation.mockClear();
    h.buildConversation.mockClear();
  });

  it('registers WorkerManage task by default', async () => {
    const { ConversationService } = await import('@process/services/conversationService');

    await expect(
      ConversationService.createConversation({
        type: 'acp',
        name: 'Conversation',
        extra: { backend: 'scode', workspace: '/workspace' },
      })
    ).resolves.toMatchObject({ success: true, conversation: expect.objectContaining({ id: 'conv-1' }) });

    expect(h.createConversation).toHaveBeenCalledWith(expect.objectContaining({ id: 'conv-1' }));
    expect(h.buildConversation).toHaveBeenCalledTimes(1);
    expect(h.buildConversation).toHaveBeenCalledWith(expect.objectContaining({ id: 'conv-1' }));
  });

  it('skips WorkerManage task registration when skipWorkerRegistration is true', async () => {
    const { ConversationService } = await import('@process/services/conversationService');

    await expect(
      ConversationService.createConversation({
        type: 'acp',
        name: 'Conversation',
        extra: { backend: 'scode', workspace: '/workspace' },
        skipWorkerRegistration: true,
      })
    ).resolves.toMatchObject({ success: true, conversation: expect.objectContaining({ id: 'conv-1' }) });

    expect(h.createConversation).toHaveBeenCalledWith(expect.objectContaining({ id: 'conv-1' }));
    expect(h.buildConversation).not.toHaveBeenCalled();
  });

  it('rejects disabled ACP backends before creating or persisting a conversation', async () => {
    const { ConversationService } = await import('@process/services/conversationService');

    await expect(
      ConversationService.createConversation({
        type: 'acp',
        name: 'Codex Conversation',
        extra: { backend: 'codex', workspace: '/workspace' },
      })
    ).resolves.toEqual({ success: false, error: 'ACP backend codex is disabled' });

    expect(h.createAcpAgent).not.toHaveBeenCalled();
    expect(h.createConversation).not.toHaveBeenCalled();
    expect(h.buildConversation).not.toHaveBeenCalled();
  });
});
