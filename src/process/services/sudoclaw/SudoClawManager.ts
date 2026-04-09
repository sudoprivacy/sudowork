/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SudoClawManager — Persistent Assistant Lifecycle Manager (Kairos Pattern)
 *
 * Wraps any existing agent conversation (AcpAgent, OpenClawAgent, etc.) with
 * persistent assistant behavior. Does NOT own or create the agent — resolves it
 * from WorkerManage and injects `<tick>` heartbeat messages so the model can
 * self-schedule proactive actions.
 *
 * Key design principle:
 *   The agent doesn't know it's persistent. SudoClawManager simply sends
 *   `<tick>timestamp</tick>` messages at regular intervals and the model's
 *   system prompt decides what to do with them.
 *
 * Architecture:
 *   SudoClawManager  ──▶  WorkerManage.getTaskById(conversationId)
 *                              │
 *                              ▼
 *                         agent.sendMessage({ content: '<tick>...</tick>' })
 *
 * State machine:
 *   idle ──▶ running ──▶ idle          (normal tick cycle)
 *   idle ──▶ running ──▶ requires_action ──▶ running ──▶ idle
 *
 * References:
 *   - Kairos architecture: persistent-assistant heartbeat pattern
 *   - CronService: timer/lifecycle patterns
 *   - CronBusyGuard: conversation busy-state tracking
 */

import { getDatabase } from '@process/database';
import { uuid } from '@/common/utils';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { cronBusyGuard } from '../cron/CronBusyGuard';

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

/** Session states for the persistent assistant */
export type SessionState = 'idle' | 'running' | 'requires_action';

/**
 * Persisted state stored in `conversation.extra.sudoClaw`.
 * Survives app restarts so `resume()` can reconstruct the manager.
 */
export interface SudoClawState {
  /** Whether persistent mode is active for this conversation */
  enabled: boolean;
  /** The conversation this manager is bound to */
  conversationId: string;
  /** Timestamp of last tick or user interaction */
  lastActivity: number;
  /** Whether the assistant should proactively act on ticks */
  isProactive: boolean;
  /** Tick interval in milliseconds (default: 60_000) */
  tickIntervalMs: number;
  /** If set, ticks are suppressed until this timestamp */
  sleepUntil: number | null;
  /** Current session state */
  sessionState: SessionState;
  /** Question text when state is `requires_action` (AskUser pending) */
  pendingQuestion: string | null;
}

/** Default tick interval: 60 seconds */
const DEFAULT_TICK_INTERVAL_MS = 60_000;

/** Minimum tick interval to prevent runaway loops */
const MIN_TICK_INTERVAL_MS = 5_000;

/** Grace period after user message before resuming ticks */
const USER_MESSAGE_GRACE_MS = 3_000;

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Lazy-import WorkerManage to avoid circular dependency at module load time */
async function getWorkerManage() {
  const mod = await import('@process/WorkerManage');
  return mod.default;
}

