import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamRunManager } from '@process/services/team/TeamRun';
import { SlotWakeGate } from '@process/services/team/SlotWakeGate';

const emits = vi.hoisted(() => ({
  accepted: vi.fn(),
  started: vi.fn(),
  updated: vi.fn(),
  completed: vi.fn(),
  cancelled: vi.fn(),
  failed: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      onRunAccepted: { emit: emits.accepted },
      onRunStarted: { emit: emits.started },
      onRunUpdated: { emit: emits.updated },
      onRunCompleted: { emit: emits.completed },
      onRunCancelled: { emit: emits.cancelled },
      onRunFailed: { emit: emits.failed },
      onChildTurnStarted: { emit: vi.fn() },
      onChildTurnCompleted: { emit: vi.fn() },
      onChildTurnCancelled: { emit: vi.fn() },
    },
  },
}));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));

function newManager(): TeamRunManager {
  return new TeamRunManager('team-1', new SlotWakeGate());
}

beforeEach(() => {
  emits.accepted.mockReset();
  emits.started.mockReset();
  emits.updated.mockReset();
  emits.completed.mockReset();
  emits.cancelled.mockReset();
  emits.failed.mockReset();
});

describe('TeamRun state transitions (附录 I.1)', () => {
  it('→accepted on acquireWake, →running on first child, →completed when all empty', () => {
    const m = newManager();
    const { lease } = m.acquireWake('s1', 'lead', 'user_message');
    expect(m.hasActiveRun()).toBe(true);
    expect(m.getRecord()!.status).toBe('accepted');
    expect(emits.accepted).toHaveBeenCalledTimes(1);

    m.commitLease(lease.lease_id, { slot_id: 's1', role: 'lead', source: 'user_message', message_id: 'm1' });
    const reservation = m.claimWakeForTurn('s1', 'user_message');
    expect(reservation).not.toBeNull();
    m.recordChildStarted(reservation!, 'turn-1', 'conv-1');
    expect(m.getRecord()!.status).toBe('running');
    expect(emits.started).toHaveBeenCalledTimes(1);

    m.recordChildCompleted('s1', { turn_id: 'turn-1', status: 'completed' });
    expect(m.getRecord()!.status).toBe('completed');
    expect(m.hasActiveRun()).toBe(false);
    expect(emits.completed).toHaveBeenCalledTimes(1);
  });

  it('child failed → run failed', () => {
    const m = newManager();
    const { lease } = m.acquireWake('s1', 'lead', 'user_message');
    m.commitLease(lease.lease_id, { slot_id: 's1', role: 'lead', source: 'user_message', message_id: null });
    const reservation = m.claimWakeForTurn('s1', 'user_message')!;
    m.recordChildStarted(reservation, 'turn-1', 'conv-1');
    m.recordChildCompleted('s1', { turn_id: 'turn-1', status: 'failed' });
    expect(m.getRecord()!.status).toBe('failed');
    expect(emits.failed).toHaveBeenCalledTimes(1);
  });

  it('stale turn_id completion is ignored (active child unchanged)', () => {
    const m = newManager();
    const { lease } = m.acquireWake('s1', 'lead', 'user_message');
    m.commitLease(lease.lease_id, { slot_id: 's1', role: 'lead', source: 'user_message', message_id: null });
    const reservation = m.claimWakeForTurn('s1', 'user_message')!;
    m.recordChildStarted(reservation, 'turn-real', 'conv-1');
    // A stale completion for a different turn_id must not remove the active child.
    m.recordChildCompleted('s1', { turn_id: 'turn-stale', status: 'completed' });
    expect(m.getRecord()!.status).toBe('running');
    expect(m.getRecord()!.active_child_turns.has('s1')).toBe(true);
    // The real completion then lands.
    m.recordChildCompleted('s1', { turn_id: 'turn-real', status: 'completed' });
    expect(m.getRecord()!.status).toBe('completed');
  });

  it('single run: a second acquireWake while active reuses the run', () => {
    const m = newManager();
    const first = m.acquireWake('s1', 'lead', 'user_message');
    const second = m.acquireWake('s2', 'teammate', 'mcp_send_message');
    expect(second.accepted_as_new_run).toBe(false);
    expect(second.run.team_run_id).toBe(first.run.team_run_id);
    expect(emits.accepted).toHaveBeenCalledTimes(1); // only the new run emits
  });
});

