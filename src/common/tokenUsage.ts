/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

export const TOKENS_PER_USAGE_POINT = 500;
export const COST_UNITS_PER_USAGE_POINT = 500;

export const tokensToUsagePoints = (tokens?: number | null): number | null => {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens)) return null;
  return tokens / TOKENS_PER_USAGE_POINT;
};

export const costToUsagePoints = (cost?: number | null): number | null => {
  if (typeof cost !== 'number' || !Number.isFinite(cost)) return null;
  return Math.round(cost / COST_UNITS_PER_USAGE_POINT);
};

export const usagePointsFromTokensOrFallback = (tokens?: number | null, fallbackPoints?: number | null): number => {
  const points = tokensToUsagePoints(tokens);
  if (points !== null) return points;
  if (typeof fallbackPoints === 'number' && Number.isFinite(fallbackPoints)) return fallbackPoints;
  return 0;
};

export const formatUsagePoints = (points?: number | null, maximumFractionDigits = 1): string | null => {
  if (typeof points !== 'number' || !Number.isFinite(points)) return null;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(points);
};