function createDefaultState(conversationId: string): SudoClawState {
  return {
    enabled: true,
    conversationId,
    lastActivity: Date.now(),
    isProactive: true,
    tickIntervalMs: DEFAULT_TICK_INTERVAL_MS,
    sleepUntil: null,
    sessionState: 'idle',
    pendingQuestion: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  SudoClawManager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages the persistent-assistant lifecycle for a single conversation.
 *
 * Multiple SudoClawManager instances can coexist (one per conversation) and are
 * tracked by the `sudoClawRegistry` singleton exported from `./index.ts`.
 */
export class SudoClawManager {
  // ── Internal state ──
  private state: SudoClawState;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingUserMessage = false;
  private lastUserMessageAt = 0;
  private disposed = false;

  // ── Constructor (private — use static factories) ──
  private constructor(state: SudoClawState) {
    this.state = state;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Static Factories
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Enable persistent mode for an existing conversation.
   *
   * Promotes the conversation by writing `sudoClaw` state into
   * `conversation.extra` and starting the tick loop.
   */
  static async enable(
    conversationId: string,
    options?: Partial<Pick<SudoClawState, 'tickIntervalMs' | 'isProactive'>>,
  ): Promise<SudoClawManager> {
    mainLog('SudoClawManager', `Enabling persistent mode for conversation ${conversationId}`);

    // Validate conversation exists
    const db = getDatabase();
    const convResult = db.getConversation(conversationId);
    if (!convResult.success || !convResult.data) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // Validate agent task exists
    const WorkerManage = await getWorkerManage();
    const task = WorkerManage.getTaskById(conversationId);
    if (!task) {
      // Try to build it from database
      try {
        await WorkerManage.getTaskByIdRollbackBuild(conversationId);
      } catch {
        throw new Error(`Cannot resolve agent task for conversation: ${conversationId}`);
      }
    }

    // Build initial state
    const state = createDefaultState(conversationId);
    if (options?.tickIntervalMs !== undefined) {
      state.tickIntervalMs = Math.max(options.tickIntervalMs, MIN_TICK_INTERVAL_MS);
    }
    if (options?.isProactive !== undefined) {
      state.isProactive = options.isProactive;
    }

    // Persist to conversation.extra
    const conversation = convResult.data;
    const updatedExtra = {
      ...(conversation.extra as Record<string, unknown>),
      sudoClaw: state,
    };
    db.updateConversation(conversationId, { extra: updatedExtra } as any);

    // Create manager and start tick loop
    const manager = new SudoClawManager(state);
    manager.scheduleNextTick();

    mainLog('SudoClawManager', `Persistent mode enabled: interval=${state.tickIntervalMs}ms proactive=${state.isProactive}`);
    return manager;
  }

  /**
   * Resume a previously enabled persistent conversation after app restart.
   *
   * Reads `sudoClaw` state from `conversation.extra` and restarts the tick loop.
   * Returns `null` if the conversation is not in persistent mode.
   */
  static async resume(conversationId: string): Promise<SudoClawManager | null> {
    const db = getDatabase();
    const convResult = db.getConversation(conversationId);
    if (!convResult.success || !convResult.data) {
      mainWarn('SudoClawManager', `Cannot resume: conversation ${conversationId} not found`);
      return null;
    }

    const extra = convResult.data.extra as Record<string, unknown> | undefined;
    const persisted = extra?.sudoClaw as SudoClawState | undefined;
    if (!persisted || !persisted.enabled) {
      return null;
    }

    mainLog('SudoClawManager', `Resuming persistent mode for conversation ${conversationId}`);

    // Restore state — reset session to idle (we don't know model state after restart)
    const state: SudoClawState = {
      ...persisted,
      sessionState: 'idle',
      pendingQuestion: null,
      lastActivity: Date.now(),
    };

    // Ensure agent task can be resolved
    try {
      const WorkerManage = await getWorkerManage();
      const existing = WorkerManage.getTaskById(conversationId);
      if (!existing) {
        await WorkerManage.getTaskByIdRollbackBuild(conversationId);
      }
    } catch (err) {
      mainWarn('SudoClawManager', `Cannot resolve agent task for resume, deferring tick loop: ${err}`);
      // Still create the manager — the tick loop will attempt task resolution on each tick
    }

    const manager = new SudoClawManager(state);
    manager.persistState();
    manager.scheduleNextTick();

    mainLog('SudoClawManager', `Resumed: state=${state.sessionState} lastActivity=${new Date(state.lastActivity).toISOString()}`);
    return manager;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Public API
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get the conversation ID this manager is bound to */
  get conversationId(): string {
    return this.state.conversationId;
  }

  /** Get the current session state */
  get sessionState(): SessionState {
    return this.state.sessionState;
  }

  /** Get a read-only snapshot of the full state */
  getState(): Readonly<SudoClawState> {
    return { ...this.state };
  }

  /** Check if this manager is currently enabled and active */
  get isEnabled(): boolean {
    return this.state.enabled && !this.disposed;
  }

  /**
   * Disable persistent mode — stops tick loop and clears persisted state.
   */
  async disable(): Promise<void> {
    mainLog('SudoClawManager', `Disabling persistent mode for conversation ${this.state.conversationId}`);

    // Stop tick loop
    this.clearTickTimer();
    this.state.enabled = false;
    this.state.sessionState = 'idle';
    this.state.pendingQuestion = null;
    this.disposed = true;

    // Clear persisted state
    try {
      const db = getDatabase();
      const convResult = db.getConversation(this.state.conversationId);
      if (convResult.success && convResult.data) {
        const extra = { ...(convResult.data.extra as Record<string, unknown>) };
        delete extra.sudoClaw;
        db.updateConversation(this.state.conversationId, { extra } as any);
      }
    } catch (err) {
      mainWarn('SudoClawManager', `Failed to clear persisted state: ${err}`);
    }

    mainLog('SudoClawManager', 'Persistent mode disabled');
  }

  /**
   * Put the assistant to sleep for a duration.
   * Tick loop continues but ticks are suppressed until `sleepUntil`.
   */
  sleep(durationMs: number): void {
    const until = Date.now() + durationMs;
    mainLog('SudoClawManager', `Sleeping until ${new Date(until).toISOString()} (${durationMs}ms)`);

    this.state.sleepUntil = until;
    this.state.sessionState = 'idle';
    this.persistState();
  }

  /**
   * Wake the assistant early from sleep.
   * @param reason - Human-readable reason for the wake-up (logged)
   */
  wake(reason: string): void {
    if (this.state.sleepUntil === null) {
      mainLog('SudoClawManager', 'wake() called but assistant is not sleeping');
      return;
    }

    mainLog('SudoClawManager', `Waking up: reason="${reason}"`);
    this.state.sleepUntil = null;
    this.persistState();

    // Trigger an immediate tick
    this.clearTickTimer();
    void this.executeTick();
  }

  /**
   * Notify the manager that a user message is about to be sent.
   * The tick loop will yield to user messages to avoid interleaving.
   */
  notifyUserMessage(): void {
    this.pendingUserMessage = true;
    this.lastUserMessageAt = Date.now();
    this.state.lastActivity = Date.now();

    // If we're in requires_action, the user response will be handled by handleUserResponse
    if (this.state.sessionState !== 'requires_action') {
      this.state.sessionState = 'running';
      this.persistState();
    }
  }

  /**
   * Notify the manager that the user message has been fully processed.
   * Resumes the tick loop after a grace period.
   */
  notifyUserMessageComplete(): void {
    this.pendingUserMessage = false;
    this.state.lastActivity = Date.now();

    if (this.state.sessionState === 'running') {
      this.transitionTo('idle');
    }

    // Re-schedule tick with grace period so we don't immediately tick after user interaction
    this.clearTickTimer();
    this.tickTimer = setTimeout(() => {
      this.scheduleNextTick();
    }, USER_MESSAGE_GRACE_MS);
  }

  /**
   * Handle a user response that unblocks `requires_action` state.
   * This is called when the user answers an AskUser question.
   *
   * @param response - The user's response text
   */
  async handleUserResponse(response: string): Promise<void> {
    if (this.state.sessionState !== 'requires_action') {
      mainWarn('SudoClawManager', `handleUserResponse called but state is ${this.state.sessionState}, not requires_action`);
      return;
    }

    mainLog('SudoClawManager', `User responded to pending question, resuming tick loop`);

    this.state.pendingQuestion = null;
    this.state.lastActivity = Date.now();
    this.transitionTo('running');

    // Send the response through the agent
    try {
      const WorkerManage = await getWorkerManage();
      const task = WorkerManage.getTaskById(this.state.conversationId);
      if (!task) {
        mainError('SudoClawManager', 'Cannot send user response: agent task not found');
        this.transitionTo('idle');
        return;
      }

      const msgId = uuid();
      await task.sendMessage({ content: response, msg_id: msgId });
      this.state.lastActivity = Date.now();
      this.transitionTo('idle');
    } catch (err) {
      mainError('SudoClawManager', `Failed to send user response: ${err}`);
      this.transitionTo('idle');
    }

    // Resume tick loop
    this.scheduleNextTick();
  }

  /**
   * Signal that the model is requesting user action (e.g., AskUser tool call).
   * Pauses the tick loop until `handleUserResponse()` is called.
   */
  setRequiresAction(question: string): void {
    mainLog('SudoClawManager', `Model requires user action: "${question.slice(0, 100)}..."`);

    this.state.pendingQuestion = question;
    this.transitionTo('requires_action');

    // Pause the tick loop — ticks will be skipped while in requires_action
    this.clearTickTimer();
  }

  /**
   * Update the tick interval at runtime.
   */
  setTickInterval(intervalMs: number): void {
    const clamped = Math.max(intervalMs, MIN_TICK_INTERVAL_MS);
    mainLog('SudoClawManager', `Tick interval updated: ${this.state.tickIntervalMs}ms → ${clamped}ms`);

    this.state.tickIntervalMs = clamped;
    this.persistState();

    // Restart tick loop with new interval
    this.clearTickTimer();
    this.scheduleNextTick();
  }

  /**
   * Clean up all resources. Called when the conversation is closed or deleted.
   */
  dispose(): void {
    this.clearTickTimer();
    this.disposed = true;
    mainLog('SudoClawManager', `Disposed manager for conversation ${this.state.conversationId}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Tick Loop (Kairos Pattern)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute a single tick — inject `<tick>timestamp</tick>` into the conversation.
   *
   * The tick is a bare meta-message that the model's system prompt interprets.
   * The model decides whether to act (check tasks, send reminders, etc.) or
   * simply acknowledge and wait for the next tick.
   *
   * Tick is skipped when:
   * - Manager is disabled or disposed
   * - Session is in `requires_action` (waiting for user)
   * - Session is in `running` (model is currently processing)
   * - A user message is pending or was just sent (grace period)
   * - The assistant is sleeping (`sleepUntil` is in the future)
   * - The agent task cannot be resolved
   * - The conversation is busy (checked via CronBusyGuard)
   */
  private async executeTick(): Promise<void> {
    // ── Guard: disabled / disposed ──
    if (!this.state.enabled || this.disposed) {
      return;
    }

    // ── Guard: requires_action — tick loop is paused ──
    if (this.state.sessionState === 'requires_action') {
      mainLog('SudoClawManager', 'Tick skipped: waiting for user action');
      // Do NOT schedule next tick — handleUserResponse will restart it
      return;
    }

    // ── Guard: already running ──
    if (this.state.sessionState === 'running') {
      mainLog('SudoClawManager', 'Tick skipped: model is currently processing');
      this.scheduleNextTick();
      return;
    }

    // ── Guard: user message pending or within grace period ──
    if (this.hasPendingUserMessage()) {
      mainLog('SudoClawManager', 'Tick skipped: user message pending or in grace period');
      this.scheduleNextTick();
      return;
    }

    // ── Guard: sleeping ──
    if (this.state.sleepUntil !== null) {
      if (Date.now() < this.state.sleepUntil) {
        mainLog('SudoClawManager', `Tick skipped: sleeping until ${new Date(this.state.sleepUntil).toISOString()}`);
        this.scheduleNextTick();
        return;
      }
      // Sleep expired — clear it
      mainLog('SudoClawManager', 'Sleep expired, resuming ticks');
      this.state.sleepUntil = null;
      this.persistState();
    }

    // ── Guard: conversation busy (checked via CronBusyGuard) ──
    if (cronBusyGuard.isProcessing(this.state.conversationId)) {
      mainLog('SudoClawManager', 'Tick skipped: conversation is busy');
      this.scheduleNextTick();
      return;
    }

    // ── Resolve agent task ──
    let task;
    try {
      const WorkerManage = await getWorkerManage();
      task = WorkerManage.getTaskById(this.state.conversationId);
      if (!task) {
        // Attempt to build from database
        task = await WorkerManage.getTaskByIdRollbackBuild(this.state.conversationId);
      }
    } catch (err) {
      mainWarn('SudoClawManager', `Tick skipped: cannot resolve agent task: ${err}`);
      this.scheduleNextTick();
      return;
    }

    if (!task) {
      mainWarn('SudoClawManager', 'Tick skipped: agent task is null');
      this.scheduleNextTick();
      return;
    }

    // ── Transition to running and send tick ──
    this.transitionTo('running');

    const timestamp = new Date().toLocaleTimeString();
    const tickContent = `<tick>${timestamp}</tick>`;
    const msgId = `tick_${uuid()}`;

    try {
      mainLog('SudoClawManager', `Sending tick: ${tickContent}`);
      await task.sendMessage({ content: tickContent, msg_id: msgId });

      this.state.lastActivity = Date.now();

      // If still in running state (model didn't trigger requires_action during processing),
      // transition back to idle
      if (this.state.sessionState === 'running') {
        this.transitionTo('idle');
      }
    } catch (err) {
      mainError('SudoClawManager', `Tick failed: ${err}`);
      // Recover to idle so the loop continues
      if (this.state.sessionState === 'running') {
        this.transitionTo('idle');
      }
    }

    // Schedule next tick
    this.scheduleNextTick();
  }

  /**
   * Schedule the next tick execution after the configured interval.
   */
  private scheduleNextTick(): void {
    if (!this.state.enabled || this.disposed) {
      return;
    }

    this.clearTickTimer();
    this.tickTimer = setTimeout(() => {
      void this.executeTick();
    }, this.state.tickIntervalMs);
  }

  /**
   * Check if a user message is pending or was recently sent.
   */
  private hasPendingUserMessage(): boolean {
    if (this.pendingUserMessage) {
      return true;
    }
    // Grace period: don't tick immediately after a user message
    if (this.lastUserMessageAt > 0) {
      const elapsed = Date.now() - this.lastUserMessageAt;
      if (elapsed < USER_MESSAGE_GRACE_MS) {
        return true;
      }
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  State Machine
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Transition the session state machine.
   *
   * Valid transitions:
   *   idle → running          (tick or user message starts processing)
   *   running → idle          (processing complete, no action required)
   *   running → requires_action  (model called AskUser or needs approval)
   *   requires_action → running   (user responded)
   *   requires_action → idle      (user cancelled / timeout)
   *   * → idle                (error recovery)
   */
  private transitionTo(newState: SessionState): void {
    const oldState = this.state.sessionState;

    // Validate transition
    const validTransitions: Record<SessionState, SessionState[]> = {
      idle: ['running'],
      running: ['idle', 'requires_action'],
      requires_action: ['running', 'idle'],
    };

    if (oldState !== newState && !validTransitions[oldState].includes(newState)) {
      mainWarn('SudoClawManager', `Invalid state transition: ${oldState} → ${newState}, forcing transition`);
    }

    if (oldState !== newState) {
      mainLog('SudoClawManager', `State transition: ${oldState} → ${newState}`);
    }

    this.state.sessionState = newState;
    this.persistState();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Persistence
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Persist current state to `conversation.extra.sudoClaw`.
   */
  private persistState(): void {
    try {
      const db = getDatabase();
      const convResult = db.getConversation(this.state.conversationId);
      if (!convResult.success || !convResult.data) {
        mainWarn('SudoClawManager', `Cannot persist state: conversation ${this.state.conversationId} not found`);
        return;
      }

      const updatedExtra = {
        ...(convResult.data.extra as Record<string, unknown>),
        sudoClaw: { ...this.state },
      };
      db.updateConversation(this.state.conversationId, { extra: updatedExtra } as any);
    } catch (err) {
      mainWarn('SudoClawManager', `Failed to persist state: ${err}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Timer management
  // ═══════════════════════════════════════════════════════════════════════════

  private clearTickTimer(): void {
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }
}
