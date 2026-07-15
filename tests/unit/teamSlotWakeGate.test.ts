import { describe, it, expect } from 'vitest';
import { SlotWakeGate, acquirePolicy } from '@process/services/team/SlotWakeGate';

describe('SlotWakeGate.beforeWake (附录 I.2)', () => {
  it('records when no entry exists for the slot', () => {
    const g = new SlotWakeGate();
    expect(g.beforeWake('s1', 'mcp_send_message')).toBe('Record');
  });

  it('suppresses Background wakes while paused and increments suppressed_count', () => {
    const g = new SlotWakeGate();
    g.pause('s1');
    expect(g.beforeWake('s1', 'mcp_send_message')).toBe('Suppress');
    expect(g.beforeWake('s1', 'idle_notification')).toBe('Suppress');
    expect(g.suppressedCount('s1')).toBe(2);
    expect(g.hasRetainedWork('s1')).toBe(true);
  });

  it('Foreground wake resumes a paused slot and records (clears paused)', () => {
    const g = new SlotWakeGate();
    g.pause('s1');
    expect(g.beforeWake('s1', 'user_message')).toBe('Record');
    expect(g.isPaused('s1')).toBe(false);
  });

  it('Lifecycle wake records while paused WITHOUT clearing paused', () => {
    const g = new SlotWakeGate();
    g.pause('s1');
    expect(g.beforeWake('s1', 'spawn_welcome')).toBe('Record');
    expect(g.isPaused('s1')).toBe(true);
  });

  it('Background wake records when the slot is not paused', () => {
    const g = new SlotWakeGate();
    expect(g.beforeWake('s1', 'mcp_send_message')).toBe('Record');
    expect(g.suppressedCount('s1')).toBe(0);
  });
});

describe('SlotWakeGate pause/resume/clear/retained', () => {
  it('releaseSuppressedIfResumed only releases once unpaused with count > 0', () => {
    const g = new SlotWakeGate();
    expect(g.releaseSuppressedIfResumed('s1')).toBe(false); // no entry
    g.pause('s1');
    g.beforeWake('s1', 'mcp_send_message'); // suppressed → count 1
    expect(g.releaseSuppressedIfResumed('s1')).toBe(false); // still paused
    g.resume('s1');
    expect(g.releaseSuppressedIfResumed('s1')).toBe(true);
    expect(g.suppressedCount('s1')).toBe(0);
    expect(g.releaseSuppressedIfResumed('s1')).toBe(false); // already drained
  });

  it('clear(slot) removes one entry; clear() removes all', () => {
    const g = new SlotWakeGate();
    g.pause('s1');
    g.pause('s2');
    g.clear('s1');
    expect(g.isPaused('s1')).toBe(false);
    expect(g.isPaused('s2')).toBe(true);
    g.clear();
    expect(g.isPaused('s2')).toBe(false);
    expect(g.hasRetainedWork()).toBe(false);
  });

  it('hasRetainedWork() is true when any slot is paused or has suppressed wakes', () => {
    const g = new SlotWakeGate();
    expect(g.hasRetainedWork()).toBe(false);
    g.pause('s1');
    expect(g.hasRetainedWork()).toBe(true); // paused
    g.resume('s1');
    expect(g.hasRetainedWork()).toBe(false);
    g.pause('s2');
    g.beforeWake('s2', 'mcp_send_message'); // suppressed
    g.resume('s2'); // unpause but suppressed_count stays
    expect(g.hasRetainedWork()).toBe(true); // suppressed_count > 0
  });
});

describe('acquirePolicy (附录 I.2)', () => {
  it('user_message/user_intervention: RejectSlotBusy only when Busy', () => {
    expect(acquirePolicy('user_message', 'Idle', false)).toBe('Accept');
    expect(acquirePolicy('user_message', 'Busy', false)).toBe('RejectSlotBusy');
    expect(acquirePolicy('user_intervention', 'Pending', false)).toBe('Accept');
    expect(acquirePolicy('user_intervention', 'Busy', false)).toBe('RejectSlotBusy');
  });

  it('mcp_send_message: Suppress when Paused, Accept otherwise', () => {
    expect(acquirePolicy('mcp_send_message', 'Paused', false)).toBe('Suppress');
    expect(acquirePolicy('mcp_send_message', 'Idle', false)).toBe('Accept');
    expect(acquirePolicy('mcp_send_message', 'Busy', false)).toBe('Accept');
  });

  it('spawn_welcome: dedup / busy / pending / accept', () => {
    expect(acquirePolicy('spawn_welcome', 'Idle', true)).toBe('Suppress'); // already welcomed
    expect(acquirePolicy('spawn_welcome', 'Busy', false)).toBe('RejectInvalid');
    expect(acquirePolicy('spawn_welcome', 'Pending', false)).toBe('Suppress');
    expect(acquirePolicy('spawn_welcome', 'Idle', false)).toBe('Accept');
    expect(acquirePolicy('spawn_welcome', 'Paused', false)).toBe('Accept');
  });

  it('mcp_shutdown_request: always Accept', () => {
    expect(acquirePolicy('mcp_shutdown_request', 'Busy', false)).toBe('Accept');
    expect(acquirePolicy('mcp_shutdown_request', 'Paused', false)).toBe('Accept');
  });

  it('idle/interrupted_notification: Accept only when Idle', () => {
    expect(acquirePolicy('idle_notification', 'Idle', false)).toBe('Accept');
    expect(acquirePolicy('idle_notification', 'Busy', false)).toBe('Suppress');
    expect(acquirePolicy('interrupted_notification', 'Pending', false)).toBe('Suppress');
  });

  it('SystemRecovery: Suppress when Paused, Accept otherwise', () => {
    expect(acquirePolicy('crash_notification', 'Paused', false)).toBe('Suppress');
    expect(acquirePolicy('recovery_drain', 'Idle', false)).toBe('Accept');
    expect(acquirePolicy('inactivity_timeout', 'Busy', false)).toBe('Accept');
    expect(acquirePolicy('shutdown_rejected', 'Pending', false)).toBe('Accept');
  });
});
