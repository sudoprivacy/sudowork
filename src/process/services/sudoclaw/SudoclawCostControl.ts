/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SudoClaw Cost Control Service
 *
 * Enforces tick rate limits and budget constraints:
 * - Max 30 ticks per hour, 200 ticks per day
 * - Warning at 80% of daily budget
 * - Hard-stop at 100% of daily budget
 * - Configurable min/default sleep intervals
 */

import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';

// ========== Cost Limit Constants ==========

export const COST_LIMITS = {
  /** Maximum ticks allowed per hour */
  maxTicksPerHour: 30,
  /** Maximum ticks allowed per day */
  maxTicksPerDay: 200,
  /** Minimum sleep interval between ticks (minutes) */
  minSleepMinutes: 1,
  /** Default sleep interval between ticks (minutes) */
  defaultSleepMinutes: 5,
  /** Warning threshold as fraction of daily budget (0.0–1.0) */
  tickBudgetWarning: 0.80,
  /** Hard-stop threshold as fraction of daily budget (0.0–1.0) */
  tickBudgetHardStop: 1.00,
} as const;

// ========== Types ==========

export interface TickRecord {
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Conversation/session that generated the tick */
  sessionKey?: string;
}

export type BudgetStatus = 'ok' | 'warning' | 'exceeded';

export interface CostControlState {
  /** Ticks recorded in the current hour window */
  ticksThisHour: number;
  /** Ticks recorded in the current day window */
  ticksThisDay: number;
  /** Budget status: ok, warning, or exceeded */
  budgetStatus: BudgetStatus;
  /** Fraction of daily budget consumed (0.0–1.0) */
  budgetFraction: number;
  /** Whether new ticks are currently allowed */
  canTick: boolean;
  /** Milliseconds until the hourly window resets */
  hourResetMs: number;
  /** Milliseconds until the daily window resets */
  dayResetMs: number;
}

export interface CostControlEvent {
  type: 'budget_warning' | 'budget_exceeded' | 'rate_limited_hourly' | 'rate_limited_daily';
  message: string;
  state: CostControlState;
}

export type CostControlListener = (event: CostControlEvent) => void;

// ========== Implementation ==========

export class SudoclawCostControl {
  private ticks: TickRecord[] = [];
  private listeners: CostControlListener[] = [];
  private warningEmittedForDay: string | null = null;

  constructor() {
    mainLog('CostControl', 'SudoClaw cost control initialized', {
      maxTicksPerHour: COST_LIMITS.maxTicksPerHour,
      maxTicksPerDay: COST_LIMITS.maxTicksPerDay,
    });
  }

  // ========== Public API ==========

  /**
   * Record a tick and check rate limits.
   * @param sessionKey Optional session identifier
   * @param timestamp Optional ISO-8601 timestamp (defaults to now). Useful for
   *   replaying ticks from logs or for testing across time windows.
   * @returns true if the tick was allowed, false if rate-limited
   */
  recordTick(sessionKey?: string, timestamp?: string): boolean {
    this.pruneExpiredTicks();

    const state = this.getState();

    // Check hard-stop
    if (state.budgetStatus === 'exceeded') {
      mainWarn('CostControl', `Tick rejected: daily budget exceeded (${state.ticksThisDay}/${COST_LIMITS.maxTicksPerDay})`);
      this.emit({
        type: 'budget_exceeded',
        message: `Daily tick budget exceeded (${state.ticksThisDay}/${COST_LIMITS.maxTicksPerDay}). Ticks paused until midnight.`,
        state,
      });
      return false;
    }

    // Check hourly rate limit
    if (state.ticksThisHour >= COST_LIMITS.maxTicksPerHour) {
      mainWarn('CostControl', `Tick rejected: hourly rate limit (${state.ticksThisHour}/${COST_LIMITS.maxTicksPerHour})`);
      this.emit({
        type: 'rate_limited_hourly',
        message: `Hourly tick limit reached (${state.ticksThisHour}/${COST_LIMITS.maxTicksPerHour}). Resuming in ${Math.ceil(state.hourResetMs / 60_000)} minutes.`,
        state,
      });
      return false;
    }

    // Record the tick
    const record: TickRecord = {
      timestamp: timestamp ?? new Date().toISOString(),
      sessionKey,
    };
    this.ticks.push(record);

    // Re-check state after recording
    const updatedState = this.getState();

    // Emit warning at 80% threshold
    if (updatedState.budgetStatus === 'warning') {
      const dayKey = this.getDayKey(new Date());
      if (this.warningEmittedForDay !== dayKey) {
        this.warningEmittedForDay = dayKey;
        mainWarn('CostControl', `Budget warning: ${updatedState.ticksThisDay}/${COST_LIMITS.maxTicksPerDay} ticks used today (${Math.round(updatedState.budgetFraction * 100)}%)`);
        this.emit({
          type: 'budget_warning',
          message: `Approaching daily tick limit: ${updatedState.ticksThisDay}/${COST_LIMITS.maxTicksPerDay} used (${Math.round(updatedState.budgetFraction * 100)}%).`,
          state: updatedState,
        });
      }
    }

    mainLog('CostControl', `Tick recorded: ${updatedState.ticksThisHour}/hr, ${updatedState.ticksThisDay}/day`);
    return true;
  }

