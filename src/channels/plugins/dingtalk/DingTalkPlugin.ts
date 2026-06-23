/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { DWClient, TOPIC_ROBOT, TOPIC_CARD, EventAck } from 'dingtalk-stream';
import type { DWClientDownStream } from 'dingtalk-stream';

import { mainLog, mainWarn, mainError } from '@/process/utils/mainLogger';
import type { BotInfo, IChannelPluginConfig, IUnifiedOutgoingMessage, PluginType } from '../../types';
import { BasePlugin } from '../BasePlugin';
import { DINGTALK_MESSAGE_LIMIT, encodeChatId, extractCardAction, parseChatId, toDingTalkSendParams, toUnifiedIncomingMessage, getDefaultExtension, extractMediaDownloadInfo, setMediaLocalPath, getUploadMediaType, getDingTalkFileType } from './DingTalkAdapter';
import type { DingTalkStreamMessage } from './DingTalkAdapter';

/**
 * DingTalkPlugin - DingTalk Bot integration for Personal Assistant
 *
 * Uses dingtalk-stream SDK for WebSocket Stream connection.
 * Supports AI Card streaming for real-time response updates.
 * Falls back to sessionWebhook for plain markdown messages.
 */

// Event deduplication settings
const EVENT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const EVENT_CACHE_CLEANUP_INTERVAL = 60 * 1000; // 1 minute

// Reconnection settings
const RECONNECT_INITIAL_DELAY = 1000; // 1 second
const RECONNECT_MAX_DELAY = 60 * 1000; // 60 seconds
const RECONNECT_BACKOFF_FACTOR = 2;
const HEALTH_CHECK_INTERVAL = 30 * 1000; // 30 seconds

// DingTalk API base URL (new version)
const DINGTALK_API_BASE = 'https://api.dingtalk.com';

// Local image extensions that need to be extracted from markdown text and sent separately
const LOCAL_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

// AI Card template ID (DingTalk built-in streaming card)
const AI_CARD_TEMPLATE_ID = '382e4302-551d-4880-bf29-a30acfab2e71.schema';

// AI Card flow status values
const AICardStatus = {
  PROCESSING: '1',
  INPUTING: '2',
  FINISHED: '3',
  FAILED: '5',
} as const;

/**
 * Token cache structure
 */
interface ITokenCache {
  accessToken: string;
  expiresAt: number;
}

/**
 * AI Card session tracking
 */
interface IAICardSession {
  outTrackId: string;
  openSpaceId: string;
  isFinished: boolean;
  inputingStarted: boolean;
  /** Last full content pushed via streamAICard; used to finishAICard older cards verbatim. */
  lastContent: string;
}

export class DingTalkPlugin extends BasePlugin {
  readonly type: PluginType = 'dingtalk';

  private client: DWClient | null = null;
  private isConnected: boolean = false;

  // Credentials
  private clientId: string = '';
  private clientSecret: string = '';

  // Token management
  private tokenCache: ITokenCache | null = null;

  // Track active users for status reporting
  private activeUsers: Set<string> = new Set();

  // Event deduplication
  private processedEvents: Map<string, number> = new Map();
  private eventCleanupTimer: ReturnType<typeof setInterval> | null = null;

  // AI Card sessions: messageId -> card session
  private aiCardSessions: Map<string, IAICardSession> = new Map();

  // Store sessionWebhook per chatId for fallback sending
  private webhookCache: Map<string, string> = new Map();

  // Reconnection state
  private shouldReconnect: boolean = false;
  private reconnectDelay: number = RECONNECT_INITIAL_DELAY;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  // Local directory for downloaded media files (lazy-initialized)
  private mediaDir: string | null = null;

  /**
   * Initialize the DingTalk client
   */
  protected async onInitialize(config: IChannelPluginConfig): Promise<void> {
    const clientId = config.credentials?.clientId;
    const clientSecret = config.credentials?.clientSecret;

    if (!clientId || !clientSecret) {
      throw new Error('DingTalk Client ID and Client Secret are required');
    }

    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  /**
   * Create DWClient instance and register callbacks.
   * Extracted from onStart() for reuse during reconnection.
   */
  private async createClient(): Promise<void> {
    // Use `as any` to bypass SDK type declaration deficiency: the DWClient constructor's
    // TypeScript signature (client.d.ts:62-68) does not include autoReconnect, but the
    // runtime merges it via {...defaultConfig, ...opts} (client.mjs:41-44).
    // Must explicitly disable autoReconnect: otherwise the SDK's auto-reconnect (1s delay)
    // fires before our health check (30s), causing heartbeat interval leaks
    // (close handler doesn't clear old interval, client.mjs:166-176).
    this.client = new DWClient({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      keepAlive: true,
      autoReconnect: false,
      debug: false,
    } as any);

    // Register robot message listener (TOPIC_ROBOT uses CALLBACK type in Stream protocol)
    this.client.registerCallbackListener(TOPIC_ROBOT, (msg: DWClientDownStream) => {
      // Immediately acknowledge the message to prevent retry
      this.client?.socketCallBackResponse(msg.headers.messageId, EventAck.SUCCESS);

      // Process message asynchronously
      try {
        const data: DingTalkStreamMessage = JSON.parse(msg.data);
        void this.handleRobotMessage(data, msg.headers.messageId).catch((error) => {
          mainError('DingTalkPlugin', 'Error handling robot message', error);
        });
      } catch (error) {
        mainError('DingTalkPlugin', 'Failed to parse robot message', error);
      }
    });

    // Register card callback listener
    this.client.registerCallbackListener(TOPIC_CARD, (msg: DWClientDownStream) => {
      // Acknowledge card callback
      this.client?.socketCallBackResponse(msg.headers.messageId, EventAck.SUCCESS);

      // Process card action asynchronously
      try {
        const data = JSON.parse(msg.data);
        void this.handleCardCallback(data, msg.headers.messageId).catch((error) => {
          mainError('DingTalkPlugin', 'Error handling card callback', error);
        });
      } catch (error) {
        mainError('DingTalkPlugin', 'Failed to parse card callback', error);
      }
    });

    await this.client.connect();
  }

  /**
   * Start WebSocket Stream connection
   */
  protected async onStart(): Promise<void> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Credentials not available');
    }

