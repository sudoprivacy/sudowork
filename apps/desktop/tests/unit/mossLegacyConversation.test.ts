import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@sudowork/common/storage';

const state = vi.hoisted(() => ({ conversations: [] as TChatConversation[], sessions: [] as Array<{ sessionId: string; userId: string; orgId: string }>, update: vi.fn(() => ({ success: true })) }));
vi.mock('@process/database', () => ({ getDatabase: () => ({ getUserConversations: () => ({ data: state.conversations }), updateConversation: state.update }) }));
vi.mock('@process/WorkerManage', () => ({ default: {} }));
vi.mock('@process/remote/MossSessionApi', () => ({ initMossApi: () => ({ ensureAuthenticated: async () => {}, listSessions: async (filter?: { source?: string }) => (filter?.source === 'cron' ? [] : state.sessions) }) }));
vi.mock('@process/initStorage', () => ({ ProcessConfig: { getSync: (key: string) => ({ 'eeclaw.accountScope': 'current-scope', 'eeclaw.userInfo': { id: 'user-a', orgId: 'org-a' }, 'eeclaw.serverUrl': 'https://moss.test', 'eeclaw.authStorage': { access_token: 'token' } })[key] } }));
vi.mock('@/common/enterpriseDebugConfig', () => ({ isEnterpriseMode: () => true }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainError: vi.fn() }));
import { RemoteConversationProvider } from '@process/providers/RemoteConversationProvider';

beforeEach(() => {
  vi.clearAllMocks();
  state.sessions = [];
  state.conversations = [{ id: 'old-conversation', type: 'remote-agent', extra: { backend: 'remote-agent', mossServerUrl: 'https://moss.test/', mossSessionId: 'old-session' } } as TChatConversation];
});
describe('legacy cloud conversation ownership', () => {
  it('restores history after Moss verifies its owner and organization', async () => {
    state.sessions = [{ sessionId: 'old-session', userId: 'user-a', orgId: 'org-a' }];
    const conversations = await new RemoteConversationProvider({ isEnterpriseMode: true, mossServerUrl: 'https://moss.test' }).listConversations();
    expect(conversations).toHaveLength(1);
    expect(conversations[0].extra).toMatchObject({ executionTarget: 'remote', mossAccountScope: 'current-scope' });
  });
  it('keeps another user’s or organization’s legacy records isolated', async () => {
    state.sessions = [{ sessionId: 'old-session', userId: 'user-b', orgId: 'org-a' }];
    expect(await new RemoteConversationProvider({ isEnterpriseMode: true, mossServerUrl: 'https://moss.test' }).listConversations()).toEqual([]);
    expect(state.update).not.toHaveBeenCalled();
    state.sessions = [{ sessionId: 'old-session', userId: 'user-a', orgId: 'org-b' }];
    expect(await new RemoteConversationProvider({ isEnterpriseMode: true, mossServerUrl: 'https://moss.test' }).listConversations()).toEqual([]);
  });
});
