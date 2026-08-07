import { describe, it, expect } from 'vitest';
import { WAKE_META, wakeClass, resumesPausedSlot, bypassesPause, type WakeSource } from '@process/services/team/WakeSource';

const ALL_SOURCES: WakeSource[] = [
  'user_message',
  'user_intervention',
  'mcp_send_message',
  'idle_notification',
  'interrupted_notification',
  'team_membership_changed',
  'mcp_shutdown_request',
  'crash_notification',
  'inactivity_timeout',
  'spawn_attach_failure',
  'shutdown_rejected',
  'recovery_drain',
];

describe('WakeSource taxonomy (附录 I.2)', () => {
  it('defines exactly the 12 wake sources', () => {
    expect(ALL_SOURCES).toHaveLength(12);
    for (const s of ALL_SOURCES) {
      expect(WAKE_META[s]).toBeDefined();
    }
    expect(new Set(ALL_SOURCES).size).toBe(12);
  });

  it('Foreground (user_message/user_intervention) resumes + bypasses pause', () => {
    for (const s of ['user_message', 'user_intervention'] as WakeSource[]) {
      expect(wakeClass(s)).toBe('Foreground');
      expect(resumesPausedSlot(s)).toBe(true);
      expect(bypassesPause(s)).toBe(true);
    }
  });

  it('Background neither resumes nor bypasses pause', () => {
    for (const s of ['mcp_send_message', 'idle_notification', 'interrupted_notification', 'team_membership_changed'] as WakeSource[]) {
      expect(wakeClass(s)).toBe('Background');
      expect(resumesPausedSlot(s)).toBe(false);
      expect(bypassesPause(s)).toBe(false);
    }
  });

  it('Lifecycle bypasses pause but does not resume', () => {
    for (const s of ['mcp_shutdown_request'] as WakeSource[]) {
      expect(wakeClass(s)).toBe('Lifecycle');
      expect(resumesPausedSlot(s)).toBe(false);
      expect(bypassesPause(s)).toBe(true);
    }
  });

  it('SystemRecovery neither resumes nor bypasses pause', () => {
    for (const s of ['crash_notification', 'inactivity_timeout', 'spawn_attach_failure', 'shutdown_rejected', 'recovery_drain'] as WakeSource[]) {
      expect(wakeClass(s)).toBe('SystemRecovery');
      expect(resumesPausedSlot(s)).toBe(false);
      expect(bypassesPause(s)).toBe(false);
    }
  });

  it('derives bypasses_pause from class (Foreground ∪ Lifecycle)', () => {
    // Invariant: bypasses_pause === class ∈ {Foreground, Lifecycle}
    for (const s of ALL_SOURCES) {
      const cls = wakeClass(s);
      expect(bypassesPause(s)).toBe(cls === 'Foreground' || cls === 'Lifecycle');
    }
  });

  it('derives resumes_paused_slot only for Foreground user wakes', () => {
    for (const s of ALL_SOURCES) {
      expect(resumesPausedSlot(s)).toBe(s === 'user_message' || s === 'user_intervention');
    }
  });
});
