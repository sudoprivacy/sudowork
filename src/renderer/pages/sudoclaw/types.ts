/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SudoClaw Memory Viewer types.
 *
 * These types define the data structures used by the SudoClaw dashboard
 * and memory viewer pages. The IPC providers for memory log access will
 * be added in #214 (MemoryLog + MemoryAppendTool).
 */

/** Possible states of a SudoClaw session */
export type SudoClawSessionState = 'idle' | 'active' | 'paused';

/** A single memory log entry */
export type MemoryEntry = {
  /** Unique entry identifier */
  id: string;
  /** ISO-8601 timestamp of when the entry was created */
  timestamp: string;
  /** Category label (e.g. "observation", "decision", "note") */
  category: string;
  /** Markdown content of the entry */
  content: string;
  /** Optional tags for filtering */
  tags?: string[];
};

/** Dashboard status combining gateway info with session metadata */
export type SudoClawDashboardStatus = {
  /** Whether SudoClaw is enabled by the user */
  enabled: boolean;
  /** Current session state */
  sessionState: SudoClawSessionState;
  /** Number of completed ticks in the current/last session */
  tickCount: number;
  /** ISO-8601 timestamp of last activity, or null if none */
  lastActivity: string | null;
};
