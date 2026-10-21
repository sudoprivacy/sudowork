import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@sudowork/common/storage';
import type { MossSession } from '@process/remote/MossSessionApi';

const state = vi.hoisted(() => ({
  conversations: [] as TChatConversation[],
  settings: {} as Record<string, unknown>,
  listSessions: vi.fn(),
  createConversation: vi.fn(),
  updateConversation: vi.fn(),
  terminateSession: vi.fn(),
  getSessionContext: vi.fn(),
  insertMessage: vi.fn(),
  deleteConversationMessages: vi.fn(),
}));

vi.mock('@process/database', () => ({
  getDatabase: () => ({
    getUserConversations: () => ({ data: state.conversations }),
    getConversation: (id: string) => ({ success: true, data: state.conversations.find((conversation) => conversation.id === id) }),
    deleteConversation: (id: string) => {
      state.conversations = state.conversations.filter((conversation) => conversation.id !== id);
      return { success: true };
    },
    createConversation: state.createConversation,
    updateConversation: state.updateConversation,
    getConversationMessages: () => ({ data: [], total: 0, hasMore: false }),
    insertMessage: state.insertMessage,
    deleteConversationMessages: state.deleteConversationMessages,
  }),
}));
vi.mock('@process/WorkerManage', () => ({ default: { kill: vi.fn() } }));
vi.mock('@process/remote/MossSessionApi', () => ({
  initMossApi: () => ({
    ensureAuthenticated: async () => {},
    listSessions: state.listSessions,
    terminateSession: state.terminateSession,
    getSessionContext: state.getSessionContext,
  }),
}));
vi.mock('@process/initStorage', () => ({
  ProcessConfig: {
    getSync: (key: string) => state.settings[key],
    get: async (key: string) => state.settings[key],
    set: async (key: string, value: unknown) => {
      state.settings[key] = value;
    },
  },
}));
vi.mock('@/common/enterpriseDebugConfig', () => ({ isEnterpriseMode: () => true }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainError: vi.fn() }));
vi.mock('@sudowork/common/chatLib', () => ({
  convertMossMessagesToTMessages: (_messages: unknown[], conversationId: string) => ({
    messages: [{ id: 'message-1', conversation_id: conversationId, msg_id: 'message-1', type: 'text', content: { content: 'hello' }, createdAt: 100 }],
    foundModel: null,
  }),
}));

import { RemoteConversationProvider } from '@process/providers/RemoteConversationProvider';

function cloudSession(sessionId: string, fields: Partial<MossSession> = {}): MossSession {
  return { sessionId, userId: 'owner', orgId: 'org', createdAt: 100, lastActiveAt: 200, assistantName: 'moss-agent:user:owner', status: 'idle', ...fields };
}

function provider(): RemoteConversationProvider {
  return new RemoteConversationProvider({ isEnterpriseMode: true, mossServerUrl: 'https://moss.test' });
}

beforeEach(() => {
  vi.resetAllMocks();
  state.conversations = [];
  state.settings = { 'eeclaw.accountScope': 'scope-owner', 'eeclaw.userInfo': { id: 'owner', orgId: 'org' }, 'eeclaw.serverUrl': 'https://moss.test/', 'eeclaw.authStorage': { access_token: 'private-token' } };
  state.listSessions.mockResolvedValue([]);
  state.createConversation.mockImplementation((conversation: TChatConversation) => {
    state.conversations.push(conversation);
    return { success: true };
  });
  state.updateConversation.mockImplementation((id: string, updates: Partial<TChatConversation>) => {
    Object.assign(
      state.conversations.find((conversation) => conversation.id === id)!,
      updates
    );
    return { success: true };
  });
  state.getSessionContext.mockResolvedValue({ context: { messages: [{}] } });
  state.insertMessage.mockReturnValue({ success: true });
  state.deleteConversationMessages.mockReturnValue({ success: true });
});

