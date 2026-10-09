import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Team, TeamMember } from '@process/services/team/TeamStore';

const h = vi.hoisted(() => ({
  listLeaderlessTeams: vi.fn(),
  getTeam: vi.fn(),
  listMembersByTeam: vi.fn(),
  softDeleteMembersByTeam: vi.fn(),
  softDeleteTeam: vi.fn(),
  hardDeleteMailboxByTeam: vi.fn(),
  hardDeleteTasksByTeam: vi.fn(),
  reapConversation: vi.fn(),
  isSafeAutoWorkspacePath: vi.fn(),
  fsRm: vi.fn(),
}));

vi.mock('fs/promises', () => ({ default: { rm: (...args: unknown[]) => h.fsRm(...args) } }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));
vi.mock('@process/services/team/TeamStore', () => ({
  teamStore: {
    listLeaderlessTeams: (...args: unknown[]) => h.listLeaderlessTeams(...args),
    getTeam: (...args: unknown[]) => h.getTeam(...args),
    listMembersByTeam: (...args: unknown[]) => h.listMembersByTeam(...args),
    softDeleteMembersByTeam: (...args: unknown[]) => h.softDeleteMembersByTeam(...args),
    softDeleteTeam: (...args: unknown[]) => h.softDeleteTeam(...args),
    hardDeleteMailboxByTeam: (...args: unknown[]) => h.hardDeleteMailboxByTeam(...args),
    hardDeleteTasksByTeam: (...args: unknown[]) => h.hardDeleteTasksByTeam(...args),
  },
}));
vi.mock('@process/services/conversationReaper', () => ({
  reapConversation: (...args: unknown[]) => h.reapConversation(...args),
  isSafeAutoWorkspacePath: (p: string) => h.isSafeAutoWorkspacePath(p),
}));

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 't1',
    user_id: 'u1',
    name: 'Half-team',
    workspace: '/root/ws-temp-1',
    workspace_kind: 'temporary',
    leader_member_id: null,
    session_mode: null,
    pinned: false,
    pinned_at: null,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function makeMember(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: 'slot-1',
    team_id: 't1',
    role: 'teammate',
    name: 'Worker',
    assistant_id: null,
    source: null,
    backend: 'scode',
    preset_agent_type: 'scode',
    skills: [],
    preset_context: null,
    model: null,
    avatar: null,
    conversation_id: 'conv-1',
    status: 'idle',
    created_at: 1,
    ...overrides,
  };
}

const STALE_AGE_MS = 11 * 60 * 1000; // above the 10-minute freshness guard

beforeEach(() => {
  h.listLeaderlessTeams.mockReset().mockReturnValue([]);
  h.getTeam.mockReset().mockReturnValue(null);
  h.listMembersByTeam.mockReset().mockReturnValue([]);
  h.softDeleteMembersByTeam.mockReset();
  h.softDeleteTeam.mockReset();
  h.hardDeleteMailboxByTeam.mockReset();
  h.hardDeleteTasksByTeam.mockReset();
  h.reapConversation.mockReset().mockResolvedValue(undefined);
  h.isSafeAutoWorkspacePath.mockReset().mockReturnValue(false);
  h.fsRm.mockReset().mockResolvedValue(undefined);
});

describe('TeamStartupCleaner (M2)', () => {
  it('sweeps a stale leaderless team end to end: reap → soft-delete → hard-delete → remove managed workspace', async () => {
    const team = makeTeam({ created_at: Date.now() - STALE_AGE_MS });
    h.listLeaderlessTeams.mockReturnValue([team]);
    h.getTeam.mockReturnValue(team); // the pre-soft-delete workspace read
    h.listMembersByTeam.mockReturnValue([makeMember({ conversation_id: 'conv-1' }), makeMember({ id: 'slot-2', conversation_id: null })]);
    h.isSafeAutoWorkspacePath.mockReturnValue(true);
    const { sweepLeaderlessTeams } = await import('@process/services/team/TeamStartupCleaner');

    const { swept } = await sweepLeaderlessTeams();

    expect(swept).toBe(1);
    expect(h.reapConversation).toHaveBeenCalledTimes(1);
    expect(h.reapConversation).toHaveBeenCalledWith('conv-1', { reason: 'team-spawn-rollback', deleteWorkspace: false });
    expect(h.softDeleteMembersByTeam).toHaveBeenCalledWith('t1');
    expect(h.softDeleteTeam).toHaveBeenCalledWith('t1');
    expect(h.hardDeleteMailboxByTeam).toHaveBeenCalledWith('t1');
    expect(h.hardDeleteTasksByTeam).toHaveBeenCalledWith('t1');
    expect(h.fsRm).toHaveBeenCalledWith('/root/ws-temp-1', { recursive: true, force: true });
  });

  it('skips a fresh leaderless team (leader provision may still be in flight)', async () => {
    h.listLeaderlessTeams.mockReturnValue([makeTeam({ created_at: Date.now() })]);
    const { sweepLeaderlessTeams } = await import('@process/services/team/TeamStartupCleaner');

    const { swept } = await sweepLeaderlessTeams();

    expect(swept).toBe(0);
    expect(h.reapConversation).not.toHaveBeenCalled();
    expect(h.softDeleteTeam).not.toHaveBeenCalled();
    expect(h.fsRm).not.toHaveBeenCalled();
  });

  it('keeps the workspace when the safety guard rejects the path, but still sweeps the rows', async () => {
    const team = makeTeam({ id: 't2', created_at: Date.now() - STALE_AGE_MS });
    h.listLeaderlessTeams.mockReturnValue([team]);
    h.getTeam.mockReturnValue(team);
    h.listMembersByTeam.mockReturnValue([]);
    h.isSafeAutoWorkspacePath.mockReturnValue(false);
    const { sweepLeaderlessTeams } = await import('@process/services/team/TeamStartupCleaner');

    const { swept } = await sweepLeaderlessTeams();

    expect(swept).toBe(1);
    expect(h.softDeleteTeam).toHaveBeenCalledWith('t2');
    expect(h.fsRm).not.toHaveBeenCalled();
  });
});
