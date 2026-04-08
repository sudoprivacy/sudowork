/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SudoClaw State Pointer — Kairos Pattern
 *
 * Persists SudoClaw state to a JSON file at ~/.sudowork/sudoclaw-state.json
 * so the app can recover from crashes and restarts.
 *
 * Key design decisions (from Kairos):
 * - File-based, not DB — works offline, easy to debug, trivial to backup
 * - Written **immediately** on every state change, not on clean shutdown
 * - 4h TTL based on file mtime — long enough for laptop sleep, short enough to not leak orphans
 * - Heartbeat: periodic mtime bump while SudoClaw is active
 * - Atomic write: write to .tmp then rename to prevent corruption
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';

// ────────────────────────────────────────────────────────────────────────────
//  Constants
// ────────────────────────────────────────────────────────────────────────────

const STATE_DIR = path.join(os.homedir(), '.sudowork');
const STATE_FILE = path.join(STATE_DIR, 'sudoclaw-state.json');
const STATE_TMP_FILE = STATE_FILE + '.tmp';

/** 4-hour TTL in milliseconds — stale pointers beyond this are ignored and deleted */
const TTL_MS = 4 * 60 * 60 * 1000;

/** Heartbeat interval: bump mtime every 5 minutes while active */
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

const TAG = 'StatePointer';

// ────────────────────────────────────────────────────────────────────────────
//  Types
// ────────────────────────────────────────────────────────────────────────────

/**
 * SudoClaw lifecycle states.
 *
 * - `active`          — SudoClaw is running normally
 * - `requires_action` — SudoClaw needs user intervention (e.g. auth expired)
 * - `paused`          — SudoClaw is temporarily paused by the user
 * - `idle`            — SudoClaw is not doing anything (clean state)
 */
export type SudoClawState = 'active' | 'requires_action' | 'paused' | 'idle';

/**
 * The on-disk schema for the state pointer file.
 *
 * Versioned so we can migrate in the future without breaking existing installs.
 */
export interface SudoClawStatePointer {
  /** Schema version for future migrations */
  version: 1;

  /** Current SudoClaw lifecycle state */
  state: SudoClawState;

  /** Whether SudoClaw is currently enabled */
  enabled: boolean;

  /** Whether requires_action was pending at last write */
  pendingAction: boolean;

  /** Conversation ID if SudoClaw is associated with one */
  conversationId?: string;

  /** Session key for resume */
  sessionKey?: string;

  /** Gateway port at time of state save */
  gatewayPort?: number;

  /** ISO timestamp of when this pointer was written */
  writtenAt: string;
}

// ────────────────────────────────────────────────────────────────────────────
//  Internal state
// ────────────────────────────────────────────────────────────────────────────

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

// ────────────────────────────────────────────────────────────────────────────
//  Write — called immediately on every state change
// ────────────────────────────────────────────────────────────────────────────

/**
 * Persist the current SudoClaw state to disk immediately.
 *
 * Uses atomic write (write to `.tmp` then `fs.renameSync`) to prevent
 * corruption if the process crashes mid-write.
 */
