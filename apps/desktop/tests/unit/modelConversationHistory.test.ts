import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@sudowork/common/storage';

const state = vi.hoisted(() => ({ list: vi.fn(), files: [] as TChatConversation[], migrate: vi.fn() }));
vi.mock('@process/database', () => ({ getDatabase: () => ({ getUserConversations: state.list }) }));
vi.mock('@process/services/conversationService', () => ({ ConversationService: {} }));
vi.mock('@process/WorkerManage', () => ({ default: {} }));
vi.mock('@process/initStorage', () => ({
  ProcessChat: { get: async () => state.files },
  ProcessConfig: { getSync: (key: string) => ({ 'eeclaw.accountScope': 'current-owner', 'eeclaw.authStorage': { access_token: 'fixture' } })[key] },
}));
vi.mock('@/common/enterpriseDebugConfig', () => ({ isEnterpriseMode: () => true }));
vi.mock('@process/bridge/migrationUtils', () => ({ migrateConversationToDatabase: state.migrate }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainError: vi.fn() }));
import { LocalConversationProvider } from '@process/providers/LocalConversationProvider';

function model(id: string, scope = 'current-owner'): TChatConversation {
  return { id, name: id, type: 'acp', createTime: 1, modifyTime: 2, extra: { backend: 'scode', purpose: 'ontology', ontologyId: 'northwind', mossAccountScope: scope } } as TChatConversation;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.files = [];
});

describe('model conversations in shared history', () => {
  it('discovers owned model sessions without admitting other accounts, remote sessions or team members', async () => {
    const owned = model('owned');
    state.list.mockReturnValue({ data: [owned, model('other-account', 'another-owner'), { ...model('cloud'), type: 'remote-agent' }, { ...model('team'), extra: { ...owned.extra, isTeamMember: true } }] });
    const history = await new LocalConversationProvider().listConversations();
    expect(history).toEqual([owned]);
    expect(state.list).toHaveBeenCalledExactlyOnceWith(undefined, 0, 10000, 'all');
  });

  it('recovers file-backed model history once and keeps the database version authoritative', async () => {
    const stored = model('stored');
    const recovered = model('recovered');
    state.list.mockReturnValue({ data: [stored] });
    state.files = [{ ...stored, name: 'Stale file title' }, recovered, model('foreign-file', 'another-owner')];
    expect(await new LocalConversationProvider().listConversations()).toEqual([stored, recovered]);
    expect(state.migrate).toHaveBeenCalledExactlyOnceWith(recovered);
  });
});
