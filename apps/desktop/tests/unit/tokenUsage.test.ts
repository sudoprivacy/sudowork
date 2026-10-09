import { COST_UNITS_PER_USAGE_POINT, TOKENS_PER_USAGE_POINT, costToUsagePoints, formatUsagePoints, resolveUsagePoints, tokensToUsagePoints, usagePointsFromTokensOrFallback } from '@/common/tokenUsage';

describe('token usage point helpers', () => {
  it('converts tokens to usage points with the shared ratio', () => {
    expect(TOKENS_PER_USAGE_POINT).toBe(500);
    expect(tokensToUsagePoints(1000)).toBe(2);
    expect(tokensToUsagePoints(125)).toBe(0.25);
  });

  it('returns null for missing or invalid token counts', () => {
    expect(tokensToUsagePoints(undefined)).toBeNull();
    expect(tokensToUsagePoints(null)).toBeNull();
    expect(tokensToUsagePoints(Number.NaN)).toBeNull();
  });

  it('prefers token-derived points before fallback points', () => {
    expect(usagePointsFromTokensOrFallback(2500, 0)).toBe(5);
    expect(usagePointsFromTokensOrFallback(undefined, 3)).toBe(3);
    expect(usagePointsFromTokensOrFallback(undefined, undefined)).toBe(0);
  });

  it('converts cost units to exact usage points', () => {
    expect(COST_UNITS_PER_USAGE_POINT).toBe(500);
    expect(costToUsagePoints(43700)).toBe(87.4);
    expect(costToUsagePoints(702237)).toBe(1404.474);
    expect(costToUsagePoints(2785)).toBe(5.57);
    expect(costToUsagePoints(undefined)).toBeNull();
  });

  it('resolves exact server cost points before token estimates', () => {
    expect(resolveUsagePoints({ totalTokens: 1000, costUnits: 43700, costCurrency: 'sudo_point' })).toBe(87.4);
  });

  it('falls back to token estimates when server cost is missing', () => {
    expect(resolveUsagePoints({ totalTokens: 1000 })).toBe(2);
  });

  it('falls back to token estimates for unsupported cost currencies', () => {
    expect(resolveUsagePoints({ totalTokens: 1000, costUnits: 43700, costCurrency: 'usd' })).toBe(2);
  });

  it('treats zero sudo_point cost as exact usage points', () => {
    expect(resolveUsagePoints({ totalTokens: 1000, costUnits: 0, costCurrency: 'sudo_point' })).toBe(0);
  });

  it('formats usage points with one decimal place by default', () => {
    expect(formatUsagePoints(2.25)).toBe('2.3');
    expect(formatUsagePoints(2.25, 2)).toBe('2.25');
    expect(formatUsagePoints(undefined)).toBeNull();
  });
});
