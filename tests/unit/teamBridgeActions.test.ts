import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const providers = new Map<string, (params: any) => unknown>();
  const makeProvider = (name: string) => ({
    provider: vi.fn((fn: (params: any) => unknown) => {
      providers.set(name, fn);
    }),
  });
  return {
    providers,
    makeProvider,
    getDefaultUserId: vi.fn(() => 'user-1'),
    createTeam: vi.fn(),
    updateTeam: vi.fn(),
    renameTeam: vi.fn(),
    answerQuestion: vi.fn(),
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      listTeams: h.makeProvider('listTeams'),
      getTeam: h.makeProvider('getTeam'),
      listMembers: h.makeProvider('listMembers'),
      listAssistants: h.makeProvider('listAssistants'),
      createTeam: h.makeProvider('createTeam'),
      updateTeam: h.makeProvider('updateTeam'),
      removeTeam: h.makeProvider('removeTeam'),
      renameTeam: h.makeProvider('renameTeam'),
      addMember: h.makeProvider('addMember'),
      removeMember: h.makeProvider('removeMember'),
      sendMessage: h.makeProvider('sendMessage'),
      sendMessageToMember: h.makeProvider('sendMessageToMember'),
      answerQuestion: h.makeProvider('answerQuestion'),
      getRunState: h.makeProvider('getRunState'),
      cancelRun: h.makeProvider('cancelRun'),
      cancelChildTurn: h.makeProvider('cancelChildTurn'),
      renewActiveLease: h.makeProvider('renewActiveLease'),
      setSessionMode: h.makeProvider('setSessionMode'),
      ensureSession: h.makeProvider('ensureSession'),
      stopSession: h.makeProvider('stopSession'),
      pauseMember: h.makeProvider('pauseMember'),
      renameMember: h.makeProvider('renameMember'),
      reorderMembers: h.makeProvider('reorderMembers'),
    },
  },
}));
vi.mock('@process/database', () => ({ getDatabase: () => ({ getDefaultUserId: h.getDefaultUserId }) }));
vi.mock('@process/services/team/TeamService', () => ({
  teamService: {
    updateTeam: h.updateTeam,
    renameTeam: h.renameTeam,
    listTeams: vi.fn(),
    getTeam: vi.fn(),
    listMembers: vi.fn(),
    listAvailableAssistantsForTeam: vi.fn(),
    createTeam: h.createTeam,
    removeTeam: vi.fn(),
    spawnMember: vi.fn(),
    removeMember: vi.fn(),
    sendMessage: vi.fn(),
    sendMessageToMember: vi.fn(),
    answerQuestion: h.answerQuestion,
    getRunState: vi.fn(),
    cancelRun: vi.fn(),
    cancelChildTurn: vi.fn(),
    renewActiveLease: vi.fn(),
    setSessionMode: vi.fn(),
    rebuildTeam: vi.fn(),
    stopTeamSession: vi.fn(),
    pauseMember: vi.fn(),
    renameMember: vi.fn(),
  },
}));
vi.mock('@process/services/team/TeamStore', () => ({ teamStore: { getMember: vi.fn() } }));
vi.mock('@process/utils/mainLogger', () => ({ mainError: vi.fn() }));

beforeEach(() => {
  h.providers.clear();
  h.createTeam.mockReset();
  h.updateTeam.mockReset();
  h.renameTeam.mockReset();
  h.answerQuestion.mockReset();
});

describe('teamBridge team history providers', () => {
  it('wires createTeam provider to TeamService.createTeam with members', async () => {
    const result = { id: 'team-1', name: 'Team' };
    const members = [
      { assistant_id: 'scode', name: 'Leader', role: 'lead' },
      { assistant_id: 'scode', name: 'Worker', role: 'teammate', model: 'model-1' },
    ];
    h.createTeam.mockResolvedValue(result);
    const { initTeamBridge } = await import('@process/bridge/teamBridge');
    initTeamBridge();

    await expect(h.providers.get('createTeam')?.({ name: 'Team', workspace: '/workspace', members })).resolves.toBe(result);
    expect(h.createTeam).toHaveBeenCalledWith('user-1', 'Team', '/workspace', members);
  });

  it('wires updateTeam provider to TeamService.updateTeam', async () => {
    const result = { id: 'team-1', name: 'Team' };
    h.updateTeam.mockReturnValue(result);
    const { initTeamBridge } = await import('@process/bridge/teamBridge');
    initTeamBridge();

    await expect(h.providers.get('updateTeam')?.({ teamId: 'team-1', updates: { pinned: true, pinned_at: 123 } })).resolves.toBe(result);
    expect(h.updateTeam).toHaveBeenCalledWith('team-1', { pinned: true, pinned_at: 123 });
  });

  it('wires renameTeam provider to TeamService.renameTeam', async () => {
    const result = { id: 'team-1', name: 'New Team' };
    h.renameTeam.mockReturnValue(result);
    const { initTeamBridge } = await import('@process/bridge/teamBridge');
    initTeamBridge();

    await expect(h.providers.get('renameTeam')?.({ teamId: 'team-1', name: 'New Team' })).resolves.toBe(result);
    expect(h.renameTeam).toHaveBeenCalledWith('team-1', 'New Team');
  });

  it('wires answerQuestion provider to TeamService.answerQuestion', async () => {
    h.answerQuestion.mockResolvedValue(undefined);
    const { initTeamBridge } = await import('@process/bridge/teamBridge');
    initTeamBridge();

    await expect(
      h.providers.get('answerQuestion')?.({
        teamId: 'team-1',
        memberId: 'slot-1',
        conversationId: 'conv-1',
        toolCallId: 'tool-1',
        answers: [{ id: 'q1', value: 'yes', label: 'Yes' }],
      })
    ).resolves.toEqual({ success: true });
    expect(h.answerQuestion).toHaveBeenCalledWith('team-1', 'slot-1', 'conv-1', 'tool-1', [{ id: 'q1', value: 'yes', label: 'Yes' }]);
  });
});