describe('TeamRun operation lease (附录 I.1)', () => {
  it('a held lease blocks maybeComplete; aborting it allows completion', () => {
    const m = newManager();
    const { lease } = m.acquireWake('s1', 'lead', 'user_message');
    expect(m.getRecord()!.status).toBe('accepted');
    m.maybeComplete();
    expect(m.getRecord()!.status).toBe('accepted'); // lease present → cannot complete
    m.abortLease(lease.lease_id);
    expect(m.getRecord()!.status).toBe('completed'); // lease gone + all empty → completed
  });

  it('commit converts a lease into a pending wake', () => {
    const m = newManager();
    const { lease } = m.acquireWake('s1', 'lead', 'user_message');
    expect(m.hasPendingWake('s1')).toBe(false);
    m.commitLease(lease.lease_id, { slot_id: 's1', role: 'lead', source: 'user_message', message_id: 'm1' });
    expect(m.hasPendingWake('s1')).toBe(true);
    expect(m.getRecord()!.active_operation_leases.size).toBe(0);
  });

  it('user_message wake flags has_user_intervention', () => {
    const m = newManager();
    const { lease } = m.acquireWake('s1', 'lead', 'user_message');
    m.commitLease(lease.lease_id, { slot_id: 's1', role: 'lead', source: 'user_message', message_id: null });
    expect(m.getRecord()!.has_user_intervention).toBe(true);
  });
});

describe('TeamRun three-level pipeline (附录 I.1)', () => {
  it('claimWakeForTurn shifts the pending wake FIFO into a reservation', () => {
    const m = newManager();
    const { lease } = m.acquireWake('s1', 'lead', 'user_message');
    m.commitLease(lease.lease_id, { slot_id: 's1', role: 'lead', source: 'user_message', message_id: 'm1' });
    expect(m.pendingWakeCount('s1')).toBe(1);
    const reservation = m.claimWakeForTurn('s1', 'user_message');
    expect(reservation).not.toBeNull();
    expect(m.pendingWakeCount('s1')).toBe(0); // shifted out
    expect(m.getRecord()!.starting_reservations.has(reservation!.reservation_id)).toBe(true);
  });

  it('claimWakeForTurn returns null when no active run or empty queue', () => {
    const m = newManager();
    expect(m.claimWakeForTurn('s1', 'user_message')).toBeNull(); // no run
    m.acquireWake('s1', 'lead', 'user_message'); // run but no committed wake
    expect(m.claimWakeForTurn('s1', 'user_message')).toBeNull();
  });

  it('retryChildStartLater returns the reservation to the pending queue head', () => {
    const m = newManager();
    const { lease } = m.acquireWake('s1', 'lead', 'user_message');
    m.commitLease(lease.lease_id, { slot_id: 's1', role: 'lead', source: 'user_message', message_id: 'm1' });
    const reservation = m.claimWakeForTurn('s1', 'user_message')!;
    expect(m.pendingWakeCount('s1')).toBe(0);
    m.retryChildStartLater(reservation);
    expect(m.pendingWakeCount('s1')).toBe(1);
    expect(m.getRecord()!.starting_reservations.size).toBe(0);
  });
});

describe('TeamRun pushPendingWake ordering', () => {
  it('foreground wakes jump ahead of non-foreground wakes', () => {
    const m = newManager();
    m.acquireWake('s1', 'lead', 'user_message'); // open a run
    m.pushPendingWake('s1', { slot_id: 's1', role: 'lead', source: 'mcp_send_message', message_id: 'bg' });
    m.pushPendingWake('s1', { slot_id: 's1', role: 'lead', source: 'user_message', message_id: 'fg' });
    const r = m.claimWakeForTurn('s1', 'user_message')!;
    expect(r.message_id).toBe('fg'); // foreground served first
  });
});

describe('TeamRun cancelChildTurn (附录 I.1 — cancelled child does not fail the run)', () => {
  it('recordChildCompleted(cancelled) → maybeComplete → completed (not failed)', () => {
    const m = newManager();
    const { lease } = m.acquireWake('s1', 'lead', 'user_message');
    m.commitLease(lease.lease_id, { slot_id: 's1', role: 'lead', source: 'user_message', message_id: null });
    const reservation = m.claimWakeForTurn('s1', 'user_message')!;
    m.recordChildStarted(reservation, 'turn-1', 'conv-1');
    m.recordChildCompleted('s1', { turn_id: 'turn-1', status: 'cancelled' });
    expect(m.getRecord()!.status).toBe('completed'); // cancelled ≠ failed; run completes when all empty
  });
});

describe('TeamRun cancel (附录 I.1 begin_cancel)', () => {
  it('active → cancelling; clears pending + gate; maybeComplete → cancelled when empty', () => {
    const m = newManager();
    const { lease } = m.acquireWake('s1', 'lead', 'user_message');
    m.commitLease(lease.lease_id, { slot_id: 's1', role: 'lead', source: 'mcp_send_message', message_id: null });
    expect(m.pendingWakeCount('s1')).toBe(1);
    m.beginCancel('user requested');
    expect(m.getRecord()!.status).toBe('cancelling');
    expect(m.pendingWakeCount('s1')).toBe(0); // pending cleared
    expect(emits.updated).toHaveBeenCalledTimes(1);
    m.maybeComplete();
    expect(m.getRecord()!.status).toBe('cancelled');
    expect(emits.cancelled).toHaveBeenCalledTimes(1);
  });
});

