/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SleepTool — Pause the SudoClaw tick loop
 *
 * The model calls this tool when it decides to wait before continuing.
 * The tick loop is paused for the requested duration; the session can be
 * woken early by a user message, channel notification, or cron task.
 *
 * Schema: { duration_minutes: number (1-60), reason: string }
 * Returns: { status: 'sleeping', wake_at: ISO timestamp }
 */

import { mainLog } from '@process/utils/mainLogger';
import type { SudoClawTool, SleepToolInput, SleepToolResult } from './types';

const TAG = 'SleepTool';

const MIN_DURATION_MINUTES = 1;
const MAX_DURATION_MINUTES = 60;

/**
 * Create a SleepTool instance.
 *
 * Pure factory — no side-effects until `execute` is called.
 */
export function createSleepTool(): SudoClawTool<SleepToolInput, SleepToolResult> {
  return {
    name: 'sudoclaw_sleep',
    description: 'Pause the session for a specified duration (1-60 minutes). ' + 'You will be woken by: a user message, a channel notification, or a cron task. ' + 'Use this when there is nothing to do right now but you expect activity later.',
    schema: {
      type: 'object',
      properties: {
        duration_minutes: {
          type: 'number',
          description: 'How long to sleep, in minutes (1-60).',
          minimum: MIN_DURATION_MINUTES,
          maximum: MAX_DURATION_MINUTES,
        },
        reason: {
          type: 'string',
          description: 'Human-readable reason for sleeping (logged for debugging).',
        },
      },
      required: ['duration_minutes', 'reason'],
    },

    async execute(input, manager) {
      const { duration_minutes, reason } = input;

      // Clamp duration to valid range
      const clampedMinutes = Math.max(MIN_DURATION_MINUTES, Math.min(MAX_DURATION_MINUTES, Math.round(duration_minutes)));
      const durationMs = clampedMinutes * 60 * 1000;
      const wakeAt = new Date(Date.now() + durationMs).toISOString();

      mainLog(TAG, `Sleeping for ${clampedMinutes}m — reason: ${reason}`, {
        conversationId: manager.conversationId,
        wakeAt,
      });

      // Transition state before blocking
      manager.transitionState('sleeping');

      // Block until the sleep expires or the session is woken early
      await manager.sleep(durationMs);

      mainLog(TAG, 'Woke up', { conversationId: manager.conversationId });

      return {
        status: 'sleeping' as const,
        wake_at: wakeAt,
      };
    },
  };
}
