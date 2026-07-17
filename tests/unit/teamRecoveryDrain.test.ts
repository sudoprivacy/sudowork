import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecoveryDrain } from '@process/services/team/RecoveryDrain';
import { TeamRunManager } from '@process/services/team/TeamRun';
import { SlotWakeGate } from '@process/services/team/SlotWakeGate';
import type { TeamMember } from '@process/services/team/TeamStore';

const h = vi.hoisted(() => ({
  listMembersByTeam: vi.fn(),
  hasUnread: vi.fn(),
  notifyWake: vi.fn(),
}));

vi.mock('@process/database', () => ({
  getDatabase: () => ({ mutate: vi.fn(), query: vi.fn(), queryOne: vi.fn(), runTransaction: vi.fn() }),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      onRunAccepted: { emit: vi.fn() },
      onRunStarted: { emit: vi.fn() },
      onRunUpdated: { emit: vi.fn() },
      onRunCompleted: { emit: vi.fn() },
      onRunCancelled: { emit: vi.fn() },
      onRunFailed: { emit: vi.fn() },
    },
  },
}));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));

// teamStore reads members/unread via getDatabase; drive it through the store's own methods.
import { teamStore } from '@process/services/team/TeamStore';

function makeMember(id: string, role: 'lead' | 'teammate'): TeamMember {
  return {
    id,
    team_id: 't1',
    role,
    name: id,
    assistant_id: null,
    backend: 'scode',
    preset_agent_type: 'scode',
    skills: [],
    preset_context: null,
    model: null,
    avatar: null,
    conversation_id: `c-${id}`,
    status: 'idle',
    created_at: 1,
  };
}

beforeEach(() => {
  h.listMembersByTeam.mockReset();
  h.hasUnread.mockReset();
  h.notifyWake.mockReset();
  vi.spyOn(teamStore, 'listMembersByTeam').mockImplementation(h.listMembersByTeam);
  vi.spyOn(teamStore, 'hasUnread').mockImplementation(h.hasUnread);
});

describe('RecoveryDrain (附录 I.4)', () => {
  it('does nothing when no member has unread backlog', () => {
    const teamRun = new TeamRunManager('t1', new SlotWakeGate());
    h.listMembersByTeam.mockReturnValue([makeMember('lead', 'lead'), makeMember('t1', 'teammate')]);
    h.hasUnread.mockReturnValue(false);
    new RecoveryDrain('t1', teamRun, h.notifyWake).drain();
    expect(teamRun.hasActiveRun()).toBe(false);
    expect(h.notifyWake).not.toHaveBeenCalled();
  });

  it('creates a recovery run and re-delivers each backlogged slot', () => {
    const teamRun = new TeamRunManager('t1', new SlotWakeGate());
    h.listMembersByTeam.mockReturnValue([makeMember('lead', 'lead'), makeMember('t1', 'teammate'), makeMember('t2', 'teammate')]);
    h.hasUnread.mockImplementation((_teamId: string, slotId: string) => slotId === 't1' || slotId === 't2');
    new RecoveryDrain('t1', teamRun, h.notifyWake).drain();
    expect(teamRun.hasActiveRun()).toBe(true);
    expect(teamRun.getRecord()!.source).toBe('recovery_drain');
    expect(teamRun.hasPendingWake('t1')).toBe(true);
    expect(teamRun.hasPendingWake('t2')).toBe(true);
    expect(h.notifyWake).toHaveBeenCalledWith('t1');
    expect(h.notifyWake).toHaveBeenCalledWith('t2');
    expect(h.notifyWake).not.toHaveBeenCalledWith('lead');
  });

  it('no-op when a run is already active', () => {
    const teamRun = new TeamRunManager('t1', new SlotWakeGate());
    teamRun.acquireWake('lead', 'lead', 'user_message'); // active run
    h.listMembersByTeam.mockReturnValue([makeMember('lead', 'lead')]);
    h.hasUnread.mockReturnValue(true);
    new RecoveryDrain('t1', teamRun, h.notifyWake).drain();
    expect(teamRun.getRecord()!.source).toBe('user_message'); // not replaced by recovery
    expect(h.notifyWake).not.toHaveBeenCalled();
  });
});
