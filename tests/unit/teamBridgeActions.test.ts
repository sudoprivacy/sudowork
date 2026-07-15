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
    updateTeam: vi.fn(),
    renameTeam: vi.fn(),
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
    createTeam: vi.fn(),
    removeTeam: vi.fn(),
    spawnMember: vi.fn(),
    removeMember: vi.fn(),
    sendMessage: vi.fn(),
    sendMessageToMember: vi.fn(),
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
  h.updateTeam.mockReset();
  h.renameTeam.mockReset();
});

describe('teamBridge team history providers', () => {
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
});
