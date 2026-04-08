/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import WebSocket from 'ws';

import type { BotInfo, IChannelPluginConfig, IUnifiedOutgoingMessage, PluginType } from '../../types';
import { BasePlugin } from '../BasePlugin';
import { WECOM_MESSAGE_LIMIT, encodeChatId, parseChatId, toUnifiedIncomingMessage, toWeComSendParams } from './WeComAdapter';
import type { WeComMsgCallback, WeComEventCallback } from './WeComAdapter';

/**
 * WeComPlugin - WeCom (WeChat Work) Bot integration via WebSocket long connection
 *
 * Uses the official WeCom AI Bot WebSocket protocol.
 * Reference: https://developer.work.weixin.qq.com/document/path/101463
 *
 * Features:
 * - WebSocket long connection (no public IP required)
 * - Stream-based message responses
 * - Group and single chat message push
 * - No message encryption required (unlike HTTP callback mode)
 */

// WeCom WebSocket endpoint
const WECOM_WS_URL = 'wss://openws.work.weixin.qq.com';

// Event deduplication settings
const EVENT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const EVENT_CACHE_CLEANUP_INTERVAL = 60 * 1000; // 1 minute

// Heartbeat interval (30 seconds as per protocol)
const HEARTBEAT_INTERVAL = 30 * 1000;

// Reconnection settings
const RECONNECT_INITIAL_DELAY = 1000; // 1 second
const RECONNECT_MAX_DELAY = 60 * 1000; // 1 minute
const RECONNECT_BACKOFF_FACTOR = 2;

/**
 * Stream session tracking for streaming responses
 */
interface IStreamSession {
  streamId: string;
  reqId: string;
  isFinished: boolean;
}

export class WeComPlugin extends BasePlugin {
  readonly type: PluginType = 'wecom';

  private ws: WebSocket | null = null;
  private isConnected: boolean = false;

  // Credentials
  private botId: string = '';
  private secret: string = '';

  // Track active users for status reporting
  private activeUsers: Set<string> = new Set();

  // Event deduplication
  private processedEvents: Map<string, number> = new Map();
  private eventCleanupTimer: ReturnType<typeof setInterval> | null = null;

  // Heartbeat
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // Reconnection
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay: number = RECONNECT_INITIAL_DELAY;
  private shouldReconnect: boolean = false;

  // Stream sessions: chatId -> stream session
  private streamSessions: Map<string, IStreamSession> = new Map();

  // reqId mapping: chatId -> reqId (from incoming messages for response routing)
  private reqIdCache: Map<string, string> = new Map();

  /**
   * Initialize the WeCom client
   */
  protected async onInitialize(config: IChannelPluginConfig): Promise<void> {
    const botId = config.credentials?.botId;
    const secret = config.credentials?.secret;

    if (!botId || !secret) {
      throw new Error('WeCom Bot ID and Secret are required');
    }

    this.botId = botId as string;
    this.secret = secret as string;
  }

  /**
   * Start WebSocket connection
   */
  protected async onStart(): Promise<void> {
    if (!this.botId || !this.secret) {
      throw new Error('Credentials not available');
    }

    try {
      this.shouldReconnect = true;
      await this.connect();
      this.startEventCleanup();
      console.log(`[WeComPlugin] Started for bot ${this.botId}`);
    } catch (error) {
      console.error('[WeComPlugin] Failed to start:', error);
      throw error;
    }
  }

  /**
   * Stop connection and cleanup
   */
  protected async onStop(): Promise<void> {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    this.stopEventCleanup();
    this.stopReconnect();

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }

    this.activeUsers.clear();
    this.processedEvents.clear();
    this.streamSessions.clear();
    this.reqIdCache.clear();
    this.isConnected = false;

