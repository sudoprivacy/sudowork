import { describe, expect, it, vi } from 'vitest';

vi.mock('@process/database', () => ({
  getDatabase: vi.fn(),
}));

vi.mock('@process/WorkerManage', () => ({
  default: {},
}));

vi.mock('@process/remote/MossSessionApi', () => ({
  initMossApi: vi.fn(),
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainError: vi.fn(),
}));

vi.mock('@/common/utils', () => ({
  uuid: () => 'uuid-1',
}));

vi.mock('@process/initStorage', () => ({
  ProcessConfig: { getSync: vi.fn() },
}));

vi.mock('@/common/utils/workspaceSkillSync', () => ({
  isRemoteContainerPath: () => false,
}));

describe('RemoteConversationProvider Moss sync conversion', () => {
  it('uses local DB message status values for synced Moss history', async () => {
    const { default: RemoteConversationProvider } = await import('../../src/process/providers/RemoteConversationProvider');
    const provider = new RemoteConversationProvider({} as any);

    const { messages, foundModel } = (provider as any).convertMossMessagesToTMessages(
      [
        {
          type: 'user',
          timestamp: '2026-06-10T00:00:00.000Z',
          message: { content: [{ type: 'text', text: '记住我是 ybc' }] },
        },
        {
          type: 'assistant',
          timestamp: '2026-06-10T00:00:01.000Z',
          message: {
            model: 'gemini-3.5-flash',
            content: [{ type: 'text', text: '已记住' }],
          },
        },
      ],
      'conv-1',
      'moss-session-1'
    );

    expect(foundModel).toBe('gemini-3.5-flash');
    expect(messages).toHaveLength(2);
    expect(messages.map((message: any) => message.status)).toEqual(['finish', 'finish']);
    expect(messages.map((message: any) => message.position)).toEqual(['right', 'left']);
  });

  it('strips injected cron prompt blocks from remote user messages', async () => {
    const { default: RemoteConversationProvider } = await import('../../src/process/providers/RemoteConversationProvider');
    const provider = new RemoteConversationProvider({} as any);

    const { messages } = (provider as any).convertMossMessagesToTMessages(
      [
        {
          type: 'user',
          timestamp: '2026-06-10T00:00:00.000Z',
          message: {
            content: [
              {
                type: 'text',
                text: '[Scheduled Task Skill — you MUST follow this to manage scheduled tasks; output the [CRON_*] commands directly in your reply]\n\n[Assistant Rules - You MUST follow these instructions]\n\n[User Request]\n生成一个 go 语言的 knn 算法',
              },
            ],
          },
        },
      ],
      'conv-1',
      'moss-session-1'
    );

    expect(messages).toHaveLength(1);
    expect((messages[0] as any).content.content).toBe('生成一个 go 语言的 knn 算法');
  });
});
