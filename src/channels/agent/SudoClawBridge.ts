/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PluginType } from '../types';
import type {
  ISudoClawAskUserRequest,
  ISudoClawUserResponse,
  SudoClawResponseType,
} from './sudoclaw/types';
import { SudoClawEvents } from './sudoclaw/types';
import { getSudoClawManager } from './sudoclaw/SudoClawManager';
import { channelEventBus } from './ChannelEventBus';

/**
 * SudoClawBridge — Response routing for all channels.
 *
 * This is the single entry point that funnels user responses from any channel
 * (Telegram, Lark, DingTalk, WebUI, Desktop) into SudoClawManager.handleUserResponse().
 *
 * Architecture:
 * ```
 * User responds (any channel)
 *   → SudoClawBridge.routeResponse(response)
 *   → SudoClawManager.handleUserResponse(response)
 *     → pendingResolve(response)    // unblock the model's AskUser Promise
 *     → sessionState = 'running'
 *     → scheduleNextTick()
 * ```
 *
 * Channel-specific helpers build the unified ISudoClawUserResponse from
 * platform-native callback data (button clicks, card actions, text replies).
 */
class SudoClawBridge {
  private initialized = false;
  private eventCleanup: (() => void) | null = null;

  /**
   * Listeners registered for ask_user events (notification senders).
   * Each channel plugin registers a listener to push interactive messages.
   */
  private askUserListeners: Array<(request: ISudoClawAskUserRequest) => void> = [];

  /**
   * Initialize the bridge. Sets up event listeners.
   */
  initialize(): void {
    if (this.initialized) return;

    // Listen for ASK_USER events from SudoClawManager
    // and forward to registered channel listeners
    const handler = (request: ISudoClawAskUserRequest) => {
      this.onAskUser(request);
    };
    channelEventBus.on(SudoClawEvents.ASK_USER, handler);
    this.eventCleanup = () => {
      channelEventBus.off(SudoClawEvents.ASK_USER, handler);
    };

    this.initialized = true;
    console.log('[SudoClawBridge] Initialized');
  }

  // ==================== Response Routing ====================

  /**
   * Route a user response from any channel to SudoClawManager.
   *
   * This is the SINGLE funnel point. All channel-specific response handlers
   * must call this method with a unified ISudoClawUserResponse.
   *
   * @param response - The unified user response
   * @returns true if the response was accepted, false if no matching pending request
   */
  routeResponse(response: ISudoClawUserResponse): boolean {
    console.log(`[SudoClawBridge] Routing response: requestId=${response.requestId.slice(-8)}, type=${response.type}, platform=${response.source.platform}`);
    return getSudoClawManager().handleUserResponse(response);
  }

  // ==================== Channel-Specific Response Builders ====================

  /**
   * Build and route a response from a Telegram inline keyboard button.
   *
   * @param requestId - Original request ID (from callback_data)
   * @param conversationId - Conversation ID
   * @param responseType - 'approve' | 'deny' | 'reply'
   * @param userId - Telegram user ID
   * @param displayName - Telegram display name
   * @param message - Optional text reply
   */
  routeTelegramResponse(
    requestId: string,
    conversationId: string,
    responseType: SudoClawResponseType,
    userId: string,
    displayName?: string,
    message?: string
  ): boolean {
    return this.routeResponse({
      requestId,
      conversationId,
      type: responseType,
      message,
      source: {
        platform: 'telegram' as PluginType,
        userId,
        displayName,
      },
      respondedAt: Date.now(),
    });
  }

  /**
   * Build and route a response from a Lark interactive card action.
   *
   * @param requestId - Original request ID (from card button value)
   * @param conversationId - Conversation ID
   * @param responseType - 'approve' | 'deny' | 'reply'
   * @param userId - Lark user ID (open_id)
   * @param displayName - Lark display name
   * @param message - Optional text reply
   */
  routeLarkResponse(
    requestId: string,
    conversationId: string,
    responseType: SudoClawResponseType,
    userId: string,
    displayName?: string,
    message?: string
  ): boolean {
    return this.routeResponse({
      requestId,
      conversationId,
      type: responseType,
      message,
      source: {
        platform: 'lark' as PluginType,
        userId,
        displayName,
      },
      respondedAt: Date.now(),
    });
  }

