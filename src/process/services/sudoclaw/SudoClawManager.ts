/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SudoClaw Persistent Mode Manager
 *
 * Manages the lifecycle of SudoClaw's persistent (always-on) mode.
 * This module provides enable/disable/status for the persistent agent loop.
 *
 * NOTE: This is a stub implementation. The full SudoClawManager core
 * will be provided by #221. This stub defines the interface contract
 * and provides safe no-op defaults so that the IPC bridge and UI
 * components can be developed and tested independently.
 */

import { mainLog, mainWarn } from '@process/utils/mainLogger';

// ─── Types ───────────────────────────────────────────────────────────

/** Session state of the persistent SudoClaw agent */
export type SudoClawSessionState = 'idle' | 'running' | 'sleeping' | 'requires_action' | 'error';

/** Full status snapshot returned by getStatus() */
export interface ISudoClawPersistentStatus {
  /** Whether persistent mode is enabled */
  enabled: boolean;
  /** Current session state */
  sessionState: SudoClawSessionState;
  /** Number of ticks (iterations) the agent has completed */
  tickCount: number;
  /** ISO timestamp — if the agent is sleeping, when it will wake up */
  sleepUntil: string | null;
  /** If sessionState is 'requires_action', the question awaiting user input */
  pendingQuestion: string | null;
  /** Optional error message when sessionState is 'error' */
  error?: string;
}

/** Listener for status change events */
export type SudoClawStatusListener = (status: ISudoClawPersistentStatus) => void;

// ─── Interface ───────────────────────────────────────────────────────

export interface ISudoClawManager {
  /** Enable persistent mode. Starts the agent loop. */
  enable(): Promise<void>;
  /** Disable persistent mode. Stops the agent loop. */
  disable(): Promise<void>;
  /** Get the current persistent mode status. */
  getStatus(): ISudoClawPersistentStatus;
  /** Register a listener for status changes. Returns an unsubscribe function. */
  onStatusChange(listener: SudoClawStatusListener): () => void;
}

// ─── Stub Implementation ─────────────────────────────────────────────

const TAG = 'SudoClawManager';

class SudoClawManagerStub implements ISudoClawManager {
  private _status: ISudoClawPersistentStatus = {
    enabled: false,
    sessionState: 'idle',
    tickCount: 0,
    sleepUntil: null,
    pendingQuestion: null,
  };

  private _listeners: Set<SudoClawStatusListener> = new Set();

  async enable(): Promise<void> {
    mainLog(TAG, 'enable() called (stub)');
    this._status = {
      ...this._status,
      enabled: true,
      sessionState: 'running',
    };
    this._notifyListeners();
  }

  async disable(): Promise<void> {
    mainLog(TAG, 'disable() called (stub)');
    this._status = {
      enabled: false,
      sessionState: 'idle',
      tickCount: 0,
      sleepUntil: null,
      pendingQuestion: null,
    };
    this._notifyListeners();
  }

  getStatus(): ISudoClawPersistentStatus {
    return { ...this._status };
  }

  onStatusChange(listener: SudoClawStatusListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  private _notifyListeners(): void {
    const snapshot = this.getStatus();
    for (const listener of this._listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        mainWarn(TAG, 'Status listener error:', err);
      }
    }
  }
}

/** Singleton instance — will be replaced by the real implementation in #221 */
export const sudoClawManager: ISudoClawManager = new SudoClawManagerStub();