    try {
      await this.refreshAccessToken();
      this.shouldReconnect = true;
      await this.createClient();
      this.isConnected = true;
      this.startEventCleanup();
      this.startHealthCheck();
      mainLog('DingTalkPlugin', `Started for client ${this.clientId}`);
    } catch (error) {
      mainError('DingTalkPlugin', 'Failed to start', error);
      throw error;
    }
  }

  /**
   * Stop connection and cleanup
   */
  protected async onStop(): Promise<void> {
    this.shouldReconnect = false;
    this.stopHealthCheck();
    this.stopReconnect();
    this.stopEventCleanup();

    if (this.client) {
      try {
        this.client.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.client = null;
    }

    this.tokenCache = null;
    this.activeUsers.clear();
    this.processedEvents.clear();
    this.aiCardSessions.clear();
    this.webhookCache.clear();
    this.isConnected = false;

    mainLog('DingTalkPlugin', 'Stopped and cleaned up');
  }

  // ==================== Reconnection ====================

  /**
   * Reconnect to DingTalk Stream with a fresh DWClient instance.
   * Destroys the old instance (clearing its heartbeat interval),
   * refreshes the access token, then creates a new connection.
   */
  private async reconnect(): Promise<void> {
    // Defensively stop health check to prevent timer leaks from any future call path
    this.stopHealthCheck();

    // Guard: if connection is already alive, skip reconnect.
    // Prevents resume() and health check from triggering a double reconnect
    // that would kill the first one's newly established connection.
    if (this.client && this.client.connected) {
      this.isConnected = true;
      this.reconnectDelay = RECONNECT_INITIAL_DELAY;
      this.startHealthCheck();
      return;
    }

    // 1. Destroy old instance (disconnect clears heartbeat interval)
    if (this.client) {
      try {
        this.client.disconnect();
      } catch {
        console.log('e');
      }
      this.client = null;
    }

    this.isConnected = false;

    // 2. Refresh token
    await this.refreshAccessToken();

    // 3. Create fresh DWClient instance and connect
    await this.createClient();

    // 4. Update state and restart health check
    this.isConnected = true;
    this.reconnectDelay = RECONNECT_INITIAL_DELAY;
    this.startHealthCheck();
    mainLog('DingTalkPlugin', 'Reconnected successfully');
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    this.stopReconnect();

    mainLog('DingTalkPlugin', `Reconnecting in ${this.reconnectDelay / 1000}s...`);

    this.reconnectTimer = setTimeout(() => {
      void this.reconnect()
        .then(() => {
          this.setStatus('running');
        })
        .catch((error) => {
          mainError('DingTalkPlugin', 'Reconnection failed:', error);
          this.reconnectDelay = Math.min(this.reconnectDelay * RECONNECT_BACKOFF_FACTOR, RECONNECT_MAX_DELAY);
          this.scheduleReconnect();
        });
    }, this.reconnectDelay);
  }

  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ==================== Health Check ====================

  /**
   * Periodically check SDK connection state via the connected flag.
   * SDK sets client.connected=false on WebSocket close and on SYSTEM "disconnect"
   * (which can occur without closing the WebSocket). The keepAlive ping/pong
   * heartbeat (8s interval) also triggers terminate() on timeout, which sets
   * connected=false via the close event.
   */
  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.healthCheckTimer = setInterval(() => {
      if (this.shouldReconnect && this.client) {
        if (!this.client.connected) {
          mainWarn('DingTalkPlugin', 'Connection lost detected by health check', {
            connected: this.client.connected,
          });
          this.isConnected = false;
          this.scheduleReconnect();
          this.stopHealthCheck();
        }
      }
    }, HEALTH_CHECK_INTERVAL);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  // ==================== System Resume ====================

  /**
   * Resume connection after system wake from sleep.
   * Called by ChannelManager.resumePlugins() from powerMonitor.on('resume').
   */
  async resume(): Promise<void> {
    if (!this.shouldReconnect || !this.client) return;

    // Check if connection has died
    if (!this.client.connected) {
      mainLog('DingTalkPlugin', 'System resume: connection lost, triggering reconnect');
      this.isConnected = false;
      this.reconnectDelay = RECONNECT_INITIAL_DELAY;
      this.stopHealthCheck();
      this.scheduleReconnect();
    }
  }

  /**
   * Get active user count
   */
  getActiveUserCount(): number {
    return this.activeUsers.size;
  }

  /**
   * Get bot information
   */
  getBotInfo(): BotInfo | null {
    if (!this.clientId) return null;
    return {
      id: this.clientId,
      displayName: 'Aion Assistant',
    };
  }

  /**
   * Send a message to a chat
   * Uses AI Card for streaming support, falls back to sessionWebhook
   */
  async sendMessage(chatId: string, message: IUnifiedOutgoingMessage): Promise<string> {
    await this.ensureAccessToken();

    const { type: chatType, id } = parseChatId(chatId);

    // Handle image messages - upload then send via API
    if (message.type === 'image' && message.imageUrl) {
      try {
        const uploadType = getUploadMediaType(message.imageUrl);
        const mediaId = await this.uploadMedia(message.imageUrl, uploadType);
        return this.sendMediaViaAPI(chatType, id, 'image', mediaId);
      } catch (error) {
        mainError('DingTalkPlugin', 'Failed to send image', error);
        throw error;
      }
    }

    // Handle file messages - upload then send via API
    if (message.type === 'file' && message.fileUrl && message.fileName) {
      try {
        const uploadType = getUploadMediaType(message.fileName);
        const mediaId = await this.uploadMedia(message.fileUrl, uploadType);
        const fileType = getDingTalkFileType(message.fileName);
        return this.sendMediaViaAPI(chatType, id, 'file', mediaId, message.fileName, fileType);
      } catch (error) {
        mainError('DingTalkPlugin', 'Failed to send file', error);
        throw error;
      }
    }

    const { contentType, content, rawText } = toDingTalkSendParams(message);

    // Extract local image refs from text and send as separate sampleImageMsg
    let textContent = rawText || message.text || '';
    let localImages: string[] = [];
    if (message.type === 'text' && textContent) {
      const extracted = this.extractLocalImageRefs(textContent);
      textContent = extracted.cleanText;
      localImages = extracted.imagePaths;
      // If text was fully extracted as images, just send the images directly
      if (!textContent && localImages.length > 0) {
        await this.sendLocalImages(chatId, localImages);
        return '';
      }
    }

    // Try AI Card streaming for text/markdown messages
    if (contentType === 'markdown' && textContent !== undefined && textContent !== '') {
      try {
        const cardMessageId = await this.createAndDeliverAICard(chatType, id, textContent);
        // Send extracted local images after text
        if (localImages.length > 0) {
          await this.sendLocalImages(chatId, localImages);
        }
        return cardMessageId;
      } catch (error) {
        mainWarn('DingTalkPlugin', 'AI Card failed, falling back to webhook', error);
      }
    }

    // Fallback: use sessionWebhook for sending
    const webhook = this.webhookCache.get(chatId);
    if (webhook) {
      try {
        const msgId = await this.sendViaWebhook(webhook, contentType, content, textContent);
        if (localImages.length > 0) {
          await this.sendLocalImages(chatId, localImages);
        }
        return msgId;
      } catch (error) {
        mainError('DingTalkPlugin', 'Webhook send failed', error);
        throw error;
      }
    }

    // Last resort: use DingTalk API to send message
    try {
      const msgId = await this.sendViaAPI(chatType, id, contentType, content, textContent);
      if (localImages.length > 0) {
        await this.sendLocalImages(chatId, localImages);
      }
      return msgId;
    } catch (error) {
      mainError('DingTalkPlugin', 'API send failed', error);
      throw error;
    }
  }

  /**
   * Edit an existing message (update AI Card content)
   */
  async editMessage(chatId: string, messageId: string, message: IUnifiedOutgoingMessage): Promise<void> {
    const cardSession = this.aiCardSessions.get(messageId);
    const isFinal = !!message.replyMarkup;

    // No card session (sent via webhook/API) or card already finished/failed
    if (!cardSession || cardSession.isFinished) {
      // Send final response as a new plain message
      if (isFinal && message.text) {
        await this.sendPlainMessage(chatId, message);
      }
      return;
    }

    await this.ensureAccessToken();

    const { rawText } = toDingTalkSendParams(message);
    const text = rawText || message.text || '';

    // Extract local image refs to avoid gray placeholder in AI Card
    const { cleanText, imagePaths } = this.extractLocalImageRefs(text);

    // Truncate if too long
    const truncatedText = cleanText.length > DINGTALK_MESSAGE_LIMIT ? cleanText.slice(0, DINGTALK_MESSAGE_LIMIT - 3) + '...' : cleanText;

    try {
      await this.streamAICard(cardSession.outTrackId, truncatedText, isFinal);

      if (isFinal) {
        await this.finishAICard(cardSession.outTrackId, truncatedText);
        this.aiCardSessions.set(messageId, { ...cardSession, isFinished: true });

        // 流结束：把之前各段仍未 finalize 的 card 一并 finalize（停转圈）。
        // 此时所有 update 已送达，各 card 的 lastContent 即其最终内容，无竞态。
        // Stream ended: finalize any earlier segment cards that are still loading. All updates
        // have landed by now, so each card's lastContent is its final text — no race.
        await this.finalizePendingCards();

        // Send extracted local images as separate messages after AI Card is finalized
        if (imagePaths.length > 0) {
          await this.sendLocalImages(chatId, imagePaths);
        }
      }
    } catch (error: any) {
      // Ignore "not modified" style errors
      const errorMsg = error?.message || '';
      if (errorMsg.includes('not modified') || errorMsg.includes('not found')) {
        return;
      }
      mainError('DingTalkPlugin', 'Failed to update AI Card', error);

      // Mark card as finished to prevent further failed streaming attempts
      this.aiCardSessions.set(messageId, { ...cardSession, isFinished: true });

      // Fall back to sending the final response as a plain message
      if (isFinal && message.text) {
        await this.sendPlainMessage(chatId, message);
      }
    }
  }

  // ==================== Robot Message Handling ====================

  /**
   * Handle incoming robot message from Stream
   */
  private async handleRobotMessage(data: DingTalkStreamMessage, streamMessageId: string): Promise<void> {
    try {
      const eventId = data.msgId || streamMessageId;

      // Event deduplication
      if (eventId && this.isEventProcessed(eventId)) {
        return;
      }
      if (eventId) {
        this.markEventProcessed(eventId);
      }

      const userId = data.senderStaffId || '';
      if (!userId) return;

      // Track user
      this.activeUsers.add(userId);

      // Cache sessionWebhook for this chat
      if (data.sessionWebhook) {
        const chatId = encodeChatId(data);
        this.webhookCache.set(chatId, data.sessionWebhook);
      }

      // Download media files to local workspace before converting
      await this.downloadMediaItems(data);

      // Convert to unified message
      const unifiedMessage = toUnifiedIncomingMessage(data);
      if (unifiedMessage && this.messageHandler) {
        // Check for menu button commands
        if (unifiedMessage.content.type === 'text' && unifiedMessage.content.text) {
          const buttonAction = this.getMenuButtonAction(unifiedMessage.content.text);
          if (buttonAction) {
            const actionMessage = {
              ...unifiedMessage,
              content: {
                ...unifiedMessage.content,
                type: 'action' as const,
                text: buttonAction.action,
              },
              action: {
                type: buttonAction.type as 'system' | 'platform' | 'chat',
                name: buttonAction.action,
              },
            };
            void this.emitMessage(actionMessage).catch((error) => mainError('DingTalkPlugin', 'Error handling message', error));
            return;
          }
        }

        // Process in background to avoid blocking
        void this.emitMessage(unifiedMessage).catch((error) => mainError('DingTalkPlugin', 'Error handling message', error));
      }
    } catch (error) {
      mainError('DingTalkPlugin', 'Error processing robot message', error);
    }
  }

  /**
   * Handle card action callback from Stream
   */
  private async handleCardCallback(data: any, streamMessageId: string): Promise<void> {
    try {
      // Event deduplication
      const eventId = `card_${streamMessageId}`;
      if (this.isEventProcessed(eventId)) {
        return;
      }
      this.markEventProcessed(eventId);

      const userId = data.userId || '';
      if (!userId) return;

      // Track user
      this.activeUsers.add(userId);

      // Extract action from card callback
      const params = data.content?.cardPrivateData?.params || {};
      const actionInfo = extractCardAction(params);
      if (!actionInfo) return;

      // Handle tool confirmation specially
      if (actionInfo.name === 'system.confirm' && actionInfo.params?.callId && actionInfo.params?.value) {
        if (this.confirmHandler) {
          void this.confirmHandler(userId, 'dingtalk', actionInfo.params.callId, actionInfo.params.value).catch((error) => {
            mainError('DingTalkPlugin', 'Confirm handler error', error);
          });
        }
        return;
      }

      // Build a minimal DingTalkStreamMessage for conversion
      const mockData: DingTalkStreamMessage = {
        senderStaffId: userId,
        senderNick: `User ${userId.slice(-6)}`,
        msgId: streamMessageId,
        conversationType: '1', // Assume private for card actions
        createAt: Date.now(),
      };

      const unifiedMessage = toUnifiedIncomingMessage(mockData, actionInfo);
      if (unifiedMessage && this.messageHandler) {
        void this.emitMessage(unifiedMessage).catch((error) => mainError('DingTalkPlugin', 'Error handling card action', error));
      }
    } catch (error) {
      mainError('DingTalkPlugin', 'Error processing card callback', error);
    }
  }

  /**
   * Map menu action strings to action info
   */
  private getMenuButtonAction(text: string): { type: string; action: string } | null {
    const menuActions: Record<string, { type: string; action: string }> = {
      'session.new': { type: 'system', action: 'session.new' },
      'session.status': { type: 'system', action: 'session.status' },
      'help.show': { type: 'system', action: 'help.show' },
      'agent.show': { type: 'system', action: 'agent.show' },
      'pairing.check': { type: 'platform', action: 'pairing.check' },
    };
    return menuActions[text] || null;
  }

  // ==================== AI Card Streaming ====================

  /**
   * Create and deliver an AI Card for streaming
   * Returns a synthetic messageId for tracking
   */
  private async createAndDeliverAICard(chatType: 'user' | 'group', id: string, _initialText: string): Promise<string> {
    // 创建新 card 前 finalize 之前所有未完成的 card（停转圈），让用户看到"上一条消息已完成"。
    // 安全前提：ActionExecutor 的 msg_id 路由会把建卡 await 窗口内到达的同段 update 暂存
    // （deferred），不会打到这些刚 finish 的旧 card；上一段被 throttle 的尾内容也由
    // ActionExecutor 在到达此处之前 flush 到旧 card，故 finalize 时 lastContent 已完整。
    // Finalize earlier cards before creating a new one so each message stops spinning in turn.
    // Safe because ActionExecutor's msg_id routing defers same-segment updates during this await,
    // and flushes the previous segment's throttled tail before reaching here.
    await this.finalizePendingCards();

    const token = await this.getAccessToken();
    const outTrackId = `aion_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 1. Create AI Card instance with STREAM callback type and space models
    await this.apiRequest('POST', '/v1.0/card/instances', token, {
      cardTemplateId: AI_CARD_TEMPLATE_ID,
      outTrackId,
      cardData: {
        cardParamMap: {},
      },
      callbackType: 'STREAM',
      imGroupOpenSpaceModel: { supportForward: true },
      imRobotOpenSpaceModel: { supportForward: true },
    });

    // 2. Deliver card to user/group
    const openSpaceId = chatType === 'group' ? `dtv1.card//IM_GROUP.${id}` : `dtv1.card//IM_ROBOT.${id}`;

    await this.apiRequest('POST', '/v1.0/card/instances/deliver', token, {
      outTrackId,
      openSpaceId,
      userIdType: 1,
      imGroupOpenDeliverModel: chatType === 'group' ? { robotCode: this.clientId } : undefined,
      imRobotOpenDeliverModel: chatType === 'user' ? { spaceType: 'IM_ROBOT' } : undefined,
    });

    // Track the AI Card session
    const messageId = `aicard_${outTrackId}`;
    this.aiCardSessions.set(messageId, {
      outTrackId,
      openSpaceId,
      isFinished: false,
      inputingStarted: false,
      lastContent: '',
    });

    // Set initial content so the card is not empty
    if (_initialText) {
      try {
        await this.streamAICard(outTrackId, _initialText);
      } catch (error) {
        mainWarn('DingTalkPlugin', 'Failed to set initial AI Card content', error);
      }
    }

    return messageId;
  }

  /**
   * Update AI Card content (streaming)
   */
  private async streamAICard(outTrackId: string, content: string, isFinalize = false): Promise<void> {
    const token = await this.getAccessToken();

    // Transition to INPUTING state on first stream write
    const session = this.findCardSessionByTrackId(outTrackId);
    if (session && !session.inputingStarted) {
      await this.apiRequest('PUT', '/v1.0/card/instances', token, {
        outTrackId,
        cardData: {
          cardParamMap: {
            flowStatus: AICardStatus.INPUTING,
            msgContent: '',
            staticMsgContent: '',
            sys_full_json_obj: JSON.stringify({ order: ['msgContent'] }),
          },
        },
      });
      session.inputingStarted = true;
    }

    // Stream content update
    // Always use isFull=true because editMessage sends complete content each time (not deltas)
    await this.apiRequest('PUT', '/v1.0/card/streaming', token, {
      outTrackId,
      key: 'msgContent',
      content,
      isFull: true,
      isFinalize,
      isError: false,
      guid: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    });

    // Record the last full content so finalizePendingCards can finishAICard older cards
    // with the exact text they currently show (avoids both truncation and the loading spinner).
    const sessionForContent = this.findCardSessionByTrackId(outTrackId);
    if (sessionForContent) {
      sessionForContent.lastContent = content;
    }
  }

  /**
   * Finish AI Card by setting flow status to FINISHED
   */
  private async finishAICard(outTrackId: string, finalContent: string): Promise<void> {
    const token = await this.getAccessToken();
    await this.apiRequest('PUT', '/v1.0/card/instances', token, {
      outTrackId,
      cardData: {
        cardParamMap: {
          flowStatus: AICardStatus.FINISHED,
          msgContent: finalContent,
          staticMsgContent: '',
          sys_full_json_obj: JSON.stringify({ order: ['msgContent'] }),
        },
      },
    });
  }

  /**
   * Finalize every still-loading AI Card (flowStatus -> FINISHED) using each card's last
   * streamed content. Called before creating a new card so prior segment cards stop
   * showing the loading spinner. Idempotent: already-finished cards are skipped.
   */
  private async finalizePendingCards(): Promise<void> {
    for (const session of this.aiCardSessions.values()) {
      if (session.isFinished) continue;
      try {
        await this.finishAICard(session.outTrackId, session.lastContent || '');
      } catch (error) {
        mainWarn('DingTalkPlugin', 'Failed to finalize previous AI Card before creating a new one', error);
      }
      // Mark finished regardless of success so we don't retry a failing card on every new card.
      session.isFinished = true;
    }
  }

  /**
   * Find AI Card session by outTrackId
   */
  private findCardSessionByTrackId(outTrackId: string): IAICardSession | undefined {
    for (const session of this.aiCardSessions.values()) {
      if (session.outTrackId === outTrackId) return session;
    }
    return undefined;
  }

  // ==================== Fallback Sending ====================

  /**
   * Send a message via webhook or API, bypassing AI Card
   * Used as fallback when AI Card streaming is unavailable or fails
   */
  private async sendPlainMessage(chatId: string, message: IUnifiedOutgoingMessage): Promise<void> {
    try {
      await this.ensureAccessToken();
      const { contentType, content, rawText } = toDingTalkSendParams(message);
      const { type: chatType, id } = parseChatId(chatId);

      // Extract local image refs to avoid gray placeholder
      let textContent = rawText || message.text || '';
      let localImages: string[] = [];
      if (message.type === 'text' && textContent) {
        const extracted = this.extractLocalImageRefs(textContent);
        textContent = extracted.cleanText;
        localImages = extracted.imagePaths;
      }

      // Try sessionWebhook first
      const webhook = this.webhookCache.get(chatId);
      if (webhook) {
        await this.sendViaWebhook(webhook, contentType, content, textContent);
        if (localImages.length > 0) {
          await this.sendLocalImages(chatId, localImages);
        }
        return;
      }

      // Fall back to DingTalk API
      await this.sendViaAPI(chatType, id, contentType, content, textContent);
      if (localImages.length > 0) {
        await this.sendLocalImages(chatId, localImages);
      }
    } catch (error) {
      mainError('DingTalkPlugin', 'Fallback plain message send failed', error);
    }
  }

  // ==================== Local Image Extraction ====================

  /**
   * Extract local-path markdown image references from text.
   * Returns cleaned text (with local image refs removed) and array of local image paths.
   * HTTP/data URLs are left in the text unchanged.
   */
  private extractLocalImageRefs(text: string): { cleanText: string; imagePaths: string[] } {
    const imagePaths: string[] = [];
    const cleanText = text
      .replace(/!\[[^\]]*\]\(([^)]+)\)/g, (match, imgPath: string) => {
        if (/^(https?:|data:|file:)/i.test(imgPath)) {
          return match;
        }
        const ext = path.extname(imgPath).toLowerCase();
        if (LOCAL_IMAGE_EXTENSIONS.includes(ext)) {
          imagePaths.push(imgPath);
          return '';
        }
        return match;
      })
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { cleanText, imagePaths };
  }

  /**
   * Send local image files to DingTalk chat as separate sampleImageMsg messages.
   */
  private async sendLocalImages(chatId: string, imagePaths: string[]): Promise<void> {
    const { type: chatType, id } = parseChatId(chatId);
    // Local image paths extracted from markdown (e.g. ![](caterpillar.png)) are relative to the
    // session workspace, not the process cwd. Resolve them against the media dir before upload.
    const mediaBase = await this.ensureMediaDir();
    for (const imgPath of imagePaths) {
      try {
        const resolvedPath = path.isAbsolute(imgPath) ? imgPath : path.resolve(mediaBase, imgPath);
        const uploadType = getUploadMediaType(resolvedPath);
        const mediaId = await this.uploadMedia(resolvedPath, uploadType);
        await this.sendMediaViaAPI(chatType, id, 'image', mediaId);
      } catch (error) {
        mainError('DingTalkPlugin', 'Failed to send extracted local image', error);
      }
    }
  }

  // ==================== Message Sending ====================

  /**
   * Send message via sessionWebhook (simple markdown)
   */
  private async sendViaWebhook(webhook: string, contentType: string, content: Record<string, unknown>, rawText?: string): Promise<string> {
    let body: Record<string, unknown>;

    if (contentType === 'actionCard') {
      body = {
        msgtype: 'actionCard',
        actionCard: content,
      };
    } else {
      body = {
        msgtype: 'markdown',
        markdown: {
          title: 'Message',
          text: rawText || JSON.stringify(content),
        },
      };
    }

    const response = await this.httpPost(webhook, body);
    return response?.messageId || `webhook_${Date.now()}`;
  }

  /**
   * Send message via DingTalk Open API
   */
  private async sendViaAPI(chatType: 'user' | 'group', id: string, contentType: string, content: Record<string, unknown>, rawText?: string): Promise<string> {
    const token = await this.getAccessToken();

    if (chatType === 'user') {
      // Send to individual user via robot
      const body: Record<string, unknown> = {
        robotCode: this.clientId,
        userIds: [id],
        msgKey: contentType === 'actionCard' ? 'sampleActionCard6' : 'sampleMarkdown',
        msgParam: contentType === 'actionCard' ? JSON.stringify(content) : JSON.stringify({ title: 'Message', text: rawText || '' }),
      };

      const response = await this.apiRequest('POST', '/v1.0/robot/oToMessages/batchSend', token, body);
      return response?.processQueryKey || `api_${Date.now()}`;
    }

    // Send to group via robot
    const body: Record<string, unknown> = {
      robotCode: this.clientId,
      openConversationId: id,
      msgKey: contentType === 'actionCard' ? 'sampleActionCard6' : 'sampleMarkdown',
      msgParam: contentType === 'actionCard' ? JSON.stringify(content) : JSON.stringify({ title: 'Message', text: rawText || '' }),
    };

    const response = await this.apiRequest('POST', '/v1.0/robot/groupMessages/send', token, body);
    return response?.processQueryKey || `api_${Date.now()}`;
  }

  // ==================== Media Download ====================

  /**
   * Ensure the media directory exists and return its path.
   */
  private async ensureMediaDir(): Promise<string> {
    if (!this.mediaDir) {
      const { getDataPath } = await import('@/process/utils');
      this.mediaDir = path.join(getDataPath(), 'channel-media', 'dingtalk');
    }
    fs.mkdirSync(this.mediaDir, { recursive: true });
    return this.mediaDir;
  }

  /**
   * Download a file from URL using https.request (consistent with the rest of DingTalkPlugin).
   * Returns the file content as a Buffer.
   */
  private downloadFile(url: string, timeoutMs = 30_000): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const req = https.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port || 443,
          path: urlObj.pathname + urlObj.search,
          method: 'GET',
          timeout: timeoutMs,
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            // Follow redirects
            this.downloadFile(res.headers.location, timeoutMs).then(resolve, reject);
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        }
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('Download timed out'));
      });
      req.end();
    });
  }

  /**
   * Download media files (picture/audio/video/file) from DingTalk to local workspace.
   * Sets `_localPath` on the message data for each successfully downloaded item.
   * Failures are logged but do not block message processing.
   */
  private async downloadMediaItems(data: DingTalkStreamMessage): Promise<void> {
    const mediaInfo = extractMediaDownloadInfo(data);
    if (!mediaInfo) {
      return;
    }

    const { downloadCode, fileName } = mediaInfo;
    const msgtype = data.msgtype!;

    try {
      const token = await this.getAccessToken();
      const response = await this.apiRequest('POST', '/v1.0/robot/messageFiles/download', token, {
        downloadCode,
        robotCode: this.clientId,
      });

      const downloadUrl = response?.downloadUrl;
      if (!downloadUrl) {
        mainError('DingTalkPlugin', `No downloadUrl in response for downloadCode: ${downloadCode}`);
        return;
      }

      // Download file content using https.request (same as other DingTalk HTTP calls)
      const fileData = await this.downloadFile(downloadUrl);

      // Save directly to mediaDir (no double nesting)
      const mediaDir = await this.ensureMediaDir();
      const ext = fileName ? path.extname(fileName) : getDefaultExtension(msgtype);
      const baseName = fileName || `dingtalk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
      const localPath = path.join(mediaDir, baseName);
      fs.writeFileSync(localPath, fileData);

      setMediaLocalPath(data, localPath);

      mainLog('DingTalkPlugin', `Downloaded media: type=${msgtype}, size=${fileData.length}, path=${localPath}`);
    } catch (error) {
      mainError('DingTalkPlugin', `Failed to download media for type=${msgtype}, downloadCode=${downloadCode}`, error);
    }
  }

  // ==================== Access Token Management ====================

  /**
   * Get current access token (cached)
   */
  private async getAccessToken(): Promise<string> {
    await this.ensureAccessToken();
    return this.tokenCache?.accessToken || '';
  }

  /**
   * Ensure access token is valid
   */
  private async ensureAccessToken(): Promise<void> {
    const now = Date.now();
    // Refresh if token expires in less than 60 seconds
    if (!this.tokenCache || this.tokenCache.expiresAt - now < 60 * 1000) {
      await this.refreshAccessToken();
    }
  }

  /**
   * Refresh access token from DingTalk API
   */
  private async refreshAccessToken(): Promise<void> {
    try {
      const response = await this.httpPost(`${DINGTALK_API_BASE}/v1.0/oauth2/accessToken`, {
        appKey: this.clientId,
        appSecret: this.clientSecret,
      });

      if (response?.accessToken) {
        this.tokenCache = {
          accessToken: response.accessToken,
          expiresAt: Date.now() + (response.expireIn || 7200) * 1000,
        };
      } else {
        throw new Error('No access token in response');
      }
    } catch (error) {
      mainError('DingTalkPlugin', 'Failed to refresh access token', error);
      throw error;
    }
  }

  // ==================== HTTP Helpers ====================

  /**
   * Make an API request to DingTalk
   */
  private async apiRequest(method: string, path: string, token: string, body?: Record<string, unknown>): Promise<any> {
    const url = `${DINGTALK_API_BASE}${path}`;
    return this.httpRequest(method, url, body, {
      'x-acs-dingtalk-access-token': token,
      'Content-Type': 'application/json',
    });
  }

  /**
   * HTTP POST helper
   */
  private async httpPost(url: string, body: Record<string, unknown>): Promise<any> {
    return this.httpRequest('POST', url, body, {
      'Content-Type': 'application/json',
    });
  }

  /**
   * Generic HTTP request helper using Node.js https module
   */
  private httpRequest(method: string, url: string, body?: Record<string, unknown>, headers?: Record<string, string>): Promise<any> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const data = body ? JSON.stringify(body) : undefined;

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method,
        headers: {
          ...headers,
          ...(data ? { 'Content-Length': Buffer.byteLength(data).toString() } : {}),
        },
      };

      const req = https.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = responseData ? JSON.parse(responseData) : {};
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed)}`));
            } else {
              resolve(parsed);
            }
          } catch {
            resolve(responseData);
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy(new Error('Request timeout'));
      });

      if (data) {
        req.write(data);
      }
      req.end();
    });
  }

  // ==================== Event Deduplication ====================

  private isEventProcessed(eventId: string): boolean {
    return this.processedEvents.has(eventId);
  }

  private markEventProcessed(eventId: string): void {
    this.processedEvents.set(eventId, Date.now());
  }

  private startEventCleanup(): void {
    if (this.eventCleanupTimer) return;

    this.eventCleanupTimer = setInterval(() => {
      this.cleanupOldEvents();
    }, EVENT_CACHE_CLEANUP_INTERVAL);
  }

  private stopEventCleanup(): void {
    if (this.eventCleanupTimer) {
      clearInterval(this.eventCleanupTimer);
      this.eventCleanupTimer = null;
    }
  }

  private cleanupOldEvents(): void {
    const now = Date.now();

    for (const [eventId, timestamp] of this.processedEvents.entries()) {
      if (now - timestamp > EVENT_CACHE_TTL) {
        this.processedEvents.delete(eventId);
      }
    }
  }

  // ==================== Static Methods ====================

  /**
   * Test connection with the given credentials
   */
  static async testConnection(clientId: string, clientSecret?: string): Promise<{ success: boolean; botInfo?: { name?: string }; error?: string }> {
    if (!clientSecret) {
      return { success: false, error: 'Client Secret is required for DingTalk' };
    }

    try {
      // Try to get access token to verify credentials
      const response = await new Promise<any>((resolve, reject) => {
        const data = JSON.stringify({
          appKey: clientId,
          appSecret: clientSecret,
        });

        const options = {
          hostname: 'api.dingtalk.com',
          port: 443,
          path: '/v1.0/oauth2/accessToken',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data).toString(),
          },
        };

        const req = https.request(options, (res) => {
          let responseData = '';
          res.on('data', (chunk) => {
            responseData += chunk;
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(responseData));
            } catch {
              reject(new Error('Invalid response'));
            }
          });
        });

        req.on('error', reject);
        req.setTimeout(10000, () => {
          req.destroy(new Error('Connection timeout'));
        });
        req.write(data);
        req.end();
      });

      if (response?.accessToken) {
        return { success: true, botInfo: { name: 'DingTalk Bot' } };
      }

      return {
        success: false,
        error: response?.message || response?.errmsg || 'Failed to get access token',
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to connect to DingTalk API',
      };
    }
  }

  // ==================== Media Upload & Send ====================

  // DingTalk old API base for media upload (multipart/form-data)
  private static readonly DINGTALK_OAPI_BASE = 'https://oapi.dingtalk.com';

  /**
   * Upload a media file to DingTalk and return media_id.
   * Uses the old oapi endpoint with access_token as query parameter.
   */
  private async uploadMedia(filePath: string, uploadType: 'image' | 'file'): Promise<string> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const token = await this.getAccessToken();
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    const boundary = `----DingTalkBoundary${Date.now()}`;
    const CRLF = '\r\n';

    // 钉钉 /media/upload multipart 的 filename 字段若含非 ASCII（如中文），
    // 服务端会返回 errcode=-1 errmsg=系统繁忙。而 mediaId 与 multipart filename
    // 不绑定，用户最终看到的 fileName 来自 sendMediaViaAPI 的 msgParam
    // （走 JSON UTF-8 通道），与此处无关。所以这里用基于扩展名的 ASCII 占位名。
    const ext = path.extname(fileName) || '';
    const uploadFileName = `upload${ext}`;

    // 用 Buffer.concat 直接拼接：header / footer UTF-8 编码，文件内容保留原始字节，
    // 避免历史 `toString('binary')` + `Buffer.from(body, 'binary')` 双重 latin1
    // 往返路径中任何意外引入的非 ASCII 字符被截断为 0x?? 单字节。
    const header = Buffer.from(`--${boundary}${CRLF}` + `Content-Disposition: form-data; name="media"; filename="${uploadFileName}"${CRLF}` + `Content-Type: application/octet-stream${CRLF}` + CRLF, 'utf8');
    const footer = Buffer.from(`${CRLF}--${boundary}--${CRLF}`, 'utf8');

    const url = `${DingTalkPlugin.DINGTALK_OAPI_BASE}/media/upload?access_token=${encodeURIComponent(token)}&type=${uploadType}`;

    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const bodyBuffer = Buffer.concat([header, fileBuffer, footer]);

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': bodyBuffer.length,
        },
      };

      const req = https.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(responseData);
            if (parsed.errcode && parsed.errcode !== 0) {
              reject(new Error(`DingTalk upload failed: errcode=${parsed.errcode}, errmsg=${parsed.errmsg}`));
              return;
            }
            if (!parsed.media_id) {
              reject(new Error('DingTalk upload failed: no media_id in response'));
              return;
            }
            resolve(parsed.media_id);
          } catch {
            reject(new Error(`Invalid upload response: ${responseData}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy(new Error('Upload timed out'));
      });
      req.write(bodyBuffer);
      req.end();
    });
  }

  /**
   * Send image or file message via DingTalk robot API.
   * Uses the new api.dingtalk.com endpoint with header-based auth.
   */
  private async sendMediaViaAPI(chatType: 'user' | 'group', id: string, mediaType: 'image' | 'file', mediaId: string, fileName?: string, fileType?: string): Promise<string> {
    const token = await this.getAccessToken();

    let msgKey: string;
    let msgParam: string;

    if (mediaType === 'image') {
      msgKey = 'sampleImageMsg';
      msgParam = JSON.stringify({ photoURL: mediaId });
    } else {
      msgKey = 'sampleFile';
      msgParam = JSON.stringify({ mediaId, fileName, fileType });
    }

    if (chatType === 'user') {
      const body: Record<string, unknown> = {
        robotCode: this.clientId,
        userIds: [id],
        msgKey,
        msgParam,
      };
      const response = await this.apiRequest('POST', '/v1.0/robot/oToMessages/batchSend', token, body);
      return response?.processQueryKey || `api_media_${Date.now()}`;
    }

    // Group chat
    const body: Record<string, unknown> = {
      robotCode: this.clientId,
      openConversationId: id,
      msgKey,
      msgParam,
    };
    const response = await this.apiRequest('POST', '/v1.0/robot/groupMessages/send', token, body);
    return response?.processQueryKey || `api_media_${Date.now()}`;
  }
}
