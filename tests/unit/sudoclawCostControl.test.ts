/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * Generate tick records spread across past hours of the current day.
 * Each hour gets at most 20 ticks to stay under the 30/hr rate limit.
 * All timestamps are in past hours (not the current hour).
 */
function generatePastHourTicks(count: number, sessionKey?: string) {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const currentHour = now.getHours();
  // Use past hours only (0 to currentHour-1)
  const availableHours = Math.max(currentHour, 1);

  const records: { timestamp: string; sessionKey?: string }[] = [];
  let generated = 0;

  for (let hour = 0; hour < availableHours && generated < count; hour++) {
    const ticksThisHour = Math.min(20, count - generated);
    for (let t = 0; t < ticksThisHour; t++) {
      const ts = new Date(dayStart);
      ts.setHours(hour, t * 2, 0, 0); // spread within the hour
      records.push({ timestamp: ts.toISOString(), sessionKey });
      generated++;
    }
  }

  return records;
}

describe('SudoclawCostControl', () => {
  beforeEach(() => {
    vi.resetModules();

    vi.doMock('@process/utils/mainLogger', () => ({
      mainLog: vi.fn(),
      mainWarn: vi.fn(),
      mainError: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records ticks and reports state correctly', async () => {
    const { SudoclawCostControl } = await import('@/process/services/sudoclaw/SudoclawCostControl');
    const control = new SudoclawCostControl();

    // Initially no ticks
    const initialState = control.getState();
    expect(initialState.ticksThisHour).toBe(0);
    expect(initialState.ticksThisDay).toBe(0);
    expect(initialState.budgetStatus).toBe('ok');
    expect(initialState.canTick).toBe(true);
    expect(initialState.budgetFraction).toBe(0);

    // Record a tick
    const allowed = control.recordTick('session-1');
    expect(allowed).toBe(true);

    const state = control.getState();
    expect(state.ticksThisHour).toBe(1);
    expect(state.ticksThisDay).toBe(1);
    expect(state.budgetStatus).toBe('ok');
    expect(state.canTick).toBe(true);
  });

  it('enforces hourly rate limit of 30 ticks', async () => {
    const { SudoclawCostControl, COST_LIMITS } = await import('@/process/services/sudoclaw/SudoclawCostControl');
    const control = new SudoclawCostControl();

    // Record max ticks per hour
    for (let i = 0; i < COST_LIMITS.maxTicksPerHour; i++) {
      expect(control.recordTick()).toBe(true);
    }

    // 31st tick should be rejected
    expect(control.recordTick()).toBe(false);

    const state = control.getState();
    expect(state.ticksThisHour).toBe(COST_LIMITS.maxTicksPerHour);
    expect(state.canTick).toBe(false);
  });

  it('emits budget warning at 80% threshold', async () => {
    const { SudoclawCostControl, COST_LIMITS } = await import('@/process/services/sudoclaw/SudoclawCostControl');
    const control = new SudoclawCostControl();

    const events: { type: string }[] = [];
    control.onEvent((evt) => events.push(evt));

    // Inject ticks to just below 80% threshold (spread across past hours)
    const warningThreshold = Math.ceil(COST_LIMITS.maxTicksPerDay * COST_LIMITS.tickBudgetWarning);
    const preload = generatePastHourTicks(warningThreshold - 1);
    control.injectTicks(preload);

    // This tick should cross the 80% threshold and trigger a warning
    control.recordTick();

    const warningEvents = events.filter((e) => e.type === 'budget_warning');
    expect(warningEvents.length).toBe(1);
  });

  it('hard-stops at 100% daily budget', async () => {
    const { SudoclawCostControl, COST_LIMITS } = await import('@/process/services/sudoclaw/SudoclawCostControl');
    const control = new SudoclawCostControl();

    // Inject exactly maxTicksPerDay ticks (spread across past hours)
    const ticks = generatePastHourTicks(COST_LIMITS.maxTicksPerDay);
    control.injectTicks(ticks);

    // Verify state shows exceeded
    const state = control.getState();
    expect(state.budgetStatus).toBe('exceeded');
    expect(state.ticksThisDay).toBe(COST_LIMITS.maxTicksPerDay);

    // Next tick should be rejected
    const allowed = control.recordTick();
    expect(allowed).toBe(false);
    expect(control.getState().canTick).toBe(false);
  });

  it('tracks per-session tick counts', async () => {
    const { SudoclawCostControl } = await import('@/process/services/sudoclaw/SudoclawCostControl');
    const control = new SudoclawCostControl();

    control.recordTick('session-a');
    control.recordTick('session-a');
    control.recordTick('session-b');

    expect(control.getSessionTickCount('session-a')).toBe(2);
    expect(control.getSessionTickCount('session-b')).toBe(1);
    expect(control.getSessionTickCount('session-c')).toBe(0);
  });

  it('resets state correctly', async () => {
    const { SudoclawCostControl } = await import('@/process/services/sudoclaw/SudoclawCostControl');
    const control = new SudoclawCostControl();

    control.recordTick();
    control.recordTick();
    expect(control.getState().ticksThisDay).toBe(2);

    control.reset();
    expect(control.getState().ticksThisDay).toBe(0);
    expect(control.getState().ticksThisHour).toBe(0);
  });

  it('returns recommended sleep duration that scales with budget usage', async () => {
    const { SudoclawCostControl, COST_LIMITS } = await import('@/process/services/sudoclaw/SudoclawCostControl');
    const control = new SudoclawCostControl();

    const baseSleep = control.getRecommendedSleepMs();

    // Inject 91% of daily ticks in past hours
    const highUsageCount = Math.ceil(COST_LIMITS.maxTicksPerDay * 0.91);
    const ticks = generatePastHourTicks(highUsageCount);
    control.injectTicks(ticks);

    const scaledSleep = control.getRecommendedSleepMs();
    // At 91%+ usage, sleep should be tripled (baseSleep * 3 > baseSleep)
    expect(scaledSleep).toBeGreaterThan(baseSleep);
  });

  it('provides unsubscribe function for event listeners', async () => {
    const { SudoclawCostControl, COST_LIMITS } = await import('@/process/services/sudoclaw/SudoclawCostControl');
    const control = new SudoclawCostControl();

    const events: unknown[] = [];
    const unsub = control.onEvent((evt) => events.push(evt));

    // Unsubscribe
    unsub();

    // Inject enough ticks to exceed budget
    const ticks = generatePastHourTicks(COST_LIMITS.maxTicksPerDay + 1);
    control.injectTicks(ticks);

    // Try to record — should fire budget_exceeded but listener unsubscribed
    control.recordTick();

    expect(events.length).toBe(0);
  });

  it('accepts custom timestamps for tick recording', async () => {
    const { SudoclawCostControl } = await import('@/process/services/sudoclaw/SudoclawCostControl');
    const control = new SudoclawCostControl();

    // Record a tick with a timestamp from 2 hours ago
    const twoHoursAgo = new Date();
    twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);
    control.recordTick('test', twoHoursAgo.toISOString());

    // Should count in daily but not in current hour
    const state = control.getState();
    expect(state.ticksThisDay).toBe(1);
    expect(state.ticksThisHour).toBe(0);
  });

  it('injectTicks adds records without rate limiting', async () => {
    const { SudoclawCostControl, COST_LIMITS } = await import('@/process/services/sudoclaw/SudoclawCostControl');
    const control = new SudoclawCostControl();

    const ticks = generatePastHourTicks(50);
    control.injectTicks(ticks);

    // All 50 should be counted even though hourly limit is 30
    expect(control.getState().ticksThisDay).toBe(50);
  });

  it('singleton functions work correctly', async () => {
    const { getSudoclawCostControl, resetSudoclawCostControl } = await import('@/process/services/sudoclaw/SudoclawCostControl');

    const a = getSudoclawCostControl();
    const b = getSudoclawCostControl();
    expect(a).toBe(b);

    a.recordTick();
    expect(b.getState().ticksThisDay).toBe(1);

    resetSudoclawCostControl();
    const c = getSudoclawCostControl();
    expect(c).not.toBe(a);
    expect(c.getState().ticksThisDay).toBe(0);
  });
});
