/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SudoClaw Network Resilience Service
 *
 * Provides graceful degradation when the API/gateway is unreachable:
 * - Exponential backoff with jitter for reconnection attempts
 * - Health probing to detect when network returns
 * - Model error classification (retryable vs permanent)
 * - Connection state tracking and event emission
 */

import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';

// ========== Constants ==========

/** Initial backoff delay (ms) */
const INITIAL_BACKOFF_MS = 1_000;

/** Maximum backoff delay (ms) — 2 minutes */
const MAX_BACKOFF_MS = 120_000;

/** Backoff multiplier */
const BACKOFF_MULTIPLIER = 2;

/** Jitter factor (0.0–1.0) — adds randomness to prevent thundering herd */
const JITTER_FACTOR = 0.3;

/** Maximum consecutive failures before giving up probing */
const MAX_PROBE_FAILURES = 20;

/** Health probe interval when network is down (ms) */
const PROBE_INTERVAL_MS = 10_000;

// ========== Types ==========

export type NetworkState = 'connected' | 'degraded' | 'disconnected';

export type ErrorCategory =
  /** Temporary network issue — retry */
  | 'network_transient'
  /** API rate limited — retry after delay */
  | 'rate_limited'
  /** Model error (overloaded, unavailable) — retry */
  | 'model_error'
  /** Authentication error — do not retry */
  | 'auth_error'
  /** Permanent error — do not retry */
  | 'permanent'
  /** Unknown error — may retry */
  | 'unknown';

export interface NetworkEvent {
  type: 'state_change' | 'retry_scheduled' | 'retry_succeeded' | 'retry_exhausted';
  state: NetworkState;
  message: string;
  retryIn?: number;
  failureCount?: number;
}

export type NetworkEventListener = (event: NetworkEvent) => void;

// ========== Error Classification ==========

const TRANSIENT_ERROR_PATTERNS = [
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /ENETUNREACH/i,
  /EHOSTUNREACH/i,
  /socket hang up/i,
  /network/i,
  /timeout/i,
  /fetch failed/i,
  /aborted/i,
];

const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /too many requests/i,
  /429/,
  /quota/i,
  /throttl/i,
];

const MODEL_ERROR_PATTERNS = [
  /overloaded/i,
  /model.*unavailable/i,
  /capacity/i,
  /503/,
  /502/,
  /500/,
  /internal server error/i,
];

const AUTH_ERROR_PATTERNS = [
  /unauthorized/i,
  /forbidden/i,
  /invalid.*key/i,
  /401/,
  /403/,
  /authentication/i,
];

/**
 * Classify an error to determine retry strategy.
 */
export function classifyError(error: unknown): { category: ErrorCategory; retryable: boolean; retryAfterMs?: number } {
  const message = error instanceof Error ? error.message : String(error);

  // Check rate limiting first (may include retry-after hint)
  for (const pattern of RATE_LIMIT_PATTERNS) {
    if (pattern.test(message)) {
      // Try to extract retry-after from error
      const retryAfterMatch = message.match(/retry.?after:?\s*(\d+)/i);
      const retryAfterMs = retryAfterMatch ? parseInt(retryAfterMatch[1], 10) * 1000 : 60_000;
      return { category: 'rate_limited', retryable: true, retryAfterMs };
    }
  }

  // Check auth errors (non-retryable)
  for (const pattern of AUTH_ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return { category: 'auth_error', retryable: false };
    }
  }

  // Check model errors (retryable with delay)
  for (const pattern of MODEL_ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return { category: 'model_error', retryable: true, retryAfterMs: 30_000 };
    }
  }

  // Check transient network errors
  for (const pattern of TRANSIENT_ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return { category: 'network_transient', retryable: true };
    }
  }

  return { category: 'unknown', retryable: true };
}

// ========== Implementation ==========

export class SudoclawNetworkResilience {
  private state: NetworkState = 'connected';
  private consecutiveFailures = 0;
  private currentBackoffMs = INITIAL_BACKOFF_MS;
  private retryTimer: NodeJS.Timeout | null = null;
  private probeTimer: NodeJS.Timeout | null = null;
  private listeners: NetworkEventListener[] = [];
  private healthProbe: (() => Promise<boolean>) | null = null;
  private onReconnect: (() => Promise<void>) | null = null;

  constructor() {
    mainLog('NetworkResilience', 'Initialized');
  }

  // ========== Public API ==========

  /**
   * Configure the reconnection callbacks.
   * @param healthProbe Function that returns true if gateway/API is reachable
   * @param onReconnect Function to call when reconnection should be attempted
   */
  configure(healthProbe: () => Promise<boolean>, onReconnect: () => Promise<void>): void {
    this.healthProbe = healthProbe;
    this.onReconnect = onReconnect;
  }

