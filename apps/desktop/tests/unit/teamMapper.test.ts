import { describe, expect, it } from 'vitest';
import { normalizeTeamStatus } from '@renderer/pages/team/mapper';

describe('team mapper', () => {
  it('preserves active backend status', () => {
    expect(normalizeTeamStatus('active')).toBe('active');
  });
});
