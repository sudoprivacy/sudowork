import { describe, expect, it } from 'vitest';
import { formatScheduleFrequency } from '@renderer/pages/cron/utils';

describe('cron frequency with a custom task description', () => {
  it('shows the schedule instead of repeating the task purpose', () => {
    expect(formatScheduleFrequency({ kind: 'cron', expr: '0 9 * * *', description: 'Prepare the daily report' })).toBe('每天 09:00');
  });

  it('preserves custom expressions that do not match a frequency preset', () => {
    expect(formatScheduleFrequency({ kind: 'cron', expr: '15 0 1 * *', description: 'Monthly report' })).toBe('15 0 1 * *');
  });

  it('shows manual frequency independently of the task description', () => {
    expect(formatScheduleFrequency({ kind: 'at', atMs: 0, description: 'Prepare a report on demand' })).toBe('手动');
  });
});