describe('TeamRun handleSlotCrash (附录 I.1 / 事实 9)', () => {
  it("clears a crashed slot's pending wake and failing its active child → run failed", () => {
    const m = newManager();
    const { lease } = m.acquireWake('t1', 'teammate', 'user_message');
    m.commitLease(lease.lease_id, { slot_id: 't1', role: 'teammate', source: 'user_message', message_id: null });
    const reservation = m.claimWakeForTurn('t1', 'user_message')!;
    m.recordChildStarted(reservation, 'turn-1', 'conv-1');
    expect(m.hasActiveRun()).toBe(true);
    // A retried pending wake would otherwise strand the run; handleSlotCrash must clear it.
    m.pushPendingWake('t1', { slot_id: 't1', role: 'teammate', source: 'mcp_send_message', message_id: null });
    m.handleSlotCrash('t1', false);
    expect(m.getRecord()!.status).toBe('failed'); // active child failed → run failed
    expect(m.pendingWakeCount('t1')).toBe(0); // pending cleared
    expect(emits.failed).toHaveBeenCalledTimes(1);
  });

  it('leader crash (idle, no own child, run active via teammate) → run failed (事实 9)', () => {
    const m = newManager();
    // Teammate has an in-flight turn; the leader itself is idle (no active child of its own).
    const { lease } = m.acquireWake('t1', 'teammate', 'user_message');
    m.commitLease(lease.lease_id, { slot_id: 't1', role: 'teammate', source: 'user_message', message_id: null });
    m.recordChildStarted(m.claimWakeForTurn('t1', 'user_message')!, 'turn-t', 'conv-t');
    expect(m.getRecord()!.status).toBe('running');
    m.handleSlotCrash('leader', true);
    expect(m.getRecord()!.status).toBe('failed'); // leader crash → run failed
    expect(emits.failed).toHaveBeenCalledTimes(1);
  });

  it('non-leader crash without its own active child does not fail the run (maybeComplete only)', () => {
    const m = newManager();
    // Leader has an in-flight turn; teammate t1 crashes but has no active child of its own.
    const { lease } = m.acquireWake('leader', 'lead', 'user_message');
    m.commitLease(lease.lease_id, { slot_id: 'leader', role: 'lead', source: 'user_message', message_id: null });
    m.recordChildStarted(m.claimWakeForTurn('leader', 'user_message')!, 'turn-l', 'conv-l');
    expect(m.getRecord()!.status).toBe('running');
    m.handleSlotCrash('t1', false);
    expect(m.getRecord()!.status).toBe('running'); // not failed — leader's turn still in flight
    expect(m.pendingWakeCount('t1')).toBe(0); // t1's pending cleared
  });
});

describe('TeamRun recoverMailboxBacklog', () => {
  it('creates a recovery_drain run with pending wakes for backlogged slots', () => {
    const m = newManager();
    const run = m.recoverMailboxBacklog([
      { slot_id: 'lead', role: 'lead' },
      { slot_id: 't1', role: 'teammate' },
    ]);
    expect(run).not.toBeNull();
    expect(run!.source).toBe('recovery_drain');
    expect(m.hasPendingWake('lead')).toBe(true);
    expect(m.hasPendingWake('t1')).toBe(true);
  });

  it('no-op when there is already an active run', () => {
    const m = newManager();
    const first = m.acquireWake('s1', 'lead', 'user_message').run;
    const run = m.recoverMailboxBacklog([{ slot_id: 's1', role: 'lead' }]);
    expect(run!.team_run_id).toBe(first.team_run_id); // reused
    expect(m.hasPendingWake('s1')).toBe(false); // recovery did not seed wakes
  });
});

describe('TeamRun slot runtime state + run event', () => {
  it('slotRunState reflects the pipeline stage', () => {
    const m = newManager();
    expect(m.slotRunState('s1')).toBe('Idle');
    m.acquireWake('s1', 'lead', 'user_message');
    m.pushPendingWake('s1', { slot_id: 's1', role: 'lead', source: 'mcp_send_message', message_id: null });
    expect(m.slotRunState('s1')).toBe('Pending');
    const reservation = m.claimWakeForTurn('s1', 'mcp_send_message')!;
    expect(m.slotRunState('s1')).toBe('Busy'); // starting reservation
    m.recordChildStarted(reservation, 'turn-1', 'conv-1');
    expect(m.slotRunState('s1')).toBe('Busy'); // active turn
  });

  it('toActiveRunEvent is null after a terminal run', () => {
    const m = newManager();
    expect(m.toActiveRunEvent()).toBeNull();
    m.acquireWake('s1', 'lead', 'user_message');
    expect(m.toActiveRunEvent()).not.toBeNull();
    expect(m.toActiveRunEvent()!.status).toBe('accepted');
  });
});