export function writeStatePointer(pointer: Omit<SudoClawStatePointer, 'version' | 'writtenAt'>): void {
  const data: SudoClawStatePointer = {
    version: 1,
    ...pointer,
    writtenAt: new Date().toISOString(),
  };

  try {
    // Ensure directory exists
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }

    // Atomic write: .tmp → rename
    fs.writeFileSync(STATE_TMP_FILE, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(STATE_TMP_FILE, STATE_FILE);

    mainLog(TAG, `State pointer written: state=${data.state}, enabled=${data.enabled}, pendingAction=${data.pendingAction}`);
  } catch (error) {
    mainError(TAG, 'Failed to write state pointer', error);
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  Read — with TTL validation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Read the state pointer from disk.
 *
 * Returns `null` if:
 * - The file does not exist
 * - The file is older than 4 hours (TTL expired) — file is deleted
 * - The file is malformed or has an unknown version
 */
export function readStatePointer(): SudoClawStatePointer | null {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return null;
    }

    // Check TTL based on file mtime
    const stat = fs.statSync(STATE_FILE);
    const ageMs = Date.now() - stat.mtimeMs;

    if (ageMs > TTL_MS) {
      mainWarn(TAG, `State pointer expired (age=${Math.round(ageMs / 1000 / 60)}min, TTL=${TTL_MS / 1000 / 60}min) — deleting`);
      deleteStatePointer();
      return null;
    }

    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const data = JSON.parse(raw) as SudoClawStatePointer;

    // Version check for future migrations
    if (data.version !== 1) {
      mainWarn(TAG, `Unknown state pointer version ${data.version} — ignoring`);
      deleteStatePointer();
      return null;
    }

    // Basic shape validation
    if (!data.state || typeof data.enabled !== 'boolean') {
      mainWarn(TAG, 'Malformed state pointer — ignoring');
      deleteStatePointer();
      return null;
    }

    mainLog(TAG, `State pointer loaded: state=${data.state}, enabled=${data.enabled}, pendingAction=${data.pendingAction}, age=${Math.round(ageMs / 1000)}s`);
    return data;
  } catch (error) {
    mainError(TAG, 'Failed to read state pointer', error);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  Delete — clean shutdown or stale pointer cleanup
// ────────────────────────────────────────────────────────────────────────────

/**
 * Delete the state pointer file.
 *
 * Called on clean shutdown or when a stale pointer is detected.
 */
export function deleteStatePointer(): void {
  try {
    if (fs.existsSync(STATE_FILE)) {
      fs.unlinkSync(STATE_FILE);
      mainLog(TAG, 'State pointer deleted');
    }

    // Clean up any leftover .tmp file
    if (fs.existsSync(STATE_TMP_FILE)) {
      fs.unlinkSync(STATE_TMP_FILE);
    }
  } catch (error) {
    mainError(TAG, 'Failed to delete state pointer', error);
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  Heartbeat — periodic mtime bump while SudoClaw is active
// ────────────────────────────────────────────────────────────────────────────

/**
 * Start the heartbeat timer.
 *
 * While SudoClaw is active, periodically bumps the file mtime so that the
 * TTL window slides forward. This prevents the pointer from going stale
 * during long-running sessions.
 *
 * The heartbeat fires every 5 minutes and simply touches the file mtime
 * via `fs.utimesSync` (no rewrite needed).
 */
export function startHeartbeat(): void {
  stopHeartbeat(); // Ensure no duplicate timers

  heartbeatTimer = setInterval(() => {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const now = new Date();
        fs.utimesSync(STATE_FILE, now, now);
        mainLog(TAG, 'Heartbeat: mtime bumped');
      } else {
        mainWarn(TAG, 'Heartbeat: state file missing — stopping heartbeat');
        stopHeartbeat();
      }
    } catch (error) {
      mainError(TAG, 'Heartbeat: failed to bump mtime', error);
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Don't let the heartbeat timer prevent process exit
  if (heartbeatTimer && typeof heartbeatTimer === 'object' && 'unref' in heartbeatTimer) {
    heartbeatTimer.unref();
  }

  mainLog(TAG, `Heartbeat started (interval=${HEARTBEAT_INTERVAL_MS / 1000}s)`);
}

/**
 * Stop the heartbeat timer.
 *
 * Called on clean shutdown or when SudoClaw is disabled.
 */
export function stopHeartbeat(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    mainLog(TAG, 'Heartbeat stopped');
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  Resume check — called on app startup
// ────────────────────────────────────────────────────────────────────────────

/**
 * Result of checking whether a crash recovery resume is needed.
 */
export interface ResumeCheckResult {
  /** Whether a valid, non-expired pointer was found */
  shouldResume: boolean;

  /** Whether `requires_action` was pending at crash time (needs re-notification) */
  pendingAction: boolean;

  /** The full pointer data if available */
  pointer: SudoClawStatePointer | null;
}

/**
 * Check if SudoClaw should resume from a previous crash.
 *
 * Reads the state pointer and determines:
 * 1. Is there a valid pointer? (not expired, not malformed)
 * 2. Was SudoClaw enabled at crash time?
 * 3. Was `requires_action` pending? (needs re-notification)
 *
 * This is a read-only check — the caller decides whether to actually resume.
 */
export function checkForResume(): ResumeCheckResult {
  const pointer = readStatePointer();

  if (!pointer) {
    return { shouldResume: false, pendingAction: false, pointer: null };
  }

  // Only resume if SudoClaw was enabled and in an active/requires_action state
  const resumableStates: SudoClawState[] = ['active', 'requires_action'];
  const shouldResume = pointer.enabled && resumableStates.includes(pointer.state);

  if (!shouldResume) {
    mainLog(TAG, `Resume check: not resumable (enabled=${pointer.enabled}, state=${pointer.state}) — cleaning up`);
    deleteStatePointer();
    return { shouldResume: false, pendingAction: false, pointer: null };
  }

  mainLog(TAG, `Resume check: should resume (state=${pointer.state}, pendingAction=${pointer.pendingAction})`);

  return {
    shouldResume: true,
    pendingAction: pointer.pendingAction,
    pointer,
  };
}

// ────────────────────────────────────────────────────────────────────────────
//  Convenience — lifecycle helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Mark SudoClaw as active and start the heartbeat.
 *
 * Call this when SudoClaw transitions to an active state.
 */
export function markActive(opts: {
  conversationId?: string;
  sessionKey?: string;
  gatewayPort?: number;
}): void {
  writeStatePointer({
    state: 'active',
    enabled: true,
    pendingAction: false,
    ...opts,
  });
  startHeartbeat();
}

/**
 * Mark SudoClaw as requiring user action.
 *
 * Call this when SudoClaw needs user intervention (e.g. auth expired).
 * The heartbeat continues so the pointer stays fresh.
 */
export function markRequiresAction(opts: {
  conversationId?: string;
  sessionKey?: string;
  gatewayPort?: number;
}): void {
  writeStatePointer({
    state: 'requires_action',
    enabled: true,
    pendingAction: true,
    ...opts,
  });
  // Keep heartbeat running — user may come back
}

/**
 * Mark SudoClaw as cleanly shut down.
 *
 * Deletes the state pointer and stops the heartbeat.
 * Call this on clean shutdown or when the user disables SudoClaw.
 */
export function markShutdown(): void {
  stopHeartbeat();
  deleteStatePointer();
  mainLog(TAG, 'Clean shutdown — state pointer cleared');
}
