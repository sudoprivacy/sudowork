import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CURRENT_DB_VERSION } from '@process/database/schema';
import { ALL_MIGRATIONS } from '@process/database/migrations';
import { teamStore } from '@process/services/team/TeamStore';
import type { Team, TeamMember, TeamTask } from '@process/services/team/TeamStore';

const h = vi.hoisted(() => ({
  mutate: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock('@process/database', () => ({
  getDatabase: () => ({
    mutate: h.mutate,
    query: h.query,
    queryOne: h.queryOne,
    runTransaction: h.runTransaction,
  }),
}));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    user_id: 'u1',
    name: 'Team A',
    workspace: '/tmp/ws',
    leader_member_id: null,
    session_mode: null,
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  };
}

function makeMember(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: 'slot-1',
    team_id: 'team-1',
    role: 'lead',
    name: 'Leader',
    assistant_id: 'asst-1',
    backend: 'scode',
    preset_agent_type: 'scode',
    skills: ['s1'],
    preset_context: 'rules',
    model: 'default',
    avatar: null,
    conversation_id: null,
    status: 'idle',
    created_at: 1000,
    ...overrides,
  };
}

function makeTask(overrides: Partial<TeamTask> = {}): TeamTask {
  return {
    id: 'task-1',
    team_id: 'team-1',
    subject: 'Do X',
    description: null,
    status: 'pending',
    owner: null,
    blocked_by: [],
    blocks: [],
    metadata: null,
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  };
}

beforeEach(() => {
  h.mutate.mockReset();
  h.query.mockReset();
  h.queryOne.mockReset();
  h.runTransaction.mockReset();
  h.mutate.mockReturnValue({ success: true, data: 1 });
  h.query.mockReturnValue({ success: true, data: [] });
  h.queryOne.mockReturnValue({ success: true, data: null });
  h.runTransaction.mockImplementation(<T>(fn: () => T) => ({ success: true, data: fn() }));
});

describe('migration_v24', () => {
  it('CURRENT_DB_VERSION is 24', () => {
    expect(CURRENT_DB_VERSION).toBe(24);
  });
  it('ALL_MIGRATIONS includes v24', () => {
    expect(ALL_MIGRATIONS.some((m) => m.version === 24)).toBe(true);
  });
  it('migration_v24 has name + up/down functions', () => {
    const m = ALL_MIGRATIONS.find((x) => x.version === 24)!;
    expect(m.name).toBeTruthy();
    expect(typeof m.up).toBe('function');
    expect(typeof m.down).toBe('function');
  });
});

describe('TeamStore - team CRUD + soft delete', () => {
  it('insertTeam calls mutate with INSERT INTO teams', () => {
    teamStore.insertTeam(makeTeam());
    expect(h.mutate).toHaveBeenCalledTimes(1);
    expect(h.mutate.mock.calls[0][0]).toContain('INSERT INTO teams');
    expect(h.mutate.mock.calls[0][1]).toBe('team-1');
  });
  it('insertTeam throws on DB failure', () => {
    h.mutate.mockReturnValue({ success: false, error: 'boom' });
    expect(() => teamStore.insertTeam(makeTeam())).toThrow('boom');
  });
  it('getTeam returns null when no row', () => {
    h.queryOne.mockReturnValue({ success: true, data: null });
    expect(teamStore.getTeam('team-1')).toBeNull();
  });
  it('getTeam queries with deleted = 0 filter and maps row', () => {
    h.queryOne.mockReturnValue({
      success: true,
      data: { id: 'team-1', user_id: 'u1', name: 'A', workspace: null, leader_member_id: null, session_mode: null, created_at: 1, updated_at: 2 },
    });
    const t = teamStore.getTeam('team-1');
    expect(h.queryOne.mock.calls[0][0]).toContain('deleted = 0');
    expect(t?.id).toBe('team-1');
    expect(t?.name).toBe('A');
  });
  it('updateTeam merges and updates', () => {
    h.queryOne.mockReturnValue({
      success: true,
      data: { id: 'team-1', user_id: 'u1', name: 'Old', workspace: null, leader_member_id: null, session_mode: null, created_at: 1, updated_at: 1 },
    });
    teamStore.updateTeam('team-1', { name: 'New' });
    expect(h.mutate.mock.calls[0][0]).toContain('UPDATE teams');
    expect(h.mutate.mock.calls[0][1]).toBe('New');
  });
  it('updateTeam throws if team not found', () => {
    h.queryOne.mockReturnValue({ success: true, data: null });
    expect(() => teamStore.updateTeam('team-1', { name: 'New' })).toThrow('Team not found');
  });
  it('softDeleteTeam sets deleted = 1', () => {
    teamStore.softDeleteTeam('team-1');
    expect(h.mutate.mock.calls[0][0]).toContain('deleted = 1');
  });
  it('listTeams queries with deleted = 0', () => {
    teamStore.listTeams();
    expect(h.query.mock.calls[0][0]).toContain('deleted = 0');
  });
  it('listByUser filters by user_id', () => {
    teamStore.listByUser('u1');
    expect(h.query.mock.calls[0][0]).toContain('user_id = ?');
    expect(h.query.mock.calls[0][1]).toBe('u1');
  });
});

