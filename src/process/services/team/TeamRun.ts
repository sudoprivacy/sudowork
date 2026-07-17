import { ipcBridge } from '@/common';
import type { ITeamRunEvent, ITeamSlotWork } from '@/common/ipcBridge';
import { uuid } from '@/common/utils';
import { mainLog } from '@process/utils/mainLogger';
import type { SlotWakeGate } from './SlotWakeGate';
import type { WakeSource } from './WakeSource';

/** TeamRun status (附录 I.1). */
export type TeamRunStatus = 'accepted' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed';
export type TeamRunSource = 'user_message' | 'recovery_drain';
export type TeamRunTurnStatus = 'completed' | 'failed' | 'cancelled';
export type TeamRole = 'lead' | 'teammate';
export type TeamSlotState = 'Busy' | 'Pending' | 'Paused' | 'Idle';

/** A child turn currently executing on a slot (三级流水线 stage 3). */
export interface ActiveChildTurn {
  team_run_id: string;
  slot_id: string;
  role: TeamRole;
  conversation_id: string;
  turn_id: string;
  started_at_ms: number;
  last_slow_notified_at_ms: number | null; // slow-task monitoring (stage 5)
}

/** A claimed wake mid-startup (三级流水线 stage 2). */
export interface StartingChildReservation {
  reservation_id: string;
  team_run_id: string;
  slot_id: string;
  role: TeamRole;
  wake_source: WakeSource;
  message_id: string | null;
  state: 'Starting' | 'Cancelling';
}

/** A queued wake awaiting its turn (三级流水线 stage 1). */
export interface PendingWake {
  slot_id: string;
  role: TeamRole;
  source: WakeSource;
  message_id: string | null;
}

/** Operation lease held while writing to the mailbox, preventing a run from completing mid-write (附录 I.1). */
export interface TeamRunOperationLease {
  lease_id: string;
  team_run_id: string;
  slot_id: string;
  role: TeamRole;
  wake_source: WakeSource;
  accepted_as_new_run: boolean;
}

/** In-memory TeamRun record. Never persisted (附录 I.1, recovery boundary). */
export interface TeamRunRecord {
  team_run_id: string;
  team_id: string;
  source: TeamRunSource;
  has_user_intervention: boolean; // true once any user wake joins; never clears
  target_slot_id: string;
  target_role: TeamRole;
  status: TeamRunStatus;
  started_at: number | null;
  completed_at: number | null;
  cancelled_at: number | null;
  cancel_reason: string | null;
  active_child_turns: Map<string, ActiveChildTurn>; // key = slot_id
  starting_reservations: Map<string, StartingChildReservation>; // key = reservation_id
  pending_wakes: Map<string, PendingWake[]>; // key = slot_id, FIFO
  slot_runtime_health: Map<string, 'Disconnected' | 'Unhealthy' | null>;
  slot_wake_gate: SlotWakeGate;
  active_operation_leases: Map<string, TeamRunOperationLease>; // key = lease_id
}

export interface AcquireWakeResult {
  run: TeamRunRecord;
  lease: TeamRunOperationLease;
  accepted_as_new_run: boolean;
}

type RunEventChannel = 'team.runAccepted' | 'team.runStarted' | 'team.runUpdated' | 'team.runCompleted' | 'team.runCancelled' | 'team.runFailed';

/**
 * TeamRunManager — per-team single-run state machine (附录 I.1).
 *
 * Holds one TeamRunRecord (or null after a terminal run). All mutating methods are
 * synchronous (no await) so each runs atomically on the JS main thread — the "locked"
 * pseudocode in I.1 maps to plain synchronous methods here. A run is active while its
 * status ∈ {accepted, running}; a terminal record is kept for getRunState queries and
 * replaced on the next acquireWake.
 */
export class TeamRunManager {
  private record: TeamRunRecord | null = null;

  constructor(
    private readonly teamId: string,
    private readonly wakeGate: SlotWakeGate
  ) {}

  getRecord(): TeamRunRecord | null {
    return this.record;
  }

