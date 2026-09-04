import { describe, expect, it } from 'vitest';
import { isSlashCommandListEnabled } from '@/common/slash/availability';

describe('isSlashCommandListEnabled', () => {
  it('returns true for all conversation types', () => {
    expect(isSlashCommandListEnabled()).toBe(true);
  });
});
