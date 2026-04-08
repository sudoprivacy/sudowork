/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SudoClawManager — Session state machine for autonomous agent sessions
 *
 * Bridges the existing tool confirmation system (AcpApprovalStore / BaseAgent)
 * with SudoClaw's state machine. When the model invokes a tool that requires
 * user approval, SudoClawManager detects the approval-pending event, transitions
 * to `requires_action` state, pauses the tick loop, and notifies all channels.
 *
 * State transitions:
 *   idle → running → requires_action → running → idle
 *                  → idle (on finish)
 *
 * @see docs/sudoclaw-mvp-plan.md Section 1.5 (AcpApprovalStore integration)
 */

import { channelEventBus } from '@/channels/agent/ChannelEventBus';
import type { IApprovalPendingEvent, IApprovalResolvedEvent } from '@/channels/agent/ChannelEventBus';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';

/**
 * Session states for the SudoClaw autonomous agent
 */
export type SudoClawSessionState = 'idle' | 'running' | 'requires_action' | 'error';

/**
 * Notification urgency levels
 */
export type NotificationUrgency = 'info' | 'action_needed' | 'error';

/**
 * SudoClaw notification payload emitted via channelEventBus
 */
export type SudoClawNotification = {
  conversationId: string;
  sessionState: SudoClawSessionState;
  urgency: NotificationUrgency;
  toolName?: string;
  description?: string;
  pendingQuestion?: string;
  timestamp: number;
};

/**
 * SudoClaw session state snapshot
 */
export type SudoClawState = {
  conversationId: string;
  sessionState: SudoClawSessionState;
  pendingQuestion: string | null;
  pendingRequestId: string | null;
  pendingCallId: string | null;
  lastActivityAt: number;
  approvalTimeoutMs: number;
};

/**
 * Configuration options for SudoClawManager
 */
export type SudoClawManagerOptions = {
  /** Conversation ID this manager is bound to */
  conversationId: string;
  /** Tick interval in milliseconds (default: 5000) */
  tickIntervalMs?: number;
  /** Auto-deny timeout for pending approvals in milliseconds (default: 120000 = 2 min) */
  approvalTimeoutMs?: number;
  /** Callback invoked on each tick cycle */
  onTick?: () => void | Promise<void>;
};

/** Event name for SudoClaw notifications on channelEventBus */
export const SUDOCLAW_NOTIFICATION_EVENT = 'sudoclaw-notification';

/**
 * SudoClawManager — manages the session state machine for a single
 * autonomous agent conversation. Subscribes to approval events from
 * channelEventBus and transitions state accordingly.
 */
export class SudoClawManager {
  private state: SudoClawState;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private approvalTimer: ReturnType<typeof setTimeout> | null = null;
  private tickIntervalMs: number;
  private onTick: (() => void | Promise<void>) | undefined;
  private disposed = false;

  /** Unsubscribe functions for event listeners */
  private unsubApprovalPending: (() => void) | null = null;
  private unsubApprovalResolved: (() => void) | null = null;

  constructor(options: SudoClawManagerOptions) {
    const { conversationId, tickIntervalMs = 5000, approvalTimeoutMs = 120_000, onTick } = options;

    this.tickIntervalMs = tickIntervalMs;
    this.onTick = onTick;

    this.state = {
      conversationId,
      sessionState: 'idle',
      pendingQuestion: null,
      pendingRequestId: null,
      pendingCallId: null,
      lastActivityAt: Date.now(),
      approvalTimeoutMs,
    };

    this.subscribeToApprovalEvents();
    mainLog('SudoClawManager', `Initialized for conversation ${conversationId}`);
  }

  // ========== Public API ==========

  /**
   * Get current session state snapshot (immutable copy)
   */
  getState(): Readonly<SudoClawState> {
    return { ...this.state };
  }

  /**
   * Start the tick loop — transitions from idle to running
   */
  start(): void {
    if (this.disposed) {
      mainWarn('SudoClawManager', 'Cannot start: manager is disposed');
      return;
    }

    if (this.state.sessionState !== 'idle') {
      mainWarn('SudoClawManager', `Cannot start: session is in ${this.state.sessionState} state`);
      return;
    }

    this.transitionTo('running');
    this.scheduleTick();
    mainLog('SudoClawManager', `Session started for ${this.state.conversationId}`);
  }

  /**
   * Stop the session — transitions to idle, clears all timers
   */
  stop(): void {
    this.clearTickTimer();
    this.clearApprovalTimer();
    this.transitionTo('idle');
    this.state.pendingQuestion = null;
    this.state.pendingRequestId = null;
    this.state.pendingCallId = null;
    mainLog('SudoClawManager', `Session stopped for ${this.state.conversationId}`);
  }

  /**
   * Dispose the manager — unsubscribe from all events and clear timers
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.stop();

    if (this.unsubApprovalPending) {
      this.unsubApprovalPending();
      this.unsubApprovalPending = null;
    }
    if (this.unsubApprovalResolved) {
      this.unsubApprovalResolved();
      this.unsubApprovalResolved = null;
    }

    mainLog('SudoClawManager', `Disposed for ${this.state.conversationId}`);
  }

  // ========== Event Subscriptions ==========

  /**
   * Subscribe to approval lifecycle events from channelEventBus
   */
  private subscribeToApprovalEvents(): void {
    this.unsubApprovalPending = channelEventBus.onApprovalPending((event: IApprovalPendingEvent) => {
      this.handleApprovalPending(event);
    });

    this.unsubApprovalResolved = channelEventBus.onApprovalResolved((event: IApprovalResolvedEvent) => {
      this.handleApprovalResolved(event);
    });
  }

