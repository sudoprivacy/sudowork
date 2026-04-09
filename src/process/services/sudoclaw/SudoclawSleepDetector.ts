/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SudoClaw Sleep/Resume Detector
 *
 * Detects laptop suspension and app sleep by monitoring ping gaps.
 * When a gap exceeds the threshold (default 60s), it triggers a
 * force-reconnect callback so the gateway connection can be restored.
 *
 * Implementation: a periodic timer fires at a fixed interval (e.g., every 5s).
 * If the actual elapsed time between timer firings exceeds the suspension
 * threshold, the system was likely suspended (sleep/hibernate).
 */

import { mainLog, mainWarn } from '@process/utils/mainLogger';

// ========== Constants ==========

/** Default ping interval for sleep detection (ms) */
const DEFAULT_PING_INTERVAL_MS = 5_000;

/** Default threshold for detecting suspension (ms) — 60 seconds */
const DEFAULT_SUSPENSION_THRESHOLD_MS = 60_000;

// ========== Types ==========

export type SleepResumeReason = 'suspension_detected' | 'long_pause';

export interface SleepResumeEvent {
  /** Reason for the event */
  reason: SleepResumeReason;
  /** How long the system was asleep (ms) */
  gapMs: number;
  /** Timestamp when suspension was detected */
  detectedAt: number;
}

export type SleepResumeListener = (event: SleepResumeEvent) => void;

// ========== Implementation ==========

export class SudoclawSleepDetector {
  private timer: NodeJS.Timeout | null = null;
  private lastPingAt: number = Date.now();
  private pingIntervalMs: number;
  private suspensionThresholdMs: number;
  private listeners: SleepResumeListener[] = [];
  private running = false;

  /** Total number of suspensions detected since start */
  private suspensionCount = 0;

  constructor(
    pingIntervalMs: number = DEFAULT_PING_INTERVAL_MS,
    suspensionThresholdMs: number = DEFAULT_SUSPENSION_THRESHOLD_MS,
  ) {
    this.pingIntervalMs = pingIntervalMs;
    this.suspensionThresholdMs = suspensionThresholdMs;
  }

  // ========== Public API ==========

  /**
   * Start monitoring for sleep/resume events.
   */
  start(): void {
    if (this.running) return;

    this.running = true;
    this.lastPingAt = Date.now();
    this.suspensionCount = 0;

    mainLog('SleepDetector', `Started: interval=${this.pingIntervalMs}ms, threshold=${this.suspensionThresholdMs}ms`);

    this.timer = setInterval(() => {
      this.checkForSuspension();
    }, this.pingIntervalMs);

    // Don't keep the process alive just for this timer
    if (typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref();
    }
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    mainLog('SleepDetector', `Stopped after detecting ${this.suspensionCount} suspension(s)`);
  }

  /**
   * Register a listener for sleep/resume events.
   * Returns an unsubscribe function.
   */
  onSleepResume(listener: SleepResumeListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Get the number of suspensions detected since start.
   */
  getSuspensionCount(): number {
    return this.suspensionCount;
  }

  /**
   * Check if currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Manually update the last ping timestamp.
   * Useful when receiving tick events from the gateway.
   */
  recordPing(): void {
    this.lastPingAt = Date.now();
  }

  // ========== Private Methods ==========

  private checkForSuspension(): void {
    const now = Date.now();
    const gap = now - this.lastPingAt;

    if (gap > this.suspensionThresholdMs) {
      this.suspensionCount++;
      mainWarn('SleepDetector', `Suspension detected: gap=${Math.round(gap / 1000)}s (threshold=${Math.round(this.suspensionThresholdMs / 1000)}s), count=${this.suspensionCount}`);

      const event: SleepResumeEvent = {
        reason: gap > this.suspensionThresholdMs * 5 ? 'suspension_detected' : 'long_pause',
        gapMs: gap,
        detectedAt: now,
      };

      this.emitEvent(event);
    }

    this.lastPingAt = now;
  }

  private emitEvent(event: SleepResumeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        mainWarn('SleepDetector', `Listener error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

// ========== Singleton ==========

let instance: SudoclawSleepDetector | null = null;

export function getSudoclawSleepDetector(): SudoclawSleepDetector {
  if (!instance) {
    instance = new SudoclawSleepDetector();
  }
  return instance;
}

export function resetSudoclawSleepDetector(): void {
  instance?.stop();
  instance = null;
}
