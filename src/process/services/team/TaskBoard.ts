import { uuid } from '@/common/utils';
import { teamStore, type TeamTask, type TeamTaskStatus } from './TeamStore';

/** Task statuses that resolve a task and dismantle its dependency edges. */
const TERMINAL_TASK_STATUSES = new Set<TeamTaskStatus>(['completed', 'failed', 'cancelled', 'deleted']);

/**
 * TaskBoard — task CRUD with bidirectional dependency edges and cycle detection (plan §1.3).
 *
 * `blocked_by` is the forward edge (this task waits on those); `blocks` is the reverse edge
 * (those tasks wait on this one). Creating a task seeds the reverse edges; completing it
 * dismantles them. Cycle detection (self-dependency, direct A↔B, longer cycles) runs on
 * create and on any blocked_by change — a cycle is rejected. The board never triggers wakes.
 */
export class TaskBoard {
  constructor(private readonly teamId: string) {}

  createTask(params: { subject: string; description?: string | null; owner?: string | null; blocked_by?: string[] }): TeamTask {
    const taskId = uuid(36);
    const blockedBy = dedupe(params.blocked_by ?? []);
    this.validateBlockedBy(blockedBy);
    if (this.detectCycle(taskId, blockedBy)) throw new Error('task dependency cycle detected');
    const now = Date.now();
    const task: TeamTask = {
      id: taskId,
      team_id: this.teamId,
      subject: params.subject,
      description: params.description ?? null,
      status: 'pending',
      owner: params.owner ?? null,
      blocked_by: blockedBy,
      blocks: [],
      metadata: null,
      created_at: now,
      updated_at: now,
    };
    teamStore.insertTask(task);
    this.addReverseBlocks(taskId, blockedBy);
    return task;
  }

  updateTask(taskId: string, updates: Partial<Pick<TeamTask, 'subject' | 'description' | 'status' | 'owner' | 'blocked_by'>>): TeamTask {
    const existing = teamStore.getTask(taskId);
    if (!existing || existing.team_id !== this.teamId) throw new Error(`Task not found: ${taskId}`);

    const oldBlockedBy = existing.blocked_by;
    const newStatus = updates.status ?? existing.status;
    const isEnteringTerminal = updates.status != null && !TERMINAL_TASK_STATUSES.has(existing.status) && TERMINAL_TASK_STATUSES.has(newStatus);
    const requestedBlockedBy = updates.blocked_by != null ? dedupe(updates.blocked_by) : oldBlockedBy;
    if (updates.blocked_by != null) this.validateBlockedBy(requestedBlockedBy);
    const newBlockedBy = isEnteringTerminal ? [] : requestedBlockedBy;
    if (updates.blocked_by != null && !isEnteringTerminal && this.detectCycle(taskId, newBlockedBy)) throw new Error('task dependency cycle detected');

    // Adjust reverse edges when the dependency set changes.
    if (updates.blocked_by != null || isEnteringTerminal) this.adjustReverseBlocks(taskId, oldBlockedBy, newBlockedBy);

    if (isEnteringTerminal) this.dismantleEdges(existing);

    teamStore.updateTask(taskId, { ...updates, blocked_by: newBlockedBy, ...(isEnteringTerminal ? { blocks: [] } : {}) });

    return teamStore.getTask(taskId) ?? { ...existing, ...updates, blocked_by: newBlockedBy, blocks: isEnteringTerminal ? [] : existing.blocks };
  }

  listTasks(): TeamTask[] {
    return teamStore.listTasksByTeam(this.teamId);
  }

  getTask(taskId: string): TeamTask | null {
    const task = teamStore.getTask(taskId);
    return task && task.team_id === this.teamId ? task : null;
  }

  // ---- cycle detection (DFS over blocked_by) ----

  private validateBlockedBy(ids: string[]): void {
    const invalidIds = ids.filter((id) => teamStore.getTask(id)?.team_id !== this.teamId);
    if (invalidIds.length > 0) throw new Error(`Invalid blocked_by task id(s): ${invalidIds.join(', ')}`);
  }

  private detectCycle(taskId: string, proposedBlockedBy: string[]): boolean {
    if (proposedBlockedBy.includes(taskId)) return true; // self-dependency
    const adj = new Map<string, string[]>();
    for (const t of teamStore.listTasksByTeam(this.teamId)) adj.set(t.id, [...t.blocked_by]);
    adj.set(taskId, proposedBlockedBy); // override this task's out-edges with the proposal
    const visited = new Set<string>();
    const dfs = (id: string): boolean => {
      for (const dep of adj.get(id) ?? []) {
        if (dep === taskId) return true; // path returns to the start → cycle
        if (visited.has(dep)) continue;
        visited.add(dep);
        if (dfs(dep)) return true;
      }
      return false;
    };
    return dfs(taskId);
  }

  // ---- reverse-edge maintenance ----

  private addReverseBlocks(taskId: string, deps: string[]): void {
    for (const dep of deps) this.patchTask(dep, (t) => (t.blocks.includes(taskId) ? t : { ...t, blocks: [...t.blocks, taskId] }));
  }

  private adjustReverseBlocks(taskId: string, oldDeps: string[], newDeps: string[]): void {
    const oldSet = new Set(oldDeps);
    const newSet = new Set(newDeps);
    for (const dep of oldDeps) {
      if (!newSet.has(dep)) this.patchTask(dep, (t) => ({ ...t, blocks: t.blocks.filter((id) => id !== taskId) }));
    }
    for (const dep of newDeps) {
      if (!oldSet.has(dep)) this.patchTask(dep, (t) => (t.blocks.includes(taskId) ? t : { ...t, blocks: [...t.blocks, taskId] }));
    }
  }

  private dismantleEdges(task: TeamTask): void {
    for (const dep of task.blocked_by) {
      this.patchTask(dep, (t) => ({ ...t, blocks: t.blocks.filter((id) => id !== task.id) }));
    }
    for (const blocker of task.blocks) {
      this.patchTask(blocker, (t) => ({ ...t, blocked_by: t.blocked_by.filter((id) => id !== task.id) }));
    }
  }

  private patchTask(taskId: string, fn: (t: TeamTask) => TeamTask): void {
    const t = teamStore.getTask(taskId);
    if (!t || t.team_id !== this.teamId) return;
    const next = fn(t);
    teamStore.updateTask(taskId, { blocks: next.blocks, blocked_by: next.blocked_by });
  }
}

function dedupe(ids: string[]): string[] {
  return Array.from(new Set(ids));
}
