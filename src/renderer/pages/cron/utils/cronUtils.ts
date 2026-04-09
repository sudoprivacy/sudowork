/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TFunction } from 'i18next';
import type { ICronJob, ICronSchedule } from '@/common/ipcBridge';

/**
 * Format schedule for display - use human-readable description
 */
export function formatSchedule(job: ICronJob): string {
  return job.schedule.description;
}

/**
 * Format next run time for display
 */
export function formatNextRun(nextRunAtMs?: number): string {
  if (!nextRunAtMs) return '-';
  const date = new Date(nextRunAtMs);
  return date.toLocaleString();
}

/**
 * Get job status flags
 */
export function getJobStatusFlags(job: ICronJob): { hasError: boolean; isPaused: boolean } {
  return {
    hasError: job.state.lastStatus === 'error',
    isPaused: !job.enabled,
  };
}

/**
 * Frequency presets for human-friendly schedule selection
 */
export type FrequencyPreset = 'manual' | 'hourly' | 'daily' | 'weekdays' | 'weekly';

export const FREQUENCY_PRESETS: FrequencyPreset[] = ['manual', 'hourly', 'daily', 'weekdays', 'weekly'];

export const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

/**
 * Convert frequency preset + options to a CronSchedule.
 * Pass a `t` function from `useTranslation()` to get i18n-aware descriptions.
 */
export function frequencyToSchedule(preset: FrequencyPreset, options?: { hour?: number; minute?: number; weekday?: string }, t?: TFunction): ICronSchedule | null {
  const hour = options?.hour ?? 9;
  const minute = options?.minute ?? 0;
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  const label = (key: string, fallback: string) => (t ? t(key, { defaultValue: fallback }) : fallback);

  switch (preset) {
    case 'manual':
      return null;
    case 'hourly':
      return { kind: 'cron', expr: '0 * * * *', description: label('cron.create.frequency.hourly', '每小时整点') };
    case 'daily':
      return { kind: 'cron', expr: `${minute} ${hour} * * *`, description: `${label('cron.create.frequency.daily', '每天')} ${timeStr}` };
    case 'weekdays':
      return { kind: 'cron', expr: `${minute} ${hour} * * MON-FRI`, description: `${label('cron.create.frequency.weekdays', '工作日')} ${timeStr}` };
    case 'weekly': {
      const day = options?.weekday ?? 'MON';
      const dayLabel = t ? t(`cron.create.weekday.${day}`, { defaultValue: weekdayLabel(day) }) : weekdayLabel(day);
      return { kind: 'cron', expr: `${minute} ${hour} * * ${day}`, description: `${label('cron.create.frequency.weekly', '每周')} ${dayLabel} ${timeStr}` };
    }
  }
}

/**
 * Try to parse an existing CronSchedule back into a frequency preset
 */
export function scheduleToFrequency(schedule: ICronSchedule): {
  preset: FrequencyPreset;
  hour: number;
  minute: number;
  weekday: string;
} {
  if (schedule.kind !== 'cron') {
    return { preset: 'daily', hour: 9, minute: 0, weekday: 'MON' };
  }

  const parts = schedule.expr.split(' ');
  if (parts.length !== 5) {
    return { preset: 'daily', hour: 9, minute: 0, weekday: 'MON' };
  }

  const [min, hr, , , dow] = parts;
  const minute = parseInt(min) || 0;
  const hour = parseInt(hr) || 9;

  if (min === '0' && hr === '*') {
    return { preset: 'hourly', hour: 0, minute: 0, weekday: 'MON' };
  }
  if (dow === '*') {
    return { preset: 'daily', hour, minute, weekday: 'MON' };
  }
  if (dow === 'MON-FRI') {
    return { preset: 'weekdays', hour, minute, weekday: 'MON' };
  }
  // Single weekday
  if (WEEKDAYS.includes(dow as any)) {
    return { preset: 'weekly', hour, minute, weekday: dow };
  }

  return { preset: 'daily', hour, minute, weekday: 'MON' };
}

function weekdayLabel(day: string): string {
  const map: Record<string, string> = {
    SUN: '日',
    MON: '一',
    TUE: '二',
    WED: '三',
    THU: '四',
    FRI: '五',
    SAT: '六',
  };
  return map[day] || day;
}