    console.log('[WeComPlugin] Stopped and cleaned up');
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
    if (!this.botId) return null;
    return {
      id: this.botId,
      displayName: 'WeCom Assistant',
    };
  }

  /**
   * Send a message to a chat
   * Uses stream mode for real-time streaming responses
   */
  async sendMessage(chatId: string, message: IUnifiedOutgoingMessage): Promise<string> {
    console.log(`[WeComPlugin] sendMessage: chatId=${chatId}, text=${message.text?.slice(0, 100)}`);
    const { content } = toWeComSendParams(message);
    const reqId = this.reqIdCache.get(chatId);

    console.log(`[WeComPlugin] sendMessage: reqId=${reqId || 'none'}, content length=${content.length}`);

    // Truncate if too long
    const truncatedContent = content.length > WECOM_MESSAGE_LIMIT ? content.slice(0, WECOM_MESSAGE_LIMIT - 3) + '...' : content;

    // If we have a reqId (responding to an incoming message), use stream mode
    if (reqId) {
      const streamId = this.generateStreamId();
      console.log(`[WeComPlugin] sendMessage: using stream mode, streamId=${streamId}`);

      // Send initial stream message
      this.send({
        cmd: 'aibot_respond_msg',
        headers: { req_id: reqId },
        body: {
          msgtype: 'stream',
          stream: {
            id: streamId,
            finish: false,
            content: truncatedContent,
          },
        },
      });

      // Track stream session
      const messageId = `stream_${streamId}`;
      this.streamSessions.set(chatId, {
        streamId,
        reqId,
        isFinished: false,
      });

      return messageId;
    }

    // Otherwise, use proactive push (aibot_send_msg)
    const { type: chatType } = parseChatId(chatId);
    const sendReqId = this.generateReqId();
    console.log(`[WeComPlugin] sendMessage: using proactive push, chatType=${chatType}, sendReqId=${sendReqId}`);

    this.send({
      cmd: 'aibot_send_msg',
      headers: { req_id: sendReqId },
      body: {
        chatid: chatId,
        chat_type: chatType === 'group' ? 2 : 1,
        msgtype: 'markdown',
        markdown: { content: truncatedContent },
      },
    });

    return `push_${sendReqId}`;
  }

  /**
   * Edit an existing message (update stream content)
   */
  async editMessage(chatId: string, messageId: string, message: IUnifiedOutgoingMessage): Promise<void> {
    const session = this.streamSessions.get(chatId);
    const isFinal = !!message.replyMarkup;

    // No stream session or already finished
    if (!session || session.isFinished) {
      return;
    }

    const { content } = toWeComSendParams(message);

    // Truncate if too long
    const truncatedContent = content.length > WECOM_MESSAGE_LIMIT ? content.slice(0, WECOM_MESSAGE_LIMIT - 3) + '...' : content;

    try {
      // Update stream content using the same stream.id
      this.send({
        cmd: 'aibot_respond_msg',
        headers: { req_id: session.reqId },
        body: {
          msgtype: 'stream',
          stream: {
            id: session.streamId,
            finish: isFinal,
            content: truncatedContent,
          },
        },
      });

      if (isFinal) {
        this.streamSessions.set(chatId, { ...session, isFinished: true });
      }
    } catch (error) {
      console.error('[WeComPlugin] Failed to update stream:', error);
      // Mark as finished to prevent further attempts
      this.streamSessions.set(chatId, { ...session, isFinished: true });
    }
  }

  // ==================== WebSocket Connection ====================

  /**
   * Establish WebSocket connection and subscribe
   */
  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WECOM_WS_URL);
      this.ws = ws;

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Connection timeout'));
      }, 30000);

      ws.on('open', () => {
        // Send subscribe command immediately
        this.subscribe();
      });

      ws.on('message', (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleWsMessage(msg);

          // Check for successful subscription
          // WeCom response format: {"errcode":0,"errmsg":"ok"} or with cmd field
          const isSubscribeSuccess = (msg.cmd === 'aibot_subscribe' || msg.errcode !== undefined) && msg.errcode === 0;
          const isSubscribeFail = (msg.cmd === 'aibot_subscribe' || msg.errcode !== undefined) && msg.errcode !== 0 && msg.errcode !== undefined;

          if (isSubscribeSuccess && !this.isConnected) {
            clearTimeout(timeout);
            this.isConnected = true;
            this.reconnectDelay = RECONNECT_INITIAL_DELAY;
            this.startHeartbeat();
            resolve();
          } else if (isSubscribeFail) {
            clearTimeout(timeout);
            reject(new Error(`Subscribe failed: ${msg.errmsg || `errcode=${msg.errcode}`}`));
          }
        } catch (error) {
          console.error('[WeComPlugin] Failed to parse WebSocket message:', error);
        }
      });

      ws.on('close', (code, reason) => {
        const wasConnected = this.isConnected;
        this.isConnected = false;
        this.stopHeartbeat();

        console.log(`[WeComPlugin] WebSocket closed: code=${code}, reason=${reason.toString()}`);

        if (wasConnected && this.shouldReconnect) {
          this.scheduleReconnect();
        }
      });

      ws.on('error', (error) => {
        console.error('[WeComPlugin] WebSocket error:', error);
        if (!this.isConnected) {
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }

  /**
   * Send subscribe command for authentication
   */
  private subscribe(): void {
    this.send({
      cmd: 'aibot_subscribe',
      headers: { req_id: this.generateReqId() },
      body: {
        bot_id: this.botId,
        secret: this.secret,
      },
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleWsMessage(msg: Record<string, unknown>): void {
    const cmd = msg.cmd as string;
    const errcode = msg.errcode as number | undefined;
    console.log(`[WeComPlugin] handleWsMessage: cmd=${cmd || 'none'}, errcode=${errcode}, full msg=${JSON.stringify(msg).slice(0, 500)}`);

    switch (cmd) {
      case 'aibot_msg_callback':
        console.log(`[WeComPlugin] ⭐ RECEIVED MESSAGE CALLBACK - processing message from user`);
        void this.handleMsgCallback(msg).catch((error) => {
          console.error('[WeComPlugin] Error handling message callback:', error);
        });
        break;

      case 'aibot_event_callback':
        console.log(`[WeComPlugin] ⭐ RECEIVED EVENT CALLBACK - processing event`);
        void this.handleEventCallback(msg).catch((error) => {
          console.error('[WeComPlugin] Error handling event callback:', error);
        });
        break;

      case 'pong':
        // Heartbeat response, no action needed
        break;

      default:
        // Other commands (subscription response, etc.) are handled in connect()
        break;
    }
  }

  // ==================== Message Handling ====================

  /**
   * Handle incoming message callback (aibot_msg_callback)
   */
  private async handleMsgCallback(msg: Record<string, unknown>): Promise<void> {
    try {
      const body = msg.body as WeComMsgCallback;
      const headers = msg.headers as { req_id?: string } | undefined;
      const msgId = body?.msgid;
      const userId = body?.from?.userid;
      const chatType = body?.chattype;
      const msgType = body?.msgtype;

      console.log(`[WeComPlugin] handleMsgCallback: msgId=${msgId}, chattype=${chatType}, from=${userId}, msgtype=${msgType}`);
      console.log(`[WeComPlugin] handleMsgCallback body: ${JSON.stringify(body).slice(0, 800)}`);

      if (!msgId) {
        console.warn('[WeComPlugin] handleMsgCallback: missing msgId, skipping');
        return;
      }

      // Event deduplication
      if (this.isEventProcessed(msgId)) {
        console.log(`[WeComPlugin] handleMsgCallback: msgId=${msgId} already processed, skipping`);
        return;
      }
      this.markEventProcessed(msgId);

      if (!userId) {
        console.warn('[WeComPlugin] handleMsgCallback: missing userId, skipping');
        return;
      }

      // Track user
      this.activeUsers.add(userId);

      // Cache reqId for response routing
      const chatId = encodeChatId(body);
      if (headers?.req_id) {
        this.reqIdCache.set(chatId, headers.req_id);
      }

      // Convert to unified message
      const unifiedMessage = toUnifiedIncomingMessage(body);
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
            void this.emitMessage(actionMessage).catch((error) => console.error('[WeComPlugin] Error handling message:', error));
            return;
          }
        }

        // Process in background to avoid blocking
        void this.emitMessage(unifiedMessage).catch((error) => console.error('[WeComPlugin] Error handling message:', error));
      }
    } catch (error) {
      console.error('[WeComPlugin] Error processing message callback:', error);
    }
  }

  /**
   * Handle event callback (aibot_event_callback)
   */
  private async handleEventCallback(msg: Record<string, unknown>): Promise<void> {
    try {
      const body = msg.body as WeComEventCallback;
      const eventType = body?.event_type;

      if (!eventType) return;

      switch (eventType) {
        case 'enter_chat':
          // User entered chat - could send welcome message
          console.log(`[WeComPlugin] User entered chat: ${body.from?.userid}`);
          break;

        case 'disconnected_event':
          // Another connection was established, this one was kicked
          console.warn('[WeComPlugin] Disconnected by another connection');
          break;

        default:
          break;
      }
    } catch (error) {
      console.error('[WeComPlugin] Error processing event callback:', error);
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

  // ==================== Heartbeat ====================

  /**
   * Start heartbeat timer (ping every 30 seconds)
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
        this.send({
          cmd: 'ping',
          headers: { req_id: this.generateReqId() },
        });
      }
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ==================== Reconnection ====================

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;

    this.stopReconnect();

    console.log(`[WeComPlugin] Reconnecting in ${this.reconnectDelay / 1000}s...`);

    this.reconnectTimer = setTimeout(() => {
      void this.connect()
        .then(() => {
          console.log('[WeComPlugin] Reconnected successfully');
          this.setStatus('running');
        })
        .catch((error) => {
          console.error('[WeComPlugin] Reconnection failed:', error);
          // Increase delay with exponential backoff
          this.reconnectDelay = Math.min(this.reconnectDelay * RECONNECT_BACKOFF_FACTOR, RECONNECT_MAX_DELAY);
          this.scheduleReconnect();
        });
    }, this.reconnectDelay);
  }

  /**
   * Stop reconnection timer
   */
  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ==================== WebSocket Helpers ====================

  /**
   * Send a message over WebSocket
   */
  private send(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('[WeComPlugin] WebSocket not open, cannot send message');
    }
  }

  /**
   * Generate a unique request ID
   */
  private generateReqId(): string {
    return `wecom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Generate a unique stream ID
   */
  private generateStreamId(): string {
    return `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
   * Attempts to establish a WebSocket connection and subscribe
   */
  static async testConnection(botId: string, secret?: string): Promise<{ success: boolean; botInfo?: { name?: string }; error?: string }> {
    if (!secret) {
      return { success: false, error: 'Secret is required for WeCom' };
    }

    console.log(`[WeComPlugin] testConnection: connecting to ${WECOM_WS_URL}...`);

    return new Promise((resolve) => {
      const ws = new WebSocket(WECOM_WS_URL);
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          try {
            ws.close();
          } catch {
            // ignore
          }
        }
      };

      const timeout = setTimeout(() => {
        console.log('[WeComPlugin] testConnection: timeout after 15s');
        cleanup();
        resolve({ success: false, error: 'Connection timeout' });
      }, 15000);

      ws.on('open', () => {
        console.log('[WeComPlugin] testConnection: WebSocket opened, sending subscribe...');
        ws.send(
          JSON.stringify({
            cmd: 'aibot_subscribe',
            headers: { req_id: `test-${Date.now()}` },
            body: { bot_id: botId, secret },
          })
        );
      });

      ws.on('message', (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          console.log('[WeComPlugin] testConnection: received message:', JSON.stringify(msg).slice(0, 200));
          // WeCom response format: {"errcode":0,"errmsg":"ok"} or {"errcode":xxx,"errmsg":"xxx"}
          // The response may not have a "cmd" field
          if (msg.errcode !== undefined) {
            clearTimeout(timeout);
            if (msg.errcode === 0) {
              resolve({ success: true, botInfo: { name: 'WeCom Bot' } });
            } else {
              resolve({ success: false, error: msg.errmsg || `Subscribe failed: errcode=${msg.errcode}` });
            }
            cleanup();
          }
        } catch (e) {
          console.error('[WeComPlugin] testConnection: parse error:', e);
          // ignore parse errors during test
        }
      });

      ws.on('error', (error: Error) => {
        console.error('[WeComPlugin] testConnection: WebSocket error:', error.message);
        clearTimeout(timeout);
        cleanup();
        resolve({ success: false, error: error.message || 'WebSocket connection failed' });
      });

      ws.on('close', (code, reason) => {
        console.log(`[WeComPlugin] testConnection: WebSocket closed, code=${code}, reason=${reason.toString()}`);
      });
    });
  }
}
