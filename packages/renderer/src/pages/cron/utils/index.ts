/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import dayjs from 'dayjs';
import { isManualCronSchedule, MANUAL_CRON_AT_MS } from '@sudowork/common/cronSchedule';
import type { TFunction } from 'i18next';
import type { ICronJob, ICronSchedule } from '@sudowork/host-bridge/ipcBridge';
import type { FrequencyPreset, IFrequencyScheduleOptions, IScheduleFrequency } from '@renderer/pages/cron/types';

export function formatNextRunRelative(t: TFunction, nextRunAtMs?: number): string {
  if (!nextRunAtMs) return '';
  const d = dayjs(nextRunAtMs);
  const now = dayjs();
  const time = d.format('HH:mm');
  if (d.isSame(now, 'day')) return t('cron.create.nextRunToday', { time, defaultValue: '今天 {{time}}' });
  if (d.isSame(now.add(1, 'day'), 'day')) return t('cron.create.nextRunTomorrow', { time, defaultValue: '明天 {{time}}' });
  return d.format('MM-DD HH:mm');
}

/**
 * cron bridge 遇到错误时会返回 `{ __error: string }` 包装对象，而不是直接 reject。
 * 这里统一把包装对象还原成异常，方便调用方用 try/catch 处理。
 */
export function unwrapCronResult<T>(result: T): T {
  const envelope = result as { __error?: unknown } | null | undefined;
  if (envelope && typeof envelope === 'object' && typeof envelope.__error === 'string') {
    throw new Error(envelope.__error);
  }
  return result;
}

/**
 * Format schedule for display - use human-readable description
 */
export function formatSchedule(job: ICronJob): string {
  return job.schedule.description;
}

/** Describe the frequency independently of the user-entered task description. */
export function formatScheduleFrequency(schedule: ICronSchedule, t?: TFunction): string {
  if (isManualCronSchedule(schedule)) return t ? t('cron.create.frequency.manual') : '手动';
  if (schedule.kind !== 'cron') return schedule.description;
  const parsed = scheduleToFrequency(schedule);
  const presetSchedule = frequencyToSchedule(parsed.preset, parsed, t);
  return presetSchedule?.kind === 'cron' && presetSchedule.expr === schedule.expr ? presetSchedule.description : schedule.expr;
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

export const FREQUENCY_PRESETS: FrequencyPreset[] = ['manual', 'hourly', 'daily', 'weekdays', 'weekly'];

export const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

/**
 * Convert frequency preset + options to a CronSchedule.
 * Pass a `t` function from `useTranslation()` to get i18n-aware descriptions.
 */
export function frequencyToSchedule(preset: FrequencyPreset, options?: IFrequencyScheduleOptions, t?: TFunction): ICronSchedule {
  const hour = options?.hour ?? 9;
  const minute = options?.minute ?? 0;
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  const label = (key: string, fallback: string) => (t ? t(key, fallback) : fallback);

  switch (preset) {
    case 'manual':
      return { kind: 'at', atMs: MANUAL_CRON_AT_MS, description: label('cron.create.frequency.manual', '手动') };
    case 'hourly':
      return { kind: 'cron', expr: '0 * * * *', description: label('cron.create.frequency.hourly', '每小时整点') };
    case 'daily':
      return { kind: 'cron', expr: `${minute} ${hour} * * *`, description: `${label('cron.create.frequency.daily', '每天')} ${timeStr}` };
    case 'weekdays':
      return { kind: 'cron', expr: `${minute} ${hour} * * MON-FRI`, description: `${label('cron.create.frequency.weekdays', '工作日')} ${timeStr}` };
    case 'weekly': {
      const day = options?.weekday ?? 'MON';
      const dayLabel = t ? t(`cron.create.weekday.${day}`, weekdayLabel(day)) : weekdayLabel(day);
      return { kind: 'cron', expr: `${minute} ${hour} * * ${day}`, description: `${label('cron.create.frequency.weekly', '每周')} ${dayLabel} ${timeStr}` };
    }
  }
}

/**
 * Try to parse an existing CronSchedule back into a frequency preset
 */
export function scheduleToFrequency(schedule: ICronSchedule): IScheduleFrequency {
  if (isManualCronSchedule(schedule)) return { preset: 'manual', hour: 9, minute: 0, weekday: 'MON' };
  if (schedule.kind !== 'cron') {
    return { preset: 'daily', hour: 9, minute: 0, weekday: 'MON' };
  }

  const parts = schedule.expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { preset: 'daily', hour: 9, minute: 0, weekday: 'MON' };
  }

  const [min, hr, , , dow] = parts;
  const parsedMinute = Number.parseInt(min, 10);
  const parsedHour = Number.parseInt(hr, 10);
  const minute = Number.isNaN(parsedMinute) ? 0 : parsedMinute;
  const hour = Number.isNaN(parsedHour) ? 9 : parsedHour;

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
