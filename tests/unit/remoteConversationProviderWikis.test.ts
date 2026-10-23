import { describe, expect, it, vi } from 'vitest';

const createConversation = vi.fn(() => ({ success: true }));
const buildConversation = vi.fn();

vi.mock('@process/database', () => ({ getDatabase: vi.fn(() => ({ createConversation })) }));
vi.mock('@process/WorkerManage', () => ({ default: { buildConversation } }));
vi.mock('@process/remote/MossSessionApi', () => ({ initMossApi: vi.fn() }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainError: vi.fn() }));
vi.mock('@/common/utils', () => ({ uuid: () => 'uuid-1' }));
vi.mock('@process/initStorage', () => ({ ProcessConfig: { getSync: vi.fn() } }));
vi.mock('@/common/utils/workspaceSkillSync', () => ({ isRemoteContainerPath: () => false }));

describe('RemoteConversationProvider.createConversation wikis', () => {
  it('keeps the selected wikis on the stored conversation', async () => {
    const { default: RemoteConversationProvider } = await import('../../src/process/providers/RemoteConversationProvider');
    const provider = new RemoteConversationProvider({ mossServerUrl: 'https://moss.example.com' } as never);

    const conversation = await provider.createConversation({ type: 'remote-agent', model: {} as never, extra: { workspace: '', enabledWikis: ['w1', 'w2'] } } as never);

    expect((conversation.extra as { enabledWikis?: string[] }).enabledWikis).toEqual(['w1', 'w2']);
    expect(createConversation).toHaveBeenCalledWith(expect.objectContaining({ extra: expect.objectContaining({ enabledWikis: ['w1', 'w2'] }) }));
    expect(buildConversation).toHaveBeenCalled();
  });

  it('stores no wiki field when none are selected', async () => {
    const { default: RemoteConversationProvider } = await import('../../src/process/providers/RemoteConversationProvider');
    const provider = new RemoteConversationProvider({ mossServerUrl: 'https://moss.example.com' } as never);
    const conversation = await provider.createConversation({ type: 'remote-agent', model: {} as never, extra: { workspace: '', enabledWikis: [] } } as never);
    expect((conversation.extra as { enabledWikis?: string[] }).enabledWikis).toBeUndefined();
  });
});
