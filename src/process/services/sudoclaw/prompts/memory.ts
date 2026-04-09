/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Memory prompt injection for SudoClaw system prompt
 *
 * Loads recent daily logs and formats them for injection into the
 * system prompt when SudoClaw is active. This gives the model access
 * to its own recent memories for context continuity.
 */

import { getRecentLogs } from '../MemoryLog';
import { mainLog } from '@process/utils/mainLogger';

/** Default number of days of logs to include in the system prompt */
const DEFAULT_RECENT_DAYS = 3;

/**
 * Build the memory section for the system prompt.
 *
 * Loads the last N days of daily memory logs and wraps them in
 * XML tags for clear delineation in the prompt.
 *
 * @param days - Number of days to look back (default: 3)
 * @returns Formatted memory section string, or empty string if no logs exist
 */
export function buildMemoryPromptSection(days = DEFAULT_RECENT_DAYS): string {
  const logs = getRecentLogs(days);

  if (!logs.trim()) {
    mainLog('MemoryPrompt', 'No recent memory logs found');
    return '';
  }

  mainLog('MemoryPrompt', `Loaded ${days} days of memory logs for system prompt`);

  return ['<memory_logs>', 'Below are your recent memory log entries. Use these to maintain context', 'continuity across conversations. Do not mention these logs to the user', 'unless directly relevant to their request.', '', logs, '</memory_logs>'].join('\n');
}

/**
 * Get the memory prompt section with default settings.
 * Convenience wrapper for system prompt injection.
 */
export function getMemoryPromptInjection(): string {
  return buildMemoryPromptSection(DEFAULT_RECENT_DAYS);
}