  hasActiveRun(): boolean {
    return this.isActive(this.record);
  }

  isActive(run: TeamRunRecord | null): boolean {
    return run != null && (run.status === 'accepted' || run.status === 'running');
  }

  /** →accepted: acquire (or reuse) a run for a user message; returns the write-mailbox lease. */
  acquireUserMessageWake(targetSlot: string, targetRole: TeamRole): AcquireWakeResult {
    return this.acquireWake(targetSlot, targetRole, 'user_message');
  }

  /**
   * →accepted: acquire (or reuse) the active run and a write-mailbox lease for any wake source.
   * Used by both user messages (user_message) and member→member delivery (mcp_send_message).
   * The lease keeps the run from completing between writing the mailbox and enqueuing the wake.
   */
  acquireWake(targetSlot: string, targetRole: TeamRole, wakeSource: WakeSource): AcquireWakeResult {
    const source: TeamRunSource = wakeSource === 'user_message' || wakeSource === 'user_intervention' ? 'user_message' : 'recovery_drain';
    return this.acquireWakeInternal(targetSlot, targetRole, source, wakeSource);
  }

  /** →accepted (source=recovery_drain): create a run and seed pending wakes for backlogged slots. */
  recoverMailboxBacklog(backlog: Array<{ slot_id: string; role: TeamRole }>): TeamRunRecord | null {
    if (backlog.length === 0) return null;
    if (this.isActive(this.record)) return this.record; // an active run already owns delivery
    const target = backlog[0];
    const run = this.createRun('recovery_drain', target.slot_id, target.role);
    this.record = run;
    for (const b of backlog) {
      this.pushPendingWakeInternal(run, b.slot_id, { slot_id: b.slot_id, role: b.role, source: 'recovery_drain', message_id: null });
    }
    this.emitRun('team.runAccepted');
    mainLog('TeamRun', `recovery drain ${run.team_run_id} for team ${this.teamId} (${backlog.length} slot(s))`);
    return run;
  }

  private acquireWakeInternal(targetSlot: string, targetRole: TeamRole, source: TeamRunSource, wakeSource: WakeSource): AcquireWakeResult {
    if (this.isActive(this.record)) {
      const lease = this.acquireLease(this.record!, targetSlot, targetRole, wakeSource);
      return { run: this.record!, lease, accepted_as_new_run: false };
    }
    const run = this.createRun(source, targetSlot, targetRole);
    this.record = run;
    const lease = this.acquireLease(run, targetSlot, targetRole, wakeSource);
    this.emitRun('team.runAccepted');
    mainLog('TeamRun', `accepted ${run.team_run_id} (source=${source}) for team ${this.teamId}`);
    return { run, lease, accepted_as_new_run: true };
  }

  private createRun(source: TeamRunSource, targetSlot: string, targetRole: TeamRole): TeamRunRecord {
    return {
      team_run_id: uuid(),
      team_id: this.teamId,
      source,
      has_user_intervention: false,
      target_slot_id: targetSlot,
      target_role: targetRole,
      status: 'accepted',
      started_at: null,
      completed_at: null,
      cancelled_at: null,
      cancel_reason: null,
      active_child_turns: new Map(),
      starting_reservations: new Map(),
      pending_wakes: new Map(),
      slot_runtime_health: new Map(),
      slot_wake_gate: this.wakeGate,
      active_operation_leases: new Map(),
    };
  }

  private acquireLease(run: TeamRunRecord, slot: string, role: TeamRole, wakeSource: WakeSource): TeamRunOperationLease {
    const lease: TeamRunOperationLease = {
      lease_id: uuid(),
      team_run_id: run.team_run_id,
      slot_id: slot,
      role,
      wake_source: wakeSource,
      accepted_as_new_run: run.status === 'accepted' && run.started_at == null,
    };
    run.active_operation_leases.set(lease.lease_id, lease);
    return lease;
  }

