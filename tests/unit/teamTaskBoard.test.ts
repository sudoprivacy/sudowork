import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TeamTask } from '@process/services/team/TeamStore';

vi.mock('@process/database', () => ({ getDatabase: () => ({}) }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));

// teamStore is the real singleton; spy its task methods onto an in-memory store so cycle
// detection and reverse-edge maintenance run against real data without touching SQLite.
import { teamStore } from '@process/services/team/TeamStore';
import { TaskBoard } from '@process/services/team/TaskBoard';

let store: Map<string, TeamTask>;

beforeEach(() => {
  store = new Map();
  vi.spyOn(teamStore, 'insertTask').mockImplementation((t: TeamTask) => {
    store.set(t.id, { ...t });
  });
  vi.spyOn(teamStore, 'updateTask').mockImplementation((id: string, updates: Partial<TeamTask>) => {
    const ex = store.get(id);
    if (!ex) throw new Error(`Task not found: ${id}`);
    const merged: TeamTask = { ...ex, ...updates, updated_at: Date.now() };
    store.set(id, merged);
  });
  vi.spyOn(teamStore, 'getTask').mockImplementation((id: string) => store.get(id) ?? null);
  vi.spyOn(teamStore, 'listTasksByTeam').mockImplementation(() => [...store.values()]);
});

describe('TaskBoard reverse edges', () => {
  it('createTask seeds the reverse blocks edge on each dependency', () => {
    const board = new TaskBoard('t1');
    const t1 = board.createTask({ subject: 'T1' });
    const t2 = board.createTask({ subject: 'T2', blocked_by: [t1.id] });
    expect(t2.blocked_by).toEqual([t1.id]);
    const refreshedT1 = board.getTask(t1.id)!;
    expect(refreshedT1.blocks).toEqual([t2.id]);
  });

  it('changing blocked_by adjusts reverse edges on old and new deps', () => {
    const board = new TaskBoard('t1');
    const t1 = board.createTask({ subject: 'T1' });
    const t3 = board.createTask({ subject: 'T3' });
    const t2 = board.createTask({ subject: 'T2', blocked_by: [t1.id] });
    expect(board.getTask(t1.id)!.blocks).toEqual([t2.id]);
    board.updateTask(t2.id, { blocked_by: [t3.id] });
    expect(board.getTask(t1.id)!.blocks).toEqual([]); // t2 no longer blocks-on t1
    expect(board.getTask(t3.id)!.blocks).toEqual([t2.id]); // t2 now blocks-on t3
    expect(board.getTask(t2.id)!.blocked_by).toEqual([t3.id]);
  });
});

describe('TaskBoard cycle detection', () => {
  it('rejects self-dependency on update', () => {
    const board = new TaskBoard('t1');
    const t1 = board.createTask({ subject: 'T1' });
    expect(() => board.updateTask(t1.id, { blocked_by: [t1.id] })).toThrow(/cycle/);
  });

  it('rejects a direct A↔B cycle', () => {
    const board = new TaskBoard('t1');
    const t1 = board.createTask({ subject: 'T1' });
    const t2 = board.createTask({ subject: 'T2', blocked_by: [t1.id] });
    expect(() => board.updateTask(t1.id, { blocked_by: [t2.id] })).toThrow(/cycle/);
  });

  it('rejects a longer cycle A→C→B→A', () => {
    const board = new TaskBoard('t1');
    const t1 = board.createTask({ subject: 'T1' });
    const t2 = board.createTask({ subject: 'T2', blocked_by: [t1.id] });
    const t3 = board.createTask({ subject: 'T3', blocked_by: [t2.id] });
    // T1 → T3 → T2 → T1 forms a cycle
    expect(() => board.updateTask(t1.id, { blocked_by: [t3.id] })).toThrow(/cycle/);
  });

  it('accepts a valid DAG with multiple dependencies', () => {
    const board = new TaskBoard('t1');
    const t1 = board.createTask({ subject: 'T1' });
    const t2 = board.createTask({ subject: 'T2' });
    const t3 = board.createTask({ subject: 'T3' });
    expect(() => board.createTask({ subject: 'T4', blocked_by: [t1.id, t2.id, t3.id] })).not.toThrow();
  });

  it('rejects missing or cross-team blocked_by task ids', () => {
    const board = new TaskBoard('t1');
    const otherTeamTask: TeamTask = { ...board.createTask({ subject: 'T1' }), id: 'other-task', team_id: 'other-team' };
    store.set(otherTeamTask.id, otherTeamTask);

    expect(() => board.createTask({ subject: 'bad', blocked_by: ['missing-task'] })).toThrow(/Invalid blocked_by/);
    expect(() => board.updateTask(otherTeamTask.id, { blocked_by: [] })).toThrow(/Task not found/);
    expect(() => board.createTask({ subject: 'bad', blocked_by: [otherTeamTask.id] })).toThrow(/Invalid blocked_by/);
  });
});

describe('TaskBoard completion dismantles edges', () => {
  it('terminal update with new blocked_by leaves no forward or reverse edges', () => {
    const board = new TaskBoard('t1');
    const t1 = board.createTask({ subject: 'T1' });
    const t2 = board.createTask({ subject: 'T2' });

    board.updateTask(t2.id, { status: 'completed', blocked_by: [t1.id] });

    expect(board.getTask(t1.id)!.blocks).toEqual([]);
    expect(board.getTask(t2.id)!.blocked_by).toEqual([]);
    expect(board.getTask(t2.id)!.blocks).toEqual([]);
  });

  it('completing a task removes it from dependents and clears its own edges', () => {
    const board = new TaskBoard('t1');
    const t1 = board.createTask({ subject: 'T1' });
    const t2 = board.createTask({ subject: 'T2', blocked_by: [t1.id] });
    // t2 blocked_by t1 ⇒ t1.blocks = [t2]
    expect(board.getTask(t1.id)!.blocks).toEqual([t2.id]);
    board.updateTask(t2.id, { status: 'completed' });
    expect(board.getTask(t1.id)!.blocks).toEqual([]); // t2 removed from t1's blockers
    expect(board.getTask(t2.id)!.blocked_by).toEqual([]); // t2's own edges cleared
    expect(board.getTask(t2.id)!.blocks).toEqual([]);
  });
});
