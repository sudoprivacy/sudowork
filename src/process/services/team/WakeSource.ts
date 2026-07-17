/**
 * WakeSource taxonomy for team member event loops (附录 I.2).
 *
 * Wake sources across 4 classes. Pause-gating derives entirely from this
 * table: Foreground/Lifecycle bypass pause; Foreground additionally resumes a
 * paused slot; Background/SystemRecovery are suppressed while paused.
 */

export type WakeSource =
  | 'user_message'
  | 'user_intervention'
  | 'mcp_send_message'
  | 'idle_notification'
  | 'interrupted_notification'
  | 'spawn_welcome'
  | 'team_membership_changed'
  | 'mcp_shutdown_request'
  | 'crash_notification'
  | 'inactivity_timeout'
  | 'spawn_attach_failure'
  | 'shutdown_rejected'
  | 'recovery_drain';

export type WakeClass = 'Foreground' | 'Background' | 'SystemRecovery' | 'Lifecycle';

export interface WakeMeta {
  readonly class: WakeClass;
  readonly resumes_paused: boolean;
  readonly bypasses_pause: boolean;
}

export const WAKE_META: Record<WakeSource, WakeMeta> = {
  user_message: { class: 'Foreground', resumes_paused: true, bypasses_pause: true },
  user_intervention: { class: 'Foreground', resumes_paused: true, bypasses_pause: true },
  mcp_send_message: { class: 'Background', resumes_paused: false, bypasses_pause: false },
  idle_notification: { class: 'Background', resumes_paused: false, bypasses_pause: false },
  interrupted_notification: { class: 'Background', resumes_paused: false, bypasses_pause: false },
  spawn_welcome: { class: 'Lifecycle', resumes_paused: false, bypasses_pause: true },
  team_membership_changed: { class: 'Background', resumes_paused: false, bypasses_pause: false },
  mcp_shutdown_request: { class: 'Lifecycle', resumes_paused: false, bypasses_pause: true },
  crash_notification: { class: 'SystemRecovery', resumes_paused: false, bypasses_pause: false },
  inactivity_timeout: { class: 'SystemRecovery', resumes_paused: false, bypasses_pause: false },
  spawn_attach_failure: { class: 'SystemRecovery', resumes_paused: false, bypasses_pause: false },
  shutdown_rejected: { class: 'SystemRecovery', resumes_paused: false, bypasses_pause: false },
  recovery_drain: { class: 'SystemRecovery', resumes_paused: false, bypasses_pause: false },
};

export function wakeClass(source: WakeSource): WakeClass {
  return WAKE_META[source].class;
}

export function resumesPausedSlot(source: WakeSource): boolean {
  return WAKE_META[source].resumes_paused;
}

export function bypassesPause(source: WakeSource): boolean {
  return WAKE_META[source].bypasses_pause;
}