  /** commit: convert the lease into a pending wake (foreground wakes also flag user intervention). */
  commitLease(leaseId: string, wake: PendingWake): void {
    const run = this.record;
    if (!run) return;
    const lease = run.active_operation_leases.get(leaseId);
    if (!lease) return;
    run.active_operation_leases.delete(leaseId);
    if (wake.source === 'user_message' || wake.source === 'user_intervention') {
      run.has_user_intervention = true;
    }
    this.pushPendingWakeInternal(run, lease.slot_id, wake);
  }

  /** abort: release the lease without enqueueing a wake (mailbox write failed). */
  abortLease(leaseId: string): void {
    const run = this.record;
    if (!run) return;
    run.active_operation_leases.delete(leaseId);
    this.maybeComplete();
  }

  /** renew: stage 5 extends a long-running write lease; no-op until leases carry timeouts. */
  renewActiveLease(_leaseId: string): void {
    // Intentionally empty for stage 3 — lease timeouts land with the watchdog in stage 5.
  }

  // ---- three-level pipeline (附录 I.1) ----

  /** stage 1 → 2: pending_wakes → starting_reservations. Returns null if no active run or empty queue. */
  claimWakeForTurn(slot: string, source: WakeSource): StartingChildReservation | null {
    const run = this.record;
    if (!run || !this.isActive(run)) return null;
    const queue = run.pending_wakes.get(slot);
    if (!queue || queue.length === 0) return null;
    const wake = queue.shift()!;
    if (queue.length === 0) run.pending_wakes.delete(slot);
    const reservation: StartingChildReservation = {
      reservation_id: uuid(),
      team_run_id: run.team_run_id,
      slot_id: slot,
      role: wake.role,
      wake_source: source,
      message_id: wake.message_id,
      state: 'Starting',
    };
    run.starting_reservations.set(reservation.reservation_id, reservation);
    return reservation;
  }

  /** stage 2 → 3: starting_reservations → active_child_turns + accepted→running on first child. */
  recordChildStarted(reservation: StartingChildReservation, turnId: string, conversationId: string): void {
    const run = this.record;
    if (!run) return;
    run.starting_reservations.delete(reservation.reservation_id);
    const child: ActiveChildTurn = {
      team_run_id: run.team_run_id,
      slot_id: reservation.slot_id,
      role: reservation.role,
      conversation_id: conversationId,
      turn_id: turnId,
      started_at_ms: Date.now(),
      last_slow_notified_at_ms: null,
    };
    run.active_child_turns.set(reservation.slot_id, child);
    ipcBridge.team.onChildTurnStarted.emit({
      team_id: run.team_id,
      team_run_id: run.team_run_id,
      slot_id: child.slot_id,
      role: child.role,
      conversation_id: child.conversation_id,
      turn_id: turnId,
      status: 'started',
    });
    if (run.status === 'accepted' && run.started_at == null) {
      run.status = 'running';
      run.started_at = Date.now();
      this.emitRun('team.runStarted');
    }
  }

  /** stage 3 → ∅: active_child_turns removal. Stale turn_id ignored; failed child fails the run. */
  recordChildCompleted(slot: string, turn: { turn_id: string; status: TeamRunTurnStatus }): void {
    const run = this.record;
    if (!run) return;
    const child = run.active_child_turns.get(slot);
    if (!child) return;
    if (child.turn_id !== turn.turn_id) return; // stale protection
    run.active_child_turns.delete(slot);
    const childEventBase = { team_id: run.team_id, team_run_id: run.team_run_id, slot_id: slot, role: child.role, conversation_id: child.conversation_id, turn_id: turn.turn_id };
    if (turn.status === 'cancelled') {
      ipcBridge.team.onChildTurnCancelled.emit({ ...childEventBase, status: 'cancelled' });
    } else if (turn.status !== 'failed') {
      ipcBridge.team.onChildTurnCompleted.emit({ ...childEventBase, status: 'completed' });
    }
    if (turn.status === 'failed') {
      run.status = 'failed';
      run.completed_at = Date.now();
      this.emitRun('team.runFailed');
      return;
    }
    this.maybeComplete();
    if (this.isActive(run)) this.emitRun('team.runUpdated');
  }