  /**
   * Handle approval-pending: transition to requires_action, pause tick, notify
   */
  private handleApprovalPending(event: IApprovalPendingEvent): void {
    // Only handle events for our conversation
    if (event.conversationId !== this.state.conversationId) return;

    // Only transition if we're currently running
    if (this.state.sessionState !== 'running') {
      mainWarn('SudoClawManager', `Ignoring approval-pending in ${this.state.sessionState} state`);
      return;
    }

    mainLog('SudoClawManager', `Approval pending: tool=${event.toolName}, request=${event.requestId}`);

    // Update state
    this.state.pendingQuestion = `Approve tool: ${event.toolName}?\n${event.description}`;
    this.state.pendingRequestId = event.requestId;
    this.state.pendingCallId = event.callId;
    this.state.lastActivityAt = Date.now();

    // Transition to requires_action and pause tick loop
    this.transitionTo('requires_action');
    this.clearTickTimer();

    // Start approval timeout timer
    this.startApprovalTimeout();

    // Notify all channels
    this.emitNotification({
      conversationId: this.state.conversationId,
      sessionState: 'requires_action',
      urgency: 'action_needed',
      toolName: event.toolName,
      description: event.description,
      pendingQuestion: this.state.pendingQuestion,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle approval-resolved: transition back to running, resume tick
   */
  private handleApprovalResolved(event: IApprovalResolvedEvent): void {
    // Only handle events for our conversation
    if (event.conversationId !== this.state.conversationId) return;

    // Only transition if we're currently in requires_action
    if (this.state.sessionState !== 'requires_action') {
      mainWarn('SudoClawManager', `Ignoring approval-resolved in ${this.state.sessionState} state`);
      return;
    }

    mainLog('SudoClawManager', `Approval resolved: callId=${event.callId}, option=${event.optionId}`);

    // Clear approval timeout
    this.clearApprovalTimer();

    // Clear pending state
    this.state.pendingQuestion = null;
    this.state.pendingRequestId = null;
    this.state.pendingCallId = null;
    this.state.lastActivityAt = Date.now();

    // Transition back to running and resume tick loop
    this.transitionTo('running');
    this.scheduleTick();

    // Notify channels of resumed state
    this.emitNotification({
      conversationId: this.state.conversationId,
      sessionState: 'running',
      urgency: 'info',
      timestamp: Date.now(),
    });
  }

  // ========== Tick Loop ==========

  /**
   * Schedule the next tick
   */
  private scheduleTick(): void {
    if (this.disposed || this.state.sessionState !== 'running') return;

    this.clearTickTimer();
    this.tickTimer = setTimeout(() => {
      void this.executeTick();
    }, this.tickIntervalMs);
  }

  /**
   * Execute one tick cycle
   */
  private async executeTick(): Promise<void> {
    if (this.disposed || this.state.sessionState !== 'running') return;

    try {
      this.state.lastActivityAt = Date.now();
      if (this.onTick) {
        await this.onTick();
      }
    } catch (err) {
      mainError('SudoClawManager', 'Tick error:', err);
      this.transitionTo('error');
      this.emitNotification({
        conversationId: this.state.conversationId,
        sessionState: 'error',
        urgency: 'error',
        description: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      });
      return;
    }

    // Schedule next tick if still running
    this.scheduleTick();
  }

  // ========== Approval Timeout ==========

  /**
   * Start a timer that auto-denies the pending approval after the configured timeout
   */
  private startApprovalTimeout(): void {
    this.clearApprovalTimer();

    this.approvalTimer = setTimeout(() => {
      if (this.state.sessionState !== 'requires_action') return;

      mainWarn('SudoClawManager', `Approval timed out after ${this.state.approvalTimeoutMs}ms for request=${this.state.pendingRequestId}`);

      // Emit a timeout notification before clearing state
      this.emitNotification({
        conversationId: this.state.conversationId,
        sessionState: 'requires_action',
        urgency: 'error',
        description: `Approval timed out after ${this.state.approvalTimeoutMs / 1000}s — auto-denied`,
        toolName: this.state.pendingQuestion?.split('\n')[0]?.replace('Approve tool: ', '').replace('?', '') ?? undefined,
        timestamp: Date.now(),
      });

      // Clear pending state and transition back to running
      this.state.pendingQuestion = null;
      this.state.pendingRequestId = null;
      this.state.pendingCallId = null;
      this.state.lastActivityAt = Date.now();

      this.transitionTo('running');
      this.scheduleTick();
    }, this.state.approvalTimeoutMs);
  }

  // ========== Internal Helpers ==========

  /**
   * Transition to a new session state
   */
  private transitionTo(newState: SudoClawSessionState): void {
    const oldState = this.state.sessionState;
    if (oldState === newState) return;

    mainLog('SudoClawManager', `State: ${oldState} → ${newState} (conversation=${this.state.conversationId})`);
    this.state.sessionState = newState;
  }

  /**
   * Emit a notification via channelEventBus
   */
  private emitNotification(notification: SudoClawNotification): void {
    channelEventBus.emit(SUDOCLAW_NOTIFICATION_EVENT, notification);
  }

  /**
   * Clear the tick timer
   */
  private clearTickTimer(): void {
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /**
   * Clear the approval timeout timer
   */
  private clearApprovalTimer(): void {
    if (this.approvalTimer) {
      clearTimeout(this.approvalTimer);
      this.approvalTimer = null;
    }
  }
}
