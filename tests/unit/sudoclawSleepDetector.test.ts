/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('SudoclawSleepDetector', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();

    vi.doMock('@process/utils/mainLogger', () => ({
      mainLog: vi.fn(),
      mainWarn: vi.fn(),
      mainError: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts and stops without error', async () => {
    const { SudoclawSleepDetector } = await import('@/process/services/sudoclaw/SudoclawSleepDetector');
    const detector = new SudoclawSleepDetector(1000, 5000);

    expect(detector.isRunning()).toBe(false);

    detector.start();
    expect(detector.isRunning()).toBe(true);

    detector.stop();
    expect(detector.isRunning()).toBe(false);
  });

  it('detects suspension when ping gap exceeds threshold', async () => {
    const { SudoclawSleepDetector } = await import('@/process/services/sudoclaw/SudoclawSleepDetector');
    // Small intervals for testing: ping every 100ms, threshold 500ms
    const detector = new SudoclawSleepDetector(100, 500);

    const events: { reason: string; gapMs: number }[] = [];
    detector.onSleepResume((evt) => events.push(evt));

    const startTime = Date.now();
    detector.start();

    // Fire one callback normally to set lastPingAt
    vi.advanceTimersByTime(100);
    expect(events.length).toBe(0); // no suspension yet

    // Simulate system sleep: jump Date.now() forward by 700ms without firing callbacks
    vi.setSystemTime(startTime + 800);

    // Now fire the next interval callback — it sees a large gap
    vi.advanceTimersByTime(100);

    expect(events.length).toBe(1);
    expect(events[0].gapMs).toBeGreaterThanOrEqual(500);
    expect(detector.getSuspensionCount()).toBe(1);

    detector.stop();
  });

  it('does not detect suspension during normal operation', async () => {
    const { SudoclawSleepDetector } = await import('@/process/services/sudoclaw/SudoclawSleepDetector');
    const detector = new SudoclawSleepDetector(100, 5000);

    const events: unknown[] = [];
    detector.onSleepResume((evt) => events.push(evt));

    detector.start();

    // Advance less than threshold
    vi.advanceTimersByTime(200);

    expect(events.length).toBe(0);
    expect(detector.getSuspensionCount()).toBe(0);

    detector.stop();
  });

  it('recordPing resets the last ping timestamp', async () => {
    const { SudoclawSleepDetector } = await import('@/process/services/sudoclaw/SudoclawSleepDetector');
    const detector = new SudoclawSleepDetector(100, 500);

    const events: unknown[] = [];
    detector.onSleepResume((evt) => events.push(evt));

    detector.start();

    // Advance partway toward threshold
    vi.advanceTimersByTime(300);

    // Manual ping resets the counter
    detector.recordPing();

    // Advance again — total without ping reset would be >500ms but with reset it's <500ms
    vi.advanceTimersByTime(300);

    expect(events.length).toBe(0);

    detector.stop();
  });

  it('unsubscribe removes listener', async () => {
    const { SudoclawSleepDetector } = await import('@/process/services/sudoclaw/SudoclawSleepDetector');
    const detector = new SudoclawSleepDetector(100, 500);

    const events: unknown[] = [];
    const unsub = detector.onSleepResume((evt) => events.push(evt));

    unsub();

    detector.start();
    vi.advanceTimersByTime(700);

    // Event was not delivered because we unsubscribed
    expect(events.length).toBe(0);

    detector.stop();
  });

  it('singleton functions work correctly', async () => {
    const { getSudoclawSleepDetector, resetSudoclawSleepDetector } = await import('@/process/services/sudoclaw/SudoclawSleepDetector');

    const a = getSudoclawSleepDetector();
    const b = getSudoclawSleepDetector();
    expect(a).toBe(b);

    resetSudoclawSleepDetector();
    const c = getSudoclawSleepDetector();
    expect(c).not.toBe(a);
  });
});