  /** reservation → pending_wakes head (retry on retryable start failure). */
  retryChildStartLater(reservation: StartingChildReservation): void {
    const run = this.record;
    if (!run) return;
    run.starting_reservations.delete(reservation.reservation_id);
    const queue = run.pending_wakes.get(reservation.slot_id) ?? [];
    queue.unshift({ slot_id: reservation.slot_id, role: reservation.role, source: reservation.wake_source, message_id: reservation.message_id });
    run.pending_wakes.set(reservation.slot_id, queue);
  }

  /**
   * Handle a slot crash (附录 I.1 / 事实 9): clear the crashed slot's pending wakes + starting
   * reservations, fail its active child (→ run failed), and on a leader crash fail the run
   * outright. Without this, a crashed slot's retried pending wake strands the run active forever.
   */
  handleSlotCrash(slot: string, isLeader: boolean): void {
    const run = this.record;
    if (!run) return;
    run.pending_wakes.delete(slot);
    for (const [id, res] of run.starting_reservations) {
      if (res.slot_id === slot) run.starting_reservations.delete(id);
    }
    const child = run.active_child_turns.get(slot);
    if (child) {
      run.active_child_turns.delete(slot);
      this.failRun();
      return;
    }
    if (isLeader) this.failRun();
    else this.maybeComplete();
  }

  /** Clear all in-memory run state owned by a removed slot. */
  clearSlot(slot: string): void {
    const run = this.record;
    if (!run) return;
    run.pending_wakes.delete(slot);
    for (const [id, res] of run.starting_reservations) {
      if (res.slot_id === slot) run.starting_reservations.delete(id);
    }
    run.active_child_turns.delete(slot);
    for (const [id, lease] of run.active_operation_leases) {
      if (lease.slot_id === slot) run.active_operation_leases.delete(id);
    }
    run.slot_wake_gate.clear(slot);
    this.maybeComplete();
  }

  private failRun(): void {
    const run = this.record;
    if (!run || !this.isActive(run)) return;
    run.status = 'failed';
    run.completed_at = Date.now();
    this.emitRun('team.runFailed');
  }

  // ---- completion (附录 I.1 maybe_complete_locked) ----

  maybeComplete(): void {
    const run = this.record;
    if (!run) return;
    if (run.status !== 'running' && run.status !== 'accepted' && run.status !== 'cancelling') return;
    const allEmpty = this.totalPendingWakeCount(run) === 0 && run.starting_reservations.size === 0 && run.active_child_turns.size === 0 && run.active_operation_leases.size === 0 && !run.slot_wake_gate.hasRetainedWork();
    if (!allEmpty) return;
    if (run.status === 'cancelling') {
      run.status = 'cancelled';
      run.cancelled_at = Date.now();
      this.emitRun('team.runCancelled');
    } else {
      run.status = 'completed';
      run.completed_at = Date.now();
      this.emitRun('team.runCompleted');
    }
  }

  // ---- cancel (附录 I.1 begin_cancel) ----

  /** active → cancelling: clear pending wakes + wake gate, mark reservations Cancelling. Keeps leases/active turns. */
  beginCancel(reason?: string): void {
    const run = this.record;
    if (!run || !this.isActive(run)) return;
    run.status = 'cancelling';
    run.cancel_reason = reason ?? null;
    run.pending_wakes.clear();
    run.slot_wake_gate.clear();
    for (const res of run.starting_reservations.values()) res.state = 'Cancelling';
    this.emitRun('team.runUpdated');
  }

  // ---- pending wake queries ----

  pushPendingWake(slot: string, wake: PendingWake): void {
    if (!this.record) return;
    this.pushPendingWakeInternal(this.record, slot, wake);
  }

  /** foreground wakes jump the queue (ahead of the first non-foreground); others push back. */
  private pushPendingWakeInternal(run: TeamRunRecord, slot: string, wake: PendingWake): void {
    const queue = run.pending_wakes.get(slot) ?? [];
    if (wake.source === 'user_message' || wake.source === 'user_intervention') {
      const idx = queue.findIndex((w) => w.source !== 'user_message' && w.source !== 'user_intervention');
      if (idx === -1) queue.push(wake);
      else queue.splice(idx, 0, wake);
    } else {
      queue.push(wake);
    }
    run.pending_wakes.set(slot, queue);
  }