  /**
   * Get current cost control state without recording a tick.
   */
  getState(): CostControlState {
    this.pruneExpiredTicks();

    const now = new Date();
    const hourStart = this.getHourStart(now);
    const dayStart = this.getDayStart(now);

    const ticksThisHour = this.ticks.filter((t) => new Date(t.timestamp) >= hourStart).length;
    const ticksThisDay = this.ticks.filter((t) => new Date(t.timestamp) >= dayStart).length;

    const budgetFraction = ticksThisDay / COST_LIMITS.maxTicksPerDay;
    let budgetStatus: BudgetStatus = 'ok';
    if (budgetFraction >= COST_LIMITS.tickBudgetHardStop) {
      budgetStatus = 'exceeded';
    } else if (budgetFraction >= COST_LIMITS.tickBudgetWarning) {
      budgetStatus = 'warning';
    }

    const canTick = budgetStatus !== 'exceeded' && ticksThisHour < COST_LIMITS.maxTicksPerHour;

    // Calculate time until window resets
    const hourResetMs = hourStart.getTime() + 60 * 60 * 1000 - now.getTime();
    const nextDayStart = new Date(dayStart);
    nextDayStart.setDate(nextDayStart.getDate() + 1);
    const dayResetMs = nextDayStart.getTime() - now.getTime();

    return {
      ticksThisHour,
      ticksThisDay,
      budgetStatus,
      budgetFraction,
      canTick,
      hourResetMs,
      dayResetMs,
    };
  }

  /**
   * Check if a tick is allowed right now (without recording).
   */
  canTick(): boolean {
    return this.getState().canTick;
  }

  /**
   * Get recommended sleep duration in milliseconds.
   * Returns longer sleep when approaching limits.
   */
  getRecommendedSleepMs(): number {
    const state = this.getState();

    if (state.budgetStatus === 'exceeded') {
      return state.dayResetMs;
    }

    if (!state.canTick) {
      // Hourly limit reached — sleep until hour resets
      return state.hourResetMs;
    }

    const baseSleep = COST_LIMITS.defaultSleepMinutes * 60 * 1000;
    const minSleep = COST_LIMITS.minSleepMinutes * 60 * 1000;

    // Scale sleep duration as budget fraction increases
    if (state.budgetFraction >= 0.9) {
      return baseSleep * 3; // Triple sleep near limit
    }
    if (state.budgetFraction >= COST_LIMITS.tickBudgetWarning) {
      return baseSleep * 2; // Double sleep at warning
    }

    return Math.max(baseSleep, minSleep);
  }

  /**
   * Register a listener for cost control events.
   */
  onEvent(listener: CostControlListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Reset all tick records. Useful for testing or manual override.
   */
  reset(): void {
    this.ticks = [];
    this.warningEmittedForDay = null;
    mainLog('CostControl', 'Cost control state reset');
  }

  /**
   * Inject tick records directly (bypasses rate limiting).
   * Intended for replaying historical ticks or testing.
   */
  injectTicks(records: TickRecord[]): void {
    this.ticks.push(...records);
  }

  /**
   * Get tick count for a specific session in the current day.
   */
  getSessionTickCount(sessionKey: string): number {
    const dayStart = this.getDayStart(new Date());
    return this.ticks.filter((t) => t.sessionKey === sessionKey && new Date(t.timestamp) >= dayStart).length;
  }

  // ========== Private Methods ==========

  /** Remove ticks older than 24 hours */
  private pruneExpiredTicks(): void {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 24);
    const before = this.ticks.length;
    this.ticks = this.ticks.filter((t) => new Date(t.timestamp) >= cutoff);
    const pruned = before - this.ticks.length;
    if (pruned > 0) {
      mainLog('CostControl', `Pruned ${pruned} expired tick records`);
    }
  }

  private getHourStart(now: Date): Date {
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0);
    return hourStart;
  }

  private getDayStart(now: Date): Date {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    return dayStart;
  }

  private getDayKey(now: Date): string {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  private emit(event: CostControlEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        mainError('CostControl', 'Event listener error', err);
      }
    }
  }
}

// ========== Singleton ==========

let instance: SudoclawCostControl | null = null;

export function getSudoclawCostControl(): SudoclawCostControl {
  if (!instance) {
    instance = new SudoclawCostControl();
  }
  return instance;
}

export function resetSudoclawCostControl(): void {
  instance?.reset();
  instance = null;
}
