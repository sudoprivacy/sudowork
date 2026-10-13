/**
 * Manual jobs use an expired one-shot schedule plus enabled=false. Both local
 * storage and the Moss API support this representation without a new enum.
 * The epoch is reserved for manual jobs and must never be automatically armed.
 */
export const MANUAL_CRON_AT_MS = 0;

/** Identify a manual schedule independently of its enabled state or label. */
export function isManualCronSchedule(schedule: { kind: string; atMs?: number }): boolean {
  return schedule.kind === 'at' && schedule.atMs === MANUAL_CRON_AT_MS;
}