  hasPendingWake(slot: string): boolean {
    const queue = this.record?.pending_wakes.get(slot);
    return queue != null && queue.length > 0;
  }

  pendingWakeCount(slot: string): number {
    return this.record?.pending_wakes.get(slot)?.length ?? 0;
  }

  private totalPendingWakeCount(run: TeamRunRecord): number {
    let total = 0;
    for (const queue of run.pending_wakes.values()) total += queue.length;
    return total;
  }

  /** slot runtime state (附录 I.1 slotRunState). */
  slotRunState(slot: string): TeamSlotState {
    const run = this.record;
    if (!run) return 'Idle';
    if (run.active_child_turns.has(slot)) return 'Busy';
    let startingForSlot = 0;
    for (const res of run.starting_reservations.values()) if (res.slot_id === slot) startingForSlot += 1;
    if (startingForSlot > 0) return 'Busy';
    if (this.pendingWakeCount(slot) > 0) return 'Pending';
    if (run.slot_wake_gate.isPaused(slot)) return 'Paused';
    return 'Idle';
  }

  // ---- emit ----

  /** Active-run snapshot for the renderer (null when terminal — getRunState). */
  toActiveRunEvent(): ITeamRunEvent | null {
    if (!this.isActive(this.record)) return null;
    return this.toRunEvent(this.record!);
  }

  private toRunEvent(run: TeamRunRecord): ITeamRunEvent {
    return {
      team_id: run.team_id,
      team_run_id: run.team_run_id,
      target_slot_id: run.target_slot_id,
      target_role: run.target_role,
      status: run.status,
      active_child_count: run.active_child_turns.size,
      pending_wake_count: this.totalPendingWakeCount(run),
      starting_child_count: run.starting_reservations.size,
      slot_work: this.buildSlotWork(run),
    };
  }

  /** Aggregate per-slot work for the run event (附录 II.11 ITeamSlotWork). */
  private buildSlotWork(run: TeamRunRecord): ITeamSlotWork[] {
    const roles = new Map<string, TeamRole>();
    for (const q of run.pending_wakes.values()) if (q.length > 0) roles.set(q[0].slot_id, q[0].role);
    for (const r of run.starting_reservations.values()) roles.set(r.slot_id, r.role);
    for (const c of run.active_child_turns.values()) roles.set(c.slot_id, c.role);
    const result: ITeamSlotWork[] = [];
    for (const [slotId, role] of roles) {
      let startingForSlot = 0;
      for (const res of run.starting_reservations.values()) if (res.slot_id === slotId) startingForSlot += 1;
      const active = run.active_child_turns.get(slotId);
      result.push({
        slot_id: slotId,
        role,
        pending_wake_count: run.pending_wakes.get(slotId)?.length ?? 0,
        starting_child_count: startingForSlot,
        paused: run.slot_wake_gate.isPaused(slotId) || undefined,
        suppressed_wake_count: run.slot_wake_gate.suppressedCount(slotId) || undefined,
        active_turn_id: active?.turn_id,
      });
    }
    return result;
  }

  private emitRun(channel: RunEventChannel): void {
    if (!this.record) return;
    const event = this.toRunEvent(this.record);
    switch (channel) {
      case 'team.runAccepted':
        ipcBridge.team.onRunAccepted.emit(event);
        break;
      case 'team.runStarted':
        ipcBridge.team.onRunStarted.emit(event);
        break;
      case 'team.runUpdated':
        ipcBridge.team.onRunUpdated.emit(event);
        break;
      case 'team.runCompleted':
        ipcBridge.team.onRunCompleted.emit(event);
        break;
      case 'team.runCancelled':
        ipcBridge.team.onRunCancelled.emit(event);
        break;
      case 'team.runFailed':
        ipcBridge.team.onRunFailed.emit(event);
        break;
    }
  }
}