describe('desktop cloud session discovery', () => {
  it('restores ordinary and managed sessions from a fresh device alongside cron history', async () => {
    state.listSessions.mockResolvedValue([
      cloudSession('ordinary', { title: 'My work', cwd: 'C:\\remote\\workspace' }),
      cloudSession('managed', { source: 'agent-manager', runtime: { type: 'cohost' } }),
      cloudSession('cron', { source: JSON.stringify({ source: 'cron', cronJobId: 'job', cronJobName: 'Daily' }) }),
    ]);
    const conversations = await provider().listConversations();
    expect(conversations.map((conversation) => conversation.id)).toEqual(['ordinary', 'managed', 'cron']);
    expect(state.listSessions).toHaveBeenCalledWith();
    expect(conversations[0]).toMatchObject({
      name: 'My work',
      type: 'remote-agent',
      extra: {
        mossSessionId: 'ordinary',
        mossSessionPending: false,
        mossAccountScope: 'scope-owner',
        executionTarget: 'remote',
        mossWorkDir: 'C:\\remote\\workspace',
      },
    });
    expect(conversations[0].extra.workspace).toBeUndefined();
    expect(conversations[1].name).toBe('New Remote Session');
    expect(JSON.stringify(conversations)).not.toContain('private-token');
  });

  it('excludes other owners, organizations and records without a proven owner', async () => {
    state.listSessions.mockResolvedValue([cloudSession('other-owner', { userId: 'other' }), cloudSession('other-org', { orgId: 'other' }), cloudSession('unknown-owner', { userId: undefined }), cloudSession('unknown-org', { orgId: undefined })]);
    expect(await provider().listConversations()).toEqual([]);
    expect(state.createConversation).not.toHaveBeenCalled();
    expect(state.updateConversation).not.toHaveBeenCalled();
  });

  it('imports history as idle and preserves a local active turn during metadata refresh', async () => {
    state.listSessions.mockResolvedValue([cloudSession('idle'), cloudSession('active', { status: 'running' })]);
    const client = provider();
    expect((await client.listConversations()).map((conversation) => conversation.status)).toEqual(['finished', 'finished']);
    state.conversations[0].status = 'running';
    state.listSessions.mockResolvedValue([cloudSession('idle', { lastActiveAt: 300 })]);
    await client.listConversations();
    expect(state.conversations[0].status).toBe('running');
  });

  it('preserves local ids, user titles and attachment paths and skips unchanged cache writes', async () => {
    state.conversations = [{ id: 'local-id', type: 'remote-agent', name: 'User title', createTime: 100, modifyTime: 150, extra: { mossSessionId: 'remote-id', mossServerUrl: 'https://moss.test', workspace: 'C:\\local', authToken: 'revoked-token' } } as TChatConversation];
    state.listSessions.mockResolvedValue([cloudSession('remote-id', { title: 'Server title' })]);
    const client = provider();
    expect(await client.listConversations()).toMatchObject([{ id: 'local-id', name: 'User title', extra: { workspace: 'C:\\local', mossAccountScope: 'scope-owner' } }]);
    expect(state.conversations[0].modifyTime).toBe(150);
    expect(state.conversations[0].extra.mossSessionUpdatedAt).toBe(200);
    expect(state.createConversation).not.toHaveBeenCalled();
    expect(JSON.stringify(state.conversations)).not.toContain('revoked-token');
    state.updateConversation.mockClear();
    await client.listConversations();
    expect(state.updateConversation).not.toHaveBeenCalled();
  });

  it('syncs opened cloud history without promoting it to newest activity', async () => {
    state.conversations = [{ id: 'local-id', type: 'remote-agent', name: 'Old title', createTime: 100, modifyTime: 150, extra: { mossSessionId: 'remote-id', mossServerUrl: 'https://moss.test' } } as TChatConversation];
    state.getSessionContext.mockResolvedValue({ context: { messages: [{}], customTitle: 'Server title' } });

    await expect(provider().syncFromMossServer('local-id')).resolves.toEqual({ syncedCount: 1, nameUpdated: true });
    expect(state.updateConversation).toHaveBeenCalledWith(
      'local-id',
      expect.objectContaining({
        name: 'Server title',
        modifyTime: 150,
        extra: expect.objectContaining({ mossSessionUpdatedAt: expect.any(Number) }),
      }),
      { preserveModifyTime: true }
    );
  });

  it('discards a discovery response when the user switches accounts while it is in flight', async () => {
    let complete!: (sessions: MossSession[]) => void;
    state.listSessions.mockImplementation(
      () =>
        new Promise<MossSession[]>((resolve) => {
          complete = resolve;
        })
    );
    const pending = provider().listConversations();
    await vi.waitFor(() => expect(state.listSessions).toHaveBeenCalled());
    state.settings['eeclaw.accountScope'] = 'scope-other';
    complete([cloudSession('old-owner-session')]);
    expect(await pending).toEqual([]);
    expect(state.createConversation).not.toHaveBeenCalled();
  });

  it('keeps hidden scheduled sessions hidden and refuses to overwrite another account cache', async () => {
    state.settings['remote.hiddenCronSessionIds'] = { hidden: 100 };
    state.conversations = [{ id: 'collision', type: 'remote-agent', extra: { mossServerUrl: 'https://moss.test', mossAccountScope: 'other-scope' } } as TChatConversation];
    state.listSessions.mockResolvedValue([cloudSession('collision'), cloudSession('hidden', { source: JSON.stringify({ source: 'cron', cronJobId: 'job' }) })]);
    expect(await provider().listConversations()).toEqual([]);
    expect(state.createConversation).not.toHaveBeenCalled();
    expect(state.updateConversation).not.toHaveBeenCalled();
  });

  it('keeps a deleted cloud conversation dismissed after the next discovery', async () => {
    state.listSessions.mockResolvedValue([cloudSession('dismissed')]);
    const client = provider();
    await client.listConversations();
    expect(await client.deleteConversation('dismissed')).toBe(true);
    expect(state.terminateSession).toHaveBeenCalledWith('dismissed');
    expect(await client.listConversations()).toEqual([]);
    expect(state.settings['remote.hiddenSessionIds']).toMatchObject({ 'scope-owner': { dismissed: expect.any(Number) } });
    state.settings['eeclaw.accountScope'] = 'another-scope';
    expect(await provider().listConversations()).toHaveLength(1);
  });
});
