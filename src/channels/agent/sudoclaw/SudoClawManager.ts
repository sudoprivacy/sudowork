/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ISudoClawAskUserRequest,
  ISudoClawPendingRequest,
  ISudoClawUserResponse,
  SudoClawSessionState,
} from './types';
import {
  SudoClawEvents,
  SUDOCLAW_DEFAULT_TIMEOUT_MS,
  SUDOCLAW_MAX_PENDING_REQUESTS,
} from './types';
import { channelEventBus } from '../ChannelEventBus';

/**
 * SudoClawManager — Core manager for the SudoClaw response system.
 *
 * Responsibilities:
 * 1. Manage session state machine (idle → running → waiting_for_user → running → completed)
 * 2. Track pending AskUser requests with Promise-based resolution
 * 3. Handle user responses from any channel via handleUserResponse()
 * 4. Manage timeouts for unanswered requests
 *
 * Architecture:
 * ```
 * Model calls AskUserTool
 *   → SudoClawManager.registerAskUserRequest(request)
 *   → Returns Promise<ISudoClawUserResponse> (blocks model)
 *   → Notification sent via NotifyService (from #212)
 *
 * User responds (any channel)
 *   → SudoClawBridge.routeResponse(response)
 *   → SudoClawManager.handleUserResponse(response)
 *   → pendingResolve(response)  // unblock the model
 *   → sessionState = 'running'
 *   → scheduleNextTick()
 * ```
 */
export class SudoClawManager {
  /**
   * Session states per conversation.
   */
  private sessionStates: Map<string, SudoClawSessionState> = new Map();

  /**
   * Pending AskUser requests: requestId → pending request.
   */
  private pendingRequests: Map<string, ISudoClawPendingRequest> = new Map();

  /**
   * Index: conversationId → Set<requestId> for fast lookup.
   */
  private conversationRequests: Map<string, Set<string>> = new Map();

  /**
   * Callback invoked after a response unblocks the model.
   * Typically calls scheduleNextTick() on the agent's tick loop.
   */
  private onResumeCallback: ((conversationId: string) => void) | null = null;

  /**
   * Set the callback for resuming the agent tick loop after a response.
   */
  setOnResume(callback: (conversationId: string) => void): void {
    this.onResumeCallback = callback;
  }

  // ==================== Session State ====================

  /**
   * Get session state for a conversation.
   */
  getSessionState(conversationId: string): SudoClawSessionState {
    return this.sessionStates.get(conversationId) || 'idle';
  }

  /**
   * Set session state and emit state change event.
   */
  private setSessionState(conversationId: string, newState: SudoClawSessionState, reason?: string): void {
    const previousState = this.getSessionState(conversationId);
    if (previousState === newState) return;

    this.sessionStates.set(conversationId, newState);
    console.log(`[SudoClawManager] State: ${previousState} → ${newState} (conv=${conversationId.slice(-8)})${reason ? ` reason=${reason}` : ''}`);

    channelEventBus.emit(SudoClawEvents.STATE_CHANGED, {
      conversationId,
      previousState,
      newState,
      reason,
    });
  }

  // ==================== AskUser Request Lifecycle ====================

  /**
   * Register an AskUser request from the model.
   *
   * Returns a Promise that resolves when the user responds.
   * The model is blocked (awaiting this Promise) until a response arrives or timeout occurs.
   *
   * @param request - The AskUser request from the model
   * @returns Promise that resolves with the user's response
   */
  async registerAskUserRequest(request: ISudoClawAskUserRequest): Promise<ISudoClawUserResponse> {
    const { requestId, conversationId, timeoutMs } = request;

    // Check pending request limit
    const existing = this.conversationRequests.get(conversationId);
    if (existing && existing.size >= SUDOCLAW_MAX_PENDING_REQUESTS) {
      throw new Error(`Too many pending requests for conversation ${conversationId}`);
    }

    // Transition state
    this.setSessionState(conversationId, 'waiting_for_user', `ask_user: ${request.question.slice(0, 50)}`);

    // Emit ask_user event for NotifyService / channels
    channelEventBus.emit(SudoClawEvents.ASK_USER, request);

    return new Promise<ISudoClawUserResponse>((resolve, reject) => {
      // Set up timeout
      const timeout = timeoutMs ?? SUDOCLAW_DEFAULT_TIMEOUT_MS;
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

      if (timeout > 0) {
        timeoutTimer = setTimeout(() => {
          this.handleRequestTimeout(requestId, conversationId);
        }, timeout);
      }

      // Register pending request
      const pending: ISudoClawPendingRequest = {
        request,
        resolve,
        reject,
        timeoutTimer,
        settled: false,
      };
      this.pendingRequests.set(requestId, pending);

      // Track by conversation
      if (!this.conversationRequests.has(conversationId)) {
        this.conversationRequests.set(conversationId, new Set());
      }
      this.conversationRequests.get(conversationId)!.add(requestId);

      console.log(`[SudoClawManager] Registered AskUser request: id=${requestId.slice(-8)}, conv=${conversationId.slice(-8)}, urgency=${request.urgency}, timeout=${timeout}ms`);
    });
  }

