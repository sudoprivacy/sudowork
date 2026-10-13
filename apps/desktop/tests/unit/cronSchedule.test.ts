import { describe, expect, it } from 'vitest';
import { isManualCronSchedule } from '@sudowork/common/cronSchedule';
import { frequencyToSchedule, scheduleToFrequency } from '@renderer/pages/cron/utils';

describe('cron form schedule round trips', () => {
  it('persists manual independently of a paused daily schedule', () => {
    const manual = frequencyToSchedule('manual');
    expect(isManualCronSchedule(manual)).toBe(true);
    expect(scheduleToFrequency(manual).preset).toBe('manual');
    expect(isManualCronSchedule(frequencyToSchedule('daily'))).toBe(false);
  });

  for (const frequency of ['daily', 'weekdays', 'weekly'] as const) {
    it.each([
      [0, 0],
      [0, 5],
      [9, 0],
      [23, 55],
    ])(`preserves ${frequency} %i:%i after reopening and saving`, (hour, minute) => {
      const original = frequencyToSchedule(frequency, { hour, minute, weekday: 'FRI' });
      const reopened = scheduleToFrequency(original);
      expect(reopened).toMatchObject({ preset: frequency, hour, minute });
      expect(frequencyToSchedule(reopened.preset, reopened)).toEqual(original);
    });
  }
});