describe('TeamStore - member CRUD + soft delete', () => {
  it('insertMember stringifies skills', () => {
    teamStore.insertMember(makeMember({ skills: ['a', 'b'] }));
    const params = h.mutate.mock.calls[0];
    expect(params[0]).toContain('INSERT INTO team_members');
    expect(params[8]).toBe(JSON.stringify(['a', 'b']));
  });
  it('getMember parses skills JSON', () => {
    h.queryOne.mockReturnValue({
      success: true,
      data: { id: 'slot-1', team_id: 'team-1', role: 'lead', name: 'L', assistant_id: null, backend: 'scode', preset_agent_type: 'scode', skills: JSON.stringify(['x']), preset_context: null, model: null, avatar: null, conversation_id: null, status: 'idle', created_at: 1 },
    });
    expect(teamStore.getMember('slot-1')?.skills).toEqual(['x']);
  });
  it('softDeleteMember sets deleted = 1', () => {
    teamStore.softDeleteMember('slot-1');
    expect(h.mutate.mock.calls[0][0]).toContain('deleted = 1');
  });
});

describe('TeamStore - mailbox peek-then-mark', () => {
  it('peekUnread uses query (NOT mutate) with read = 0', () => {
    teamStore.peekUnread('team-1', 'slot-1');
    expect(h.query).toHaveBeenCalledTimes(1);
    expect(h.query.mock.calls[0][0]).toContain('read = 0');
    expect(h.mutate).not.toHaveBeenCalled();
  });
  it('markReadBatch empty returns 0 and does not call mutate', () => {
    expect(teamStore.markReadBatch([])).toBe(0);
    expect(h.mutate).not.toHaveBeenCalled();
  });
  it('markReadBatch chunks >500 into multiple mutate calls', () => {
    h.mutate.mockReturnValue({ success: true, data: 500 });
    const ids = Array.from({ length: 550 }, (_, i) => `m${i}`);
    teamStore.markReadBatch(ids);
    expect(h.mutate).toHaveBeenCalledTimes(2);
  });
  it('markReadBatch uses UPDATE read = 1 WHERE id IN', () => {
    teamStore.markReadBatch(['m1']);
    expect(h.mutate.mock.calls[0][0]).toContain('read = 1');
    expect(h.mutate.mock.calls[0][0]).toContain('IN');
  });
  it('hasUnread uses COUNT with read = 0', () => {
    h.queryOne.mockReturnValue({ success: true, data: { count: 0 } });
    teamStore.hasUnread('team-1', 'slot-1');
    expect(h.queryOne.mock.calls[0][0]).toContain('COUNT');
    expect(h.queryOne.mock.calls[0][0]).toContain('read = 0');
  });
  it('hasUnread returns true when count > 0', () => {
    h.queryOne.mockReturnValue({ success: true, data: { count: 3 } });
    expect(teamStore.hasUnread('team-1', 'slot-1')).toBe(true);
  });
  it('getHistory does not filter by read', () => {
    teamStore.getHistory('team-1', 'slot-1');
    expect(h.query.mock.calls[0][0]).not.toContain('read = 0');
  });
});

describe('TeamStore - task CRUD', () => {
  it('insertTask stringifies blocked_by/blocks/metadata', () => {
    teamStore.insertTask(makeTask({ blocked_by: ['t0'], blocks: ['t2'], metadata: { k: 1 } }));
    const params = h.mutate.mock.calls[0];
    expect(params[0]).toContain('INSERT INTO team_tasks');
    expect(params.some((p) => p === JSON.stringify(['t0']))).toBe(true);
    expect(params.some((p) => p === JSON.stringify({ k: 1 }))).toBe(true);
  });
  it('getTask parses JSON arrays/object', () => {
    h.queryOne.mockReturnValue({
      success: true,
      data: { id: 'task-1', team_id: 'team-1', subject: 'S', description: null, status: 'pending', owner: null, blocked_by: JSON.stringify(['a']), blocks: JSON.stringify(['b']), metadata: JSON.stringify({ k: 1 }), created_at: 1, updated_at: 1 },
    });
    const t = teamStore.getTask('task-1');
    expect(t?.blocked_by).toEqual(['a']);
    expect(t?.blocks).toEqual(['b']);
    expect(t?.metadata).toEqual({ k: 1 });
  });
  it('listTasksByTeam excludes deleted status', () => {
    teamStore.listTasksByTeam('team-1');
    expect(h.query.mock.calls[0][0]).toContain("status != 'deleted'");
  });
});
