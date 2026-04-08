/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SudoClaw Persistent Mode - Memory Context Injection
 *
 * Formats recent MemoryLog entries for inclusion in the system prompt.
 * The actual MemoryLog storage is implemented in #214 (daily log memory);
 * this module provides the formatting/template layer so the wiring is
 * straightforward once the storage is available.
 *
 * @see docs/sudoclaw-mvp-plan.md - Section 1.6
 */

/**
 * A single memory log entry as returned by MemoryLog.getRecentLogs().
 *
 * This interface mirrors the expected shape from the MemoryLog service
 * (issue #214). Once that service lands, this can be replaced with a
 * direct import.
 */
export interface MemoryLogEntry {
  /** ISO-8601 date string (e.g. "2026-04-08") */
  date: string;
  /** The log content written via MemoryAppend */
  content: string;
  /** Optional timestamp for intra-day ordering (epoch ms) */
  timestamp?: number;
}

/** Default number of recent log days to include in the system prompt */
export const DEFAULT_RECENT_LOG_COUNT = 3;

/**
 * Format a single memory log entry for display in the system prompt.
 */
function formatLogEntry(entry: MemoryLogEntry): string {
  const header = `### ${entry.date}`;
  return `${header}\n${entry.content.trim()}`;
}

/**
 * Format an array of memory log entries into a human-readable context block
 * suitable for injection into the system prompt.
 *
 * @param entries - Recent memory log entries, newest first
 * @returns Formatted memory context string, or undefined if no entries
 */
export function formatMemoryContext(entries: MemoryLogEntry[]): string | undefined {
  if (!entries || entries.length === 0) {
    return undefined;
  }

  const formatted = entries.map(formatLogEntry).join('\n\n');
  return formatted;
}

/**
 * Retrieve and format recent memory logs for system prompt injection.
 *
 * This is the primary entry point for memory context injection. It calls
 * the MemoryLog service to fetch recent entries and formats them.
 *
 * NOTE: The MemoryLog service (getRecentLogs) is being built in #214.
 * Until that lands, this function returns undefined. The call site in
 * the injection mechanism (injectSudoclawPrompt) handles the undefined
 * case gracefully.
 *
 * @param count - Number of recent log days to retrieve (default: 3)
 * @returns Formatted memory context string, or undefined if unavailable
 */
export async function getMemoryContext(count: number = DEFAULT_RECENT_LOG_COUNT): Promise<string | undefined> {
  try {
    // TODO(#214): Wire up MemoryLog.getRecentLogs once daily log memory lands
    // Example future implementation:
    //
    //   const { MemoryLog } = await import('../../memoryLog/MemoryLog');
    //   const entries = await MemoryLog.getRecentLogs(count);
    //   return formatMemoryContext(entries);
    //
    // For now, return undefined so the system prompt works without memory context.
    void count; // suppress unused-parameter lint warning
    return undefined;
  } catch {
    // Memory context is best-effort; never block the system prompt on failure
    return undefined;
  }
}