  /**
   * Build and route a response from a DingTalk interactive card action.
   *
   * @param requestId - Original request ID (from card button params)
   * @param conversationId - Conversation ID
   * @param responseType - 'approve' | 'deny' | 'reply'
   * @param userId - DingTalk staff ID
   * @param displayName - DingTalk display name
   * @param message - Optional text reply
   */
  routeDingTalkResponse(
    requestId: string,
    conversationId: string,
    responseType: SudoClawResponseType,
    userId: string,
    displayName?: string,
    message?: string
  ): boolean {
    return this.routeResponse({
      requestId,
      conversationId,
      type: responseType,
      message,
      source: {
        platform: 'dingtalk' as PluginType,
        userId,
        displayName,
      },
      respondedAt: Date.now(),
    });
  }

  /**
   * Build and route a response from the WebUI inline reply box.
   *
   * @param requestId - Original request ID
   * @param conversationId - Conversation ID
   * @param responseType - 'approve' | 'deny' | 'reply'
   * @param userId - WebUI user ID
   * @param displayName - Display name
   * @param message - Optional text reply
   */
  routeWebUIResponse(
    requestId: string,
    conversationId: string,
    responseType: SudoClawResponseType,
    userId: string,
    displayName?: string,
    message?: string
  ): boolean {
    return this.routeResponse({
      requestId,
      conversationId,
      type: responseType,
      message,
      source: {
        platform: 'webui',
        userId,
        displayName,
      },
      respondedAt: Date.now(),
    });
  }

  /**
   * Build and route a response from a Desktop (Electron) notification action.
   *
   * @param requestId - Original request ID
   * @param conversationId - Conversation ID
   * @param responseType - 'approve' | 'deny'
   * @param userId - Local user ID
   * @param displayName - Display name
   */
  routeDesktopResponse(
    requestId: string,
    conversationId: string,
    responseType: SudoClawResponseType,
    userId: string,
    displayName?: string
  ): boolean {
    return this.routeResponse({
      requestId,
      conversationId,
      type: responseType,
      source: {
        platform: 'desktop',
        userId,
        displayName,
      },
      respondedAt: Date.now(),
    });
  }

  // ==================== AskUser Event Distribution ====================

  /**
   * Register a listener for AskUser events.
   * Channel plugins call this to receive notifications when the model
   * needs user input, so they can push interactive messages.
   *
   * @param listener - Callback invoked with the AskUser request
   * @returns Unsubscribe function
   */
  onAskUser(request: ISudoClawAskUserRequest): void {
    for (const listener of this.askUserListeners) {
      try {
        listener(request);
      } catch (error) {
        console.error('[SudoClawBridge] AskUser listener error:', error);
      }
    }
  }

  /**
   * Register a listener for AskUser events.
   * @returns Unsubscribe function
   */
  registerAskUserListener(listener: (request: ISudoClawAskUserRequest) => void): () => void {
    this.askUserListeners.push(listener);
    return () => {
      const idx = this.askUserListeners.indexOf(listener);
      if (idx >= 0) this.askUserListeners.splice(idx, 1);
    };
  }

  // ==================== Cleanup ====================

  /**
   * Shutdown the bridge.
   */
  shutdown(): void {
    if (this.eventCleanup) {
      this.eventCleanup();
      this.eventCleanup = null;
    }
    this.askUserListeners = [];
    this.initialized = false;
    console.log('[SudoClawBridge] Shutdown complete');
  }
}

// ==================== Singleton ====================

let bridgeInstance: SudoClawBridge | null = null;

export function getSudoClawBridge(): SudoClawBridge {
  if (!bridgeInstance) {
    bridgeInstance = new SudoClawBridge();
  }
  return bridgeInstance;
}
