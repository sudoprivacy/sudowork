import { describe, expect, it } from 'vitest';
import { normalizeRechargeMode } from '@/common/systemConfig';

describe('credit application system config', () => {
  it('keeps the legacy payment mode when recharge mode is missing or invalid', () => {
    expect(normalizeRechargeMode(undefined)).toBe('pay');
    expect(normalizeRechargeMode(null)).toBe('pay');
    expect(normalizeRechargeMode('')).toBe('pay');
    expect(normalizeRechargeMode('unknown')).toBe('pay');
  });

  it('accepts supported recharge modes', () => {
    expect(normalizeRechargeMode('pay')).toBe('pay');
    expect(normalizeRechargeMode('approve')).toBe('approve');
    expect(normalizeRechargeMode('disabled')).toBe('disabled');
  });
});
