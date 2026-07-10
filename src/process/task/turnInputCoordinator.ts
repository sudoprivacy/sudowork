/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Sequences user inputs against turn boundaries for one conversation — the single place
 * that decides interrupt-vs-queue (the autoInterrupt × messageQueue matrix) for BOTH the
 * desktop IPC path and the channel (WeChat) path.
 *
 * It sequences opaque **run-closures** (each runs one turn to completion) rather than a
 * concrete task, so the desktop (`() => task.sendMessage(payload)`) and the channel (whose
 * turn also sets up its own streaming state) can both be driven the same way. A run-closure
 * must resolve when its turn finishes; a simple per-conversation serial drain loop then
 * gives correct ordering with no event hooks. `interrupt` cancels the in-flight turn.
 */

export interface QueuedTurn {
  id: string;
  /** User-facing text of the queued input — for the queue chips + dequeue-refill. */
  content: string;
  /** Execute this turn to completion. MUST resolve at turn end (or when cancelled). */
  run: () => Promise<unknown>;
}

export interface InterruptQueueSettings {
  autoInterrupt: boolean;
  messageQueue: boolean;
}

export type SubmitStatus =
  | 'sent' // no turn active → started immediately
  | 'queued' // held; will run in order after the current turn
  | 'interrupting' // cancelling the current turn, this input runs next
  | 'busy'; // a turn is active and both auto-interrupt and queue are off

interface ConversationState {
  queue: QueuedTurn[];
  draining: boolean;
}

export class TurnInputCoordinator {
  private readonly states = new Map<string, ConversationState>();

  private stateOf(conversationId: string): ConversationState {
    let s = this.states.get(conversationId);
    if (!s) {
      s = { queue: [], draining: false };
      this.states.set(conversationId, s);
    }
    return s;
  }

  /** Snapshot of pending (not-yet-run) turns, for the renderer/queue view. */
  getQueue(conversationId: string): QueuedTurn[] {
    return [...this.stateOf(conversationId).queue];
  }

  /** True while a turn is running (or about to run) for this conversation. */
  isActive(conversationId: string): boolean {
    return this.stateOf(conversationId).draining;
  }

  /**
   * Submit a user input for a conversation. Decides — per the settings matrix — whether
   * to run now, interrupt the current turn, or queue it. `interrupt` cancels the in-flight
   * turn (same for every submit on a conversation; e.g. `() => task.stop()`).
   */
  submit(conversationId: string, turn: QueuedTurn, interrupt: () => Promise<unknown>, settings: InterruptQueueSettings, onQueueChange?: (queue: QueuedTurn[]) => void): SubmitStatus {
    const s = this.stateOf(conversationId);
    const notify = () => onQueueChange?.(this.getQueue(conversationId));

    // No turn active → run immediately via the drain loop.
    if (!s.draining) {
      s.queue.push(turn);
      notify();
      void this.drain(conversationId, onQueueChange);
      return 'sent';
    }

    // A turn is active.
    if (settings.autoInterrupt) {
      // First input interrupts; when queue is off, it also drops any pending items.
      if (!settings.messageQueue) s.queue = [];
      s.queue.unshift(turn);
      notify();
      // Cancel the in-flight turn; the drain loop's awaited run() resolves and then picks
      // up the turn we just unshifted to the front. Fire-and-forget: ordering is guaranteed
      // by the synchronous unshift above.
      void Promise.resolve(interrupt()).catch(() => {});
      return 'interrupting';
    }

    if (settings.messageQueue) {
      s.queue.push(turn);
      notify();
      return 'queued';
    }

    // Both off: preserve today's behaviour — a turn in progress blocks new sends.
    return 'busy';
  }

  /** Remove a queued turn (by id, or the most recent if unspecified) and return it. */
  dequeue(conversationId: string, id?: string, onQueueChange?: (queue: QueuedTurn[]) => void): QueuedTurn | undefined {
    const s = this.stateOf(conversationId);
    if (s.queue.length === 0) return undefined;
    let removed: QueuedTurn | undefined;
    if (id === undefined) {
      removed = s.queue.pop();
    } else {
      const i = s.queue.findIndex((q) => q.id === id);
      if (i >= 0) removed = s.queue.splice(i, 1)[0];
    }
    if (removed) onQueueChange?.(this.getQueue(conversationId));
    return removed;
  }

  /** Drop all pending turns for a conversation (does not affect the running turn). */
  clearQueue(conversationId: string, onQueueChange?: (queue: QueuedTurn[]) => void): void {
    const s = this.stateOf(conversationId);
    if (s.queue.length === 0) return;
    s.queue = [];
    onQueueChange?.(this.getQueue(conversationId));
  }

  /** Serial per-conversation runner: one turn at a time, in submission order. */
  private async drain(conversationId: string, onQueueChange?: (queue: QueuedTurn[]) => void): Promise<void> {
    const s = this.stateOf(conversationId);
    if (s.draining) return;
    s.draining = true;
    try {
      while (s.queue.length > 0) {
        const turn = s.queue.shift() as QueuedTurn;
        onQueueChange?.(this.getQueue(conversationId));
        try {
          await turn.run();
        } catch {
          // A failed/cancelled turn must not stall the queue — continue draining.
        }
      }
    } finally {
      s.draining = false;
    }
  }
}

/**
 * App-wide singleton. Keyed internally by conversationId, so the desktop IPC path and the
 * channel path share one sequencer per conversation. cron does NOT go through it (cron keeps
 * its own cronBusyGuard serial semantics).
 */
export const turnInputCoordinator = new TurnInputCoordinator();