  /**
   * Handle a user response from any channel.
   *
   * This is the SINGLE entry point for all channel responses.
   * Resolves the pending Promise, unblocking the model, and resumes the tick loop.
   *
   * @param response - The user's response
   * @returns true if the response was routed successfully, false if no matching request
   */
  handleUserResponse(response: ISudoClawUserResponse): boolean {
    const { requestId, conversationId } = response;
    const pending = this.pendingRequests.get(requestId);

    if (!pending) {
      console.warn(`[SudoClawManager] No pending request found: id=${requestId}, conv=${conversationId.slice(-8)}`);
      return false;
    }

    if (pending.settled) {
      console.warn(`[SudoClawManager] Request already settled: id=${requestId}`);
      return false;
    }

    // Mark as settled
    pending.settled = true;

    // Clear timeout
    if (pending.timeoutTimer) {
      clearTimeout(pending.timeoutTimer);
    }

    // Clean up tracking
    this.pendingRequests.delete(requestId);
    const convRequests = this.conversationRequests.get(conversationId);
    if (convRequests) {
      convRequests.delete(requestId);
      if (convRequests.size === 0) {
        this.conversationRequests.delete(conversationId);
      }
    }

    console.log(`[SudoClawManager] User responded: id=${requestId.slice(-8)}, type=${response.type}, platform=${response.source.platform}`);

    // Emit response event
    channelEventBus.emit(SudoClawEvents.USER_RESPONSE, response);

    // Transition state back to running
    this.setSessionState(conversationId, 'running', `user_response: ${response.type}`);

    // Resolve the model's blocked Promise
    pending.resolve(response);

    // Resume agent tick loop
    if (this.onResumeCallback) {
      try {
        this.onResumeCallback(conversationId);
      } catch (error) {
        console.error(`[SudoClawManager] onResume callback failed:`, error);
      }
    }

    return true;
  }

  // ==================== Timeout Handling ====================

  /**
   * Handle a request timeout.
   */
  private handleRequestTimeout(requestId: string, conversationId: string): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending || pending.settled) return;

    pending.settled = true;
    this.pendingRequests.delete(requestId);
    const convRequests = this.conversationRequests.get(conversationId);
    if (convRequests) {
      convRequests.delete(requestId);
      if (convRequests.size === 0) {
        this.conversationRequests.delete(conversationId);
      }
    }

    console.warn(`[SudoClawManager] Request timed out: id=${requestId.slice(-8)}, conv=${conversationId.slice(-8)}`);

    // Emit timeout event
    channelEventBus.emit(SudoClawEvents.REQUEST_TIMEOUT, { requestId, conversationId });

    // Transition state
    this.setSessionState(conversationId, 'timed_out', 'request_timeout');

    // Resolve with a timeout response (not reject — let the model handle gracefully)
    const timeoutResponse: ISudoClawUserResponse = {
      requestId,
      conversationId,
      type: 'timeout',
      message: 'Request timed out — no user response received.',
      source: {
        platform: 'desktop',
        userId: 'system',
        displayName: 'System',
      },
      respondedAt: Date.now(),
    };
    pending.resolve(timeoutResponse);
  }

  // ==================== Query Methods ====================

  /**
   * Get all pending requests for a conversation.
   */
  getPendingRequests(conversationId: string): ISudoClawAskUserRequest[] {
    const requestIds = this.conversationRequests.get(conversationId);
    if (!requestIds) return [];

    const requests: ISudoClawAskUserRequest[] = [];
    for (const id of requestIds) {
      const pending = this.pendingRequests.get(id);
      if (pending && !pending.settled) {
        requests.push(pending.request);
      }
    }
    return requests;
  }

  /**
   * Get a specific pending request by ID.
   */
  getPendingRequest(requestId: string): ISudoClawAskUserRequest | null {
    const pending = this.pendingRequests.get(requestId);
    return pending && !pending.settled ? pending.request : null;
  }

  /**
   * Check if there are any pending requests for a conversation.
   */
  hasPendingRequests(conversationId: string): boolean {
    return this.getPendingRequests(conversationId).length > 0;
  }

  // ==================== Cleanup ====================

  /**
   * Cancel all pending requests for a conversation.
   * Used when a session is terminated or reset.
   */
  cancelAllRequests(conversationId: string, reason = 'session_cancelled'): void {
    const requestIds = this.conversationRequests.get(conversationId);
    if (!requestIds) return;

    for (const requestId of requestIds) {
      const pending = this.pendingRequests.get(requestId);
      if (pending && !pending.settled) {
        pending.settled = true;
        if (pending.timeoutTimer) {
          clearTimeout(pending.timeoutTimer);
        }
        pending.reject(new Error(`Request cancelled: ${reason}`));
        this.pendingRequests.delete(requestId);
      }
    }
    this.conversationRequests.delete(conversationId);
    this.setSessionState(conversationId, 'idle', reason);
  }

  /**
   * Shutdown the manager. Cancel all pending requests.
   */
  shutdown(): void {
    for (const [conversationId] of this.conversationRequests) {
      this.cancelAllRequests(conversationId, 'shutdown');
    }
    this.sessionStates.clear();
    this.onResumeCallback = null;
    console.log('[SudoClawManager] Shutdown complete');
  }
}

// ==================== Singleton ====================

let managerInstance: SudoClawManager | null = null;

export function getSudoClawManager(): SudoClawManager {
  if (!managerInstance) {
    managerInstance = new SudoClawManager();
  }
  return managerInstance;
}
