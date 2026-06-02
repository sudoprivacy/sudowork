/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { screen } from 'electron';

/**
 * Mouse wiggle detector using the path tortuosity algorithm.
 *
 * Inspired by Google AI Pointer, macOS "Shake to find cursor",
 * Microsoft PowerToys FindMyMouse, and KDE Plasma ShakeCursor.
 *
 * Algorithm: compare the total distance the cursor traveled to the
 * diagonal of its bounding box over a sliding time window. A straight
 * movement yields a ratio near 1.0; a rapid shake yields 4–6x.
 *
 * Parameters converge across PowerToys (SHAKE_FACTOR=4.0, interval=1000ms,
 * minDistance=1000px) and KDE (sensitivity=4.0, interval=1000ms,
 * minDiagonal=100px).
 */

type Point = { x: number; y: number; t: number };

export type WiggleDetectorOptions = {
  /** Time window in ms to evaluate cursor trail (default: 1000) */
  windowMs?: number;
  /** Minimum ratio of trail length to bounding-box diagonal (default: 4.0) */
  shakeThreshold?: number;
  /** Minimum bounding-box diagonal in px to filter micro-jitter (default: 100) */
  minDiagonal?: number;
  /** Minimum total travel in px to filter slow drift (default: 1000) */
  minDistance?: number;
  /** Debounce after a successful detection in ms (default: 500) */
  debounceMs?: number;
  /** Polling interval in ms (default: 16, ~60Hz) */
  pollIntervalMs?: number;
};

const DEFAULTS: Required<WiggleDetectorOptions> = {
  windowMs: 1000,
  shakeThreshold: 4.0,
  minDiagonal: 100,
  minDistance: 1000,
  debounceMs: 500,
  pollIntervalMs: 16,
};

export class AvatarWiggleDetector {
  private opts: Required<WiggleDetectorOptions>;
  private trail: Point[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTriggerTime = 0;
  private onWiggle: ((cursorPos: { x: number; y: number }) => void) | null = null;

  constructor(options?: WiggleDetectorOptions) {
    this.opts = { ...DEFAULTS, ...options };
  }

  /**
   * Start polling the cursor position.
   * @param callback Called when a wiggle is detected, with the cursor position at trigger time.
   */
  start(callback: (cursorPos: { x: number; y: number }) => void): void {
    this.onWiggle = callback;
    this.trail = [];
    this.lastTriggerTime = 0;

    this.timer = setInterval(() => {
      this.sample();
    }, this.opts.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.trail = [];
    this.onWiggle = null;
  }

  private sample(): void {
    const now = Date.now();
    const pos = screen.getCursorScreenPoint();
    this.trail.push({ x: pos.x, y: pos.y, t: now });

    // Prune entries older than the time window
    const cutoff = now - this.opts.windowMs;
    while (this.trail.length > 0 && this.trail[0].t < cutoff) {
      this.trail.shift();
    }

    // Need at least 2 points to compute anything
    if (this.trail.length < 2) return;

    // Debounce: skip if recently triggered
    if (now - this.lastTriggerTime < this.opts.debounceMs) return;

    // Compute bounding box
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of this.trail) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const diagonal = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);
    if (diagonal < this.opts.minDiagonal) return;

    // Compute total distance traveled
    let totalDistance = 0;
    for (let i = 1; i < this.trail.length; i++) {
      const dx = this.trail[i].x - this.trail[i - 1].x;
      const dy = this.trail[i].y - this.trail[i - 1].y;
      totalDistance += Math.sqrt(dx * dx + dy * dy);
    }
    if (totalDistance < this.opts.minDistance) return;

    // Path tortuosity = total distance / bounding-box diagonal
    const shakeFactor = totalDistance / diagonal;
    if (shakeFactor >= this.opts.shakeThreshold) {
      this.lastTriggerTime = now;
      this.trail = []; // Reset trail after trigger
      this.onWiggle?.({ x: pos.x, y: pos.y });
    }
  }
}
