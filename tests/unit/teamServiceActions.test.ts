import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Team } from '@process/services/team/TeamStore';

const h = vi.hoisted(() => ({
  emitListChanged: vi.fn(),
  emitSessionChanged: vi.fn(),
  getConversation: vi.fn(),
  updateConversation: vi.fn(),
  getTeam: vi.fn(),
  listMembersByTeam: vi.fn(),
  updateTeam: vi.fn(),
}));

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '', getPath: () => '' } }));
vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: { responseStream: { on: vi.fn(() => vi.fn()) } },
    team: {
      onListChanged: { emit: h.emitListChanged },
      onSessionChanged: { emit: h.emitSessionChanged },
      onAgentStatusChanged: { emit: vi.fn() },
      onMemberRenamed: { emit: vi.fn() },
      onMemberRemoved: { emit: vi.fn() },
    },
  },
}));
vi.mock('@process/database', () => ({
  getDatabase: () => ({
    getConversation: h.getConversation,
    updateConversation: h.updateConversation,
  }),
}));
vi.mock('@process/WorkerManage', () => ({ default: { buildConversation: vi.fn() } }));
vi.mock('@/process/AssistantManager', () => ({ assistantManager: { getAssistantMeta: vi.fn(), getInstalledAssistants: vi.fn() } }));
vi.mock('@/agent/acp/AcpDetector', () => ({ acpDetector: { getDetectedAgents: vi.fn(() => []) } }));
vi.mock('@process/services/claudeCli/NodeRuntimeService', () => ({ getNodeBinaryPath: () => 'node' }));
vi.mock('@process/utils/assistantResources', () => ({ readAssistantResource: vi.fn(), ruleFilePattern: /.*/ }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));
vi.mock('@process/services/conversationService', () => ({ createConversation: vi.fn() }));
vi.mock('@process/services/conversationReaper', () => ({ reapConversation: vi.fn(), resolveWorkspaceDeletion: vi.fn(() => false) }));
vi.mock('@process/services/team/TeamStore', () => ({
  teamStore: {
    getTeam: h.getTeam,
    listMembersByTeam: h.listMembersByTeam,
    updateTeam: h.updateTeam,
  },
}));

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    user_id: 'user-1',
    name: 'Old Team',
    workspace: '/tmp/old',
    workspace_kind: 'custom',
    leader_member_id: null,
    session_mode: null,
    pinned: false,
    pinned_at: null,
    created_at: 100,
    updated_at: 100,
    ...overrides,
  };
}

beforeEach(() => {
  h.emitListChanged.mockReset();
  h.emitSessionChanged.mockReset();
  h.getConversation.mockReset();
  h.updateConversation.mockReset();
  h.getTeam.mockReset();
  h.listMembersByTeam.mockReset();
  h.updateTeam.mockReset();
  h.listMembersByTeam.mockReturnValue([]);
});

describe('TeamService team history actions', () => {
  it('updates pin state and emits an updated list event', async () => {
    const { teamService } = await import('@process/services/team/TeamService');
    h.getTeam.mockReturnValueOnce(makeTeam()).mockReturnValueOnce(makeTeam({ pinned: true, pinned_at: 123 }));

    const team = teamService.updateTeam('team-1', { pinned: true, pinned_at: 123 });

    expect(h.updateTeam).toHaveBeenCalledWith('team-1', { pinned: true, pinned_at: 123 });
    expect(h.emitListChanged).toHaveBeenCalledWith({ team_id: 'team-1', action: 'updated' });
    expect(h.emitSessionChanged).not.toHaveBeenCalled();
    expect(team.pinned).toBe(true);
  });

  it('renames a team, syncs conversation display names, and emits rename events', async () => {
    const { teamService } = await import('@process/services/team/TeamService');
    h.getTeam.mockReturnValueOnce(makeTeam()).mockReturnValueOnce(makeTeam({ name: 'New Team' }));
    h.listMembersByTeam.mockReturnValue([{ id: 'leader-slot', team_id: 'team-1', role: 'lead', name: 'Leader', assistant_id: null, backend: 'scode', preset_agent_type: 'scode', skills: [], preset_context: null, model: null, avatar: null, conversation_id: 'conv-1', status: 'idle', created_at: 1 }]);
    h.getConversation.mockReturnValue({ data: { id: 'conv-1', name: 'Old Team', extra: { workspaceDisplayName: 'Old Team' } } });

    const team = teamService.renameTeam('team-1', ' New Team ');

    expect(h.updateTeam).toHaveBeenCalledWith('team-1', { name: 'New Team' });
    expect(h.updateConversation).toHaveBeenCalledWith('conv-1', { name: 'New Team', extra: { workspaceDisplayName: 'New Team' } });
    expect(h.emitListChanged).toHaveBeenCalledWith({ team_id: 'team-1', action: 'renamed' });
    expect(h.emitSessionChanged).toHaveBeenCalledWith({ teamId: 'team-1' });
    expect(team.name).toBe('New Team');
  });

  it('ignores fields outside the update whitelist', async () => {
    const { teamService } = await import('@process/services/team/TeamService');
    const existing = makeTeam();
    h.getTeam.mockReturnValue(existing);

    const team = teamService.updateTeam('team-1', { workspace: '/tmp/new' } as Partial<Team>);

    expect(h.updateTeam).not.toHaveBeenCalled();
    expect(h.emitListChanged).not.toHaveBeenCalled();
    expect(team).toBe(existing);
  });
});
