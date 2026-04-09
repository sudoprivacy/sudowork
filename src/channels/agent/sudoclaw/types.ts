/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PluginType } from '../../types';

// ==================== Session State Machine ====================

/**
 * SudoClaw session states.
 *
 * State transitions:
 * ```
 * idle → running → waiting_for_user → running → ... → completed
 *                       ↓                                    ↑
 *                   timed_out ──────────────────────────────→
 *                       ↓
 *                     error ──────────────────────────────→
 * ```
 */
export type SudoClawSessionState = 'idle' | 'running' | 'waiting_for_user' | 'completed' | 'timed_out' | 'error';

// ==================== AskUser Types ====================

/**
 * Urgency levels for AskUser tool invocations.
 * Determines notification channel priority.
 */
export type AskUserUrgency = 'info' | 'action_needed' | 'critical';

/**
 * AskUser request from the model.
 * Emitted when the model calls AskUserTool and needs user input.
 */
export interface ISudoClawAskUserRequest {
  /** Unique request ID for correlation */
  requestId: string;
  /** Conversation ID the request belongs to */
  conversationId: string;
  /** Question or prompt for the user */
  question: string;
  /** Urgency level determines notification behavior */
  urgency: AskUserUrgency;
  /** Suggested response options (if any) */
  suggestedActions?: ISudoClawResponseOption[];
  /** Additional context for the request */
  context?: {
    /** Tool name that triggered the ask */
    toolName?: string;
    /** Short description of what needs approval */
    summary?: string;
    /** Detailed information */
    details?: string;
  };
  /** Timestamp when the request was created */
  createdAt: number;
  /** Timeout in milliseconds (0 = no timeout) */
  timeoutMs?: number;
}

/**
 * Predefined response option for AskUser requests.
 */
export interface ISudoClawResponseOption {
  /** Display label for the option */
  label: string;
  /** Value sent back when selected */
  value: string;
  /** Visual style hint */
  style?: 'primary' | 'default' | 'danger';
}

// ==================== User Response Types ====================

/**
 * Response type indicates how the user responded.
 */
export type SudoClawResponseType = 'approve' | 'deny' | 'reply' | 'timeout';

/**
 * User response to an AskUser request.
 * This is the unified response format from any channel.
 */
export interface ISudoClawUserResponse {
  /** Correlates to the original requestId */
  requestId: string;
  /** Conversation ID */
  conversationId: string;
  /** How the user responded */
  type: SudoClawResponseType;
  /** Free-text reply (for 'reply' type) */
  message?: string;
  /** Selected option value (for 'approve' / 'deny' with options) */
  value?: string;
  /** Source channel information */
  source: {
    /** Platform the response came from */
    platform: PluginType | 'webui' | 'desktop';
    /** User ID on the platform */
    userId: string;
    /** Display name */
    displayName?: string;
  };
  /** Timestamp when the response was created */
  respondedAt: number;
}

// ==================== Pending Request Tracking ====================

/**
 * Internal tracking for a pending AskUser request.
 * Holds the Promise resolve/reject so handleUserResponse() can unblock the model.
 */
export interface ISudoClawPendingRequest {
  /** The original ask-user request */
  request: ISudoClawAskUserRequest;
  /** Resolves the model's AskUser Promise */
  resolve: (response: ISudoClawUserResponse) => void;
  /** Rejects the model's AskUser Promise (timeout, error) */
  reject: (error: Error) => void;
  /** Timeout timer handle */
  timeoutTimer?: ReturnType<typeof setTimeout>;
  /** Whether this request has been resolved/rejected */
  settled: boolean;
}

// ==================== Event Types ====================

/**
 * SudoClaw event types for the ChannelEventBus.
 */
export const SudoClawEvents = {
  /** Model requests user input */
  ASK_USER: 'sudoclaw.ask_user',
  /** User responds to an ask */
  USER_RESPONSE: 'sudoclaw.user_response',
  /** Session state changed */
  STATE_CHANGED: 'sudoclaw.state_changed',
  /** Request timed out */
  REQUEST_TIMEOUT: 'sudoclaw.request_timeout',
} as const;

/**
 * State change event data
 */
export interface ISudoClawStateChangeEvent {
  conversationId: string;
  previousState: SudoClawSessionState;
  newState: SudoClawSessionState;
  reason?: string;
}

// ==================== Default Configuration ====================

/** Default timeout for AskUser requests (5 minutes) */
export const SUDOCLAW_DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/** Maximum number of pending requests per conversation */
export const SUDOCLAW_MAX_PENDING_REQUESTS = 10;
