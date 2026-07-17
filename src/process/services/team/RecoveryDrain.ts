import { mainLog } from '@process/utils/mainLogger';
import { teamStore } from './TeamStore';
import type { TeamRunManager, TeamRole } from './TeamRun';

/**
 * RecoveryDrain — session-start backlog recovery (附录 I.4 / plan §1.3).
 *
 * Called once per session lifecycle: scans every member's unread mailbox. If any
 * backlog exists and no run is already active, it creates a recovery_drain run and
 * seeds a pending wake per backlogged slot, then notifies each slot's event loop so
 * the backlog is re-delivered. This is the only true recovery wiring — original run
 * state is never restored (first version does not persist runs).
 */
export class RecoveryDrain {
  constructor(
    private readonly teamId: string,
    private readonly teamRun: TeamRunManager,
    private readonly notifyWake: (slotId: string) => void
  ) {}

  drain(): void {
    if (this.teamRun.hasActiveRun()) return; // an active run already owns delivery
    const members = teamStore.listMembersByTeam(this.teamId);
    const backlog: Array<{ slot_id: string; role: TeamRole }> = [];
    for (const m of members) {
      if (teamStore.hasUnread(this.teamId, m.id)) backlog.push({ slot_id: m.id, role: m.role });
    }
    if (backlog.length === 0) return;
    // Prefer the leader as the run target; fall back to the first backlogged slot.
    const target = backlog.find((b) => b.role === 'lead') ?? backlog[0];
    backlog.sort((a, b) => (a.slot_id === target.slot_id ? -1 : b.slot_id === target.slot_id ? 1 : 0));
    this.teamRun.recoverMailboxBacklog(backlog);
    mainLog('RecoveryDrain', `recovered ${backlog.length} backlogged slot(s) in team ${this.teamId}`);
    for (const b of backlog) this.notifyWake(b.slot_id);
  }
}