  /**
   * Report a connection failure and begin retry logic.
   */
  reportFailure(error: unknown): void {
    this.consecutiveFailures++;
    const classification = classifyError(error);

    mainWarn('NetworkResilience', `Failure #${this.consecutiveFailures}: ${classification.category} — ${error instanceof Error ? error.message : String(error)}`);

    if (!classification.retryable) {
      this.setState('disconnected');
      this.emit({
        type: 'retry_exhausted',
        state: this.state,
        message: `Non-retryable error: ${classification.category}`,
        failureCount: this.consecutiveFailures,
      });
      return;
    }

    this.setState('degraded');

    // Use retry-after hint if available, otherwise exponential backoff
    const delayMs = classification.retryAfterMs ?? this.calculateBackoff();

    this.emit({
      type: 'retry_scheduled',
      state: this.state,
      message: `Retrying in ${Math.round(delayMs / 1000)}s (attempt ${this.consecutiveFailures})`,
      retryIn: delayMs,
      failureCount: this.consecutiveFailures,
    });

    this.scheduleRetry(delayMs);
  }

  /**
   * Report a successful connection.
   */
  reportSuccess(): void {
    const wasDown = this.state !== 'connected';
    this.consecutiveFailures = 0;
    this.currentBackoffMs = INITIAL_BACKOFF_MS;
    this.cancelTimers();
    this.setState('connected');

    if (wasDown) {
      mainLog('NetworkResilience', 'Connection restored');
      this.emit({
        type: 'retry_succeeded',
        state: this.state,
        message: 'Connection restored',
        failureCount: 0,
      });
    }
  }

  /**
   * Start background health probing when disconnected.
   * Automatically attempts reconnection when the probe succeeds.
   */
  startProbing(): void {
    if (this.probeTimer) return;
    if (!this.healthProbe) {
      mainWarn('NetworkResilience', 'No health probe configured');
      return;
    }

    let probeFailures = 0;

    mainLog('NetworkResilience', 'Starting health probe');

    this.probeTimer = setInterval(async () => {
      try {
        const healthy = await this.healthProbe!();
        if (healthy) {
          mainLog('NetworkResilience', 'Health probe succeeded, attempting reconnect');
          this.stopProbing();
          if (this.onReconnect) {
            try {
              await this.onReconnect();
              this.reportSuccess();
            } catch (err) {
              mainWarn('NetworkResilience', `Reconnect after probe failed: ${err instanceof Error ? err.message : String(err)}`);
              this.startProbing(); // Resume probing
            }
          }
        } else {
          probeFailures++;
          if (probeFailures >= MAX_PROBE_FAILURES) {
            mainWarn('NetworkResilience', `Max probe failures (${MAX_PROBE_FAILURES}) reached, stopping`);
            this.stopProbing();
            this.emit({
              type: 'retry_exhausted',
              state: this.state,
              message: `Gateway unreachable after ${MAX_PROBE_FAILURES} probes`,
              failureCount: this.consecutiveFailures,
            });
          }
        }
      } catch (err) {
        probeFailures++;
      }
    }, PROBE_INTERVAL_MS);

    if (typeof this.probeTimer === 'object' && 'unref' in this.probeTimer) {
      this.probeTimer.unref();
    }
  }

  /**
   * Stop health probing.
   */
  stopProbing(): void {
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
      this.probeTimer = null;
    }
  }

  /**
   * Get current network state.
   */
  getState(): NetworkState {
    return this.state;
  }

  /**
   * Get consecutive failure count.
   */
  getFailureCount(): number {
    return this.consecutiveFailures;
  }

  /**
   * Register an event listener.
   */
  onEvent(listener: NetworkEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Clean up all timers and reset state.
   */
  destroy(): void {
    this.cancelTimers();
    this.stopProbing();
    this.listeners = [];
    this.state = 'connected';
    this.consecutiveFailures = 0;
    this.currentBackoffMs = INITIAL_BACKOFF_MS;
    mainLog('NetworkResilience', 'Destroyed');
  }

  // ========== Private Methods ==========

  private calculateBackoff(): number {
    const base = this.currentBackoffMs;
    // Add jitter
    const jitter = base * JITTER_FACTOR * (Math.random() * 2 - 1);
    const delay = Math.min(base + jitter, MAX_BACKOFF_MS);
    // Increase for next time
    this.currentBackoffMs = Math.min(this.currentBackoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
    return Math.max(delay, INITIAL_BACKOFF_MS);
  }

  private scheduleRetry(delayMs: number): void {
    this.cancelTimers();

    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;

      if (!this.onReconnect) {
        mainWarn('NetworkResilience', 'No reconnect handler configured');
        return;
      }

      try {
        await this.onReconnect();
        this.reportSuccess();
      } catch (err) {
        mainWarn('NetworkResilience', `Retry failed: ${err instanceof Error ? err.message : String(err)}`);
        this.reportFailure(err);
      }
    }, delayMs);

    if (typeof this.retryTimer === 'object' && 'unref' in this.retryTimer) {
      this.retryTimer.unref();
    }
  }

  private cancelTimers(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private setState(newState: NetworkState): void {
    if (newState === this.state) return;
    const oldState = this.state;
    this.state = newState;

    mainLog('NetworkResilience', `State: ${oldState} → ${newState}`);

    this.emit({
      type: 'state_change',
      state: newState,
      message: `Network state changed: ${oldState} → ${newState}`,
    });
  }

  private emit(event: NetworkEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        mainError('NetworkResilience', 'Listener error', err);
      }
    }
  }
}
