/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SudoClaw Tools — Shared Types
 *
 * Defines the contract between SudoClaw tools and the SudoClawManager.
 * Tools depend on ISudoClawManager; the concrete implementation lives
 * in the manager module (see #221).
 */

// ---------------------------------------------------------------------------
// Session state machine
// ---------------------------------------------------------------------------

/** Possible states for a SudoClaw persistent session. */
export type SudoClawSessionState = 'idle' | 'running' | 'sleeping' | 'requires_action' | 'stopped';

// ---------------------------------------------------------------------------
// Notification urgency
// ---------------------------------------------------------------------------

/** Urgency levels for proactive notifications emitted by NotifyTool. */
export type NotificationUrgency = 'info' | 'action_needed' | 'completed';

// ---------------------------------------------------------------------------
// SudoClaw notification event payload
// ---------------------------------------------------------------------------

/** Payload emitted on the ChannelEventBus for sudoclaw notifications. */
export type SudoClawNotificationPayload = {
  conversationId: string;
  message: string;
  urgency: NotificationUrgency;
  timestamp: string;
};

// ---------------------------------------------------------------------------
// Manager interface (tools depend on this — implemented by SudoClawManager)
// ---------------------------------------------------------------------------

/**
 * Minimal interface that SudoClaw tools require from the manager.
 *
 * The concrete SudoClawManager (issue #221) must satisfy this contract.
 * Keeping it as an interface allows the tools to be developed, tested, and
 * reviewed independently of the manager implementation.
 */
export type ISudoClawManager = {
  /** The conversation this manager is bound to. */
  readonly conversationId: string;

  /**
   * Pause the tick loop for `durationMs` milliseconds.
   * Resolves when the sleep expires **or** the session is woken early.
   */
  sleep: (durationMs: number) => Promise<void>;

  /**
   * Transition the session to a new state.
   * Throws if the transition is invalid for the current state.
   */
  transitionState: (newState: SudoClawSessionState) => void;

  /**
   * Store a pending resolve callback that will be called when the user
   * responds via `handleUserResponse()`.
   *
   * Used by AskUserTool to implement blocking question flow.
   */
  setPendingResolve: (resolve: (response: string) => void) => void;
};

// ---------------------------------------------------------------------------
// Tool input / output schemas
// ---------------------------------------------------------------------------

/** Input for SleepTool. */
export type SleepToolInput = {
  /** Duration in minutes (1-60). */
  duration_minutes: number;
  /** Human-readable reason for sleeping. */
  reason: string;
};

/** Result returned by SleepTool. */
export type SleepToolResult = {
  status: 'sleeping';
  wake_at: string; // ISO 8601 timestamp
};

/** Input for NotifyTool. */
export type NotifyToolInput = {
  /** Markdown-formatted message to send. */
  message: string;
  /** Urgency level of the notification. */
  urgency: NotificationUrgency;
};

/** Result returned by NotifyTool. */
export type NotifyToolResult = {
  status: 'notified';
  timestamp: string; // ISO 8601 timestamp
};

/** Input for AskUserTool. */
export type AskUserToolInput = {
  /** The question to ask the user. */
  question: string;
  /** Optional context to help the user understand the question. */
  context?: string;
};

/** Result returned by AskUserTool. */
export type AskUserToolResult = {
  status: 'answered';
  response: string;
};

// ---------------------------------------------------------------------------
// Generic tool definition
// ---------------------------------------------------------------------------

/** JSON-Schema-style parameter definition for a single tool. */
export type SudoClawToolSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
};

/**
 * Base definition for a SudoClaw tool that the model can invoke.
 *
 * Each tool is a plain object with metadata + an async `execute` function.
 * The agent runtime calls `execute` with the validated input and awaits
 * the result (NotifyTool resolves immediately; AskUserTool blocks until
 * the user responds; SleepTool blocks until the sleep expires or is
 * interrupted).
 */
export type SudoClawTool<TInput, TResult> = {
  /** Unique tool name (used in the model's function-calling interface). */
  name: string;
  /** Short description shown to the model. */
  description: string;
  /** JSON Schema describing the expected input. */
  schema: SudoClawToolSchema;
  /** Execute the tool. May block (AskUser, Sleep) or return immediately (Notify). */
  execute: (input: TInput, manager: ISudoClawManager) => Promise<TResult>;
};
