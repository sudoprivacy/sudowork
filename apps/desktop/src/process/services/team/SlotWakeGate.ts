import { bypassesPause, resumesPausedSlot, type WakeSource } from './WakeSource';

export type SlotState = 'Idle' | 'Pending' | 'Busy' | 'Paused';
export type WakeDecision = 'Record' | 'Suppress';
export type AcquireDecision = 'Accept' | 'RejectSlotBusy' | 'RejectInvalid' | 'Suppress';

interface SlotEntry {
  paused: string | null;
  suppressed_count: number;
}

/**
 * SlotWakeGate — per-slot pause gate + suppressed-wake counter (附录 I.2).
 *
 * Foreground wakes resume a paused slot; Background/SystemRecovery wakes are
 * suppressed while paused and replayed as a single pending wake once the slot
 * resumes. `hasRetainedWork` feeds the TeamRun completion check (a paused slot
 * or a non-zero suppressed count means the run is not yet done).
 */
export class SlotWakeGate {
  private entries = new Map<string, SlotEntry>();

  private entry(slotId: string): SlotEntry {
    let e = this.entries.get(slotId);
    if (!e) {
      e = { paused: null, suppressed_count: 0 };
      this.entries.set(slotId, e);
    }
    return e;
  }

  isPaused(slotId: string): boolean {
    return this.entries.get(slotId)?.paused != null;
  }

  pause(slotId: string, reason = 'paused'): void {
    this.entry(slotId).paused = reason;
  }

  resume(slotId: string): void {
    const e = this.entries.get(slotId);
    if (e) e.paused = null;
  }

  clear(slotId?: string): void {
    if (slotId) this.entries.delete(slotId);
    else this.entries.clear();
  }

  suppressedCount(slotId: string): number {
    return this.entries.get(slotId)?.suppressed_count ?? 0;
  }

  hasRetainedWork(slotId?: string): boolean {
    if (slotId) {
      const e = this.entries.get(slotId);
      return Boolean(e && (e.paused != null || e.suppressed_count > 0));
    }
    for (const e of this.entries.values()) {
      if (e.paused != null || e.suppressed_count > 0) return true;
    }
    return false;
  }

  /** I.2 beforeWake: record the wake, or suppress+count it (Background/SystemRecovery while paused). */
  beforeWake(slotId: string, source: WakeSource): WakeDecision {
    const entry = this.entries.get(slotId);
    if (resumesPausedSlot(source) && entry?.paused) {
      entry.paused = null;
      return 'Record';
    }
    if (!entry) return 'Record';
    if (bypassesPause(source)) return 'Record';
    if (entry.paused) {
      entry.suppressed_count += 1;
      return 'Suppress';
    }
    return 'Record';
  }

  /** I.2: after a foreground resume, release accumulated suppressed wakes as one pending wake. */
  releaseSuppressedIfResumed(slotId: string): boolean {
    const entry = this.entries.get(slotId);
    if (!entry || entry.paused || entry.suppressed_count === 0) return false;
    entry.suppressed_count = 0;
    return true;
  }
}

/** I.2 acquirePolicy: gate whether a wake is accepted at the run level (per source × slot state). */
export function acquirePolicy(source: WakeSource, slotState: SlotState): AcquireDecision {
  switch (source) {
    case 'user_message':
    case 'user_intervention':
      return slotState === 'Busy' ? 'RejectSlotBusy' : 'Accept';
    case 'mcp_send_message':
      return slotState === 'Paused' ? 'Suppress' : 'Accept';
    case 'mcp_shutdown_request':
      return 'Accept';
    case 'idle_notification':
    case 'interrupted_notification':
      return slotState === 'Idle' ? 'Accept' : 'Suppress';
    default:
      return slotState === 'Paused' ? 'Suppress' : 'Accept';
  }
}
