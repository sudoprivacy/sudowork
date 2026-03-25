/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BotInfo, IChannelPluginConfig, IUnifiedOutgoingMessage, PluginType } from '../../types';
import { BasePlugin } from '../BasePlugin';
import { splitMessage, stripMarkdownToPlain, toUnifiedIncomingMessage, toWeChatSendPayload } from './WeChatAdapter';
import { WeChatApiClient } from './WeChatApiClient';
import { WeChatContextTokenStore } from './WeChatContextTokenStore';
import type { WeChatMessage } from './types';
import { WECHAT_MESSAGE_LIMIT, WECHAT_SESSION_EXPIRED_CODE, WECHAT_SESSION_PAUSE_MS } from './types';

/**
 * WeChatPlugin - Native WeChat channel integration for Sudowork.
 */
export class WeChatPlugin extends BasePlugin {
  readonly type: PluginType = 'wechat';

  private apiClient: WeChatApiClient | null = null;
  private tokenStore: WeChatContextTokenStore = new WeChatContextTokenStore();
  private accountId: string = '';
  private getUpdatesBuf: string | undefined;

  // Polling state
  private pollingActive = false;
  private abortController: AbortController | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly baseReconnectDelay = 1000;

  // Session state
  private sessionPaused = false;

  // Active users tracking
  private activeUsers: Set<string> = new Set();
  private botName: string | null = null;

  protected async onInitialize(config: IChannelPluginConfig): Promise<void> {
    const token = config.credentials?.token as string | undefined;
    const accountId = config.credentials?.accountId as string | undefined;
    const baseUrl = config.credentials?.botApiBaseUrl as string | undefined;

    if (!token) throw new Error('WeChat bot token is required');
    if (!accountId) throw new Error('WeChat account ID is required');

    this.accountId = accountId;
    this.apiClient = new WeChatApiClient(token, baseUrl);
    this.tokenStore.restore(this.accountId);
  }

  protected async onStart(): Promise<void> {
    if (!this.apiClient) throw new Error('API client not initialized');

    this.botName = this.accountId || 'WeChat';
    this.pollingActive = true;
    this.reconnectAttempts = 0;
    void this.pollLoop();
  }

  protected async onStop(): Promise<void> {
    this.pollingActive = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.apiClient = null;
    this.activeUsers.clear();
    this.tokenStore.clear();
    this.getUpdatesBuf = undefined;
    this.botName = null;
    this.reconnectAttempts = 0;
    this.sessionPaused = false;
    console.log('[WeChatPlugin] Stopped and cleaned up');
  }

  async sendMessage(chatId: string, message: IUnifiedOutgoingMessage): Promise<string> {
    if (!this.apiClient) throw new Error('API client not initialized');

    const userId = chatId.startsWith('user:') ? chatId.slice(5) : chatId;
    if (this.sessionPaused) {
      console.warn('[WeChatPlugin] Session paused, skipping sendMessage');
      return `wechat_paused_${Date.now()}`;
    }

    const contextToken = this.tokenStore.get(this.accountId, userId);
    if (!contextToken) {
      console.warn(`[WeChatPlugin] No context token for user ${userId}, skipping sendMessage`);
      return `wechat_no_token_${Date.now()}`;
    }

    const text = stripMarkdownToPlain(message.text || '');
    if (!text.trim()) return `wechat_empty_${Date.now()}`;

    const chunks = splitMessage(text, WECHAT_MESSAGE_LIMIT);
    for (const chunk of chunks) {
      const payload = toWeChatSendPayload(userId, { ...message, text: chunk }, contextToken);
      await this.apiClient.sendMessage(payload);
    }

    return `wechat_${Date.now()}`;
  }

  async editMessage(_chatId: string, _messageId: string, _message: IUnifiedOutgoingMessage): Promise<void> {
    // WeChat doesn't support editing messages.
  }

  async sendTyping(_userId: string): Promise<void> {
    if (!this.apiClient) return;
    // sendTyping requires typing_ticket from getConfig, skip for now
  }

  getActiveUserCount(): number {
    return this.activeUsers.size;
  }

  getBotInfo(): BotInfo | null {
    if (!this.botName) return null;
    return { id: this.accountId, displayName: this.botName };
  }

  // ==================== Long-Polling Loop ====================

  private async pollLoop(): Promise<void> {
    console.log(`[WeChatPlugin] pollLoop started, status=${this.status}`);
    // Wait for status to transition to 'running'
    while (this.pollingActive && this.status === 'starting') {
      await this.sleep(50);
    }
    console.log(`[WeChatPlugin] pollLoop active, status=${this.status}`);

    while (this.pollingActive && this.status === 'running') {
      try {
        this.abortController = new AbortController();
        const response = await this.apiClient!.getUpdates(this.getUpdatesBuf, this.abortController.signal);

        // Check for session expired (can be in either errcode or ret)
        const isSessionExpired = response.errcode === WECHAT_SESSION_EXPIRED_CODE || response.ret === WECHAT_SESSION_EXPIRED_CODE;
        if (isSessionExpired) {
          console.warn('[WeChatPlugin] Session expired, pausing for 60 minutes');
          this.sessionPaused = true;
          this.setError('WeChat session expired. Will retry in 60 minutes.');
          await this.sleep(WECHAT_SESSION_PAUSE_MS);
          this.sessionPaused = false;
          continue;
        }

        // Check for API errors (can be in either errcode or ret)
        const isApiError = (response.ret !== undefined && response.ret !== 0) || (response.errcode !== undefined && response.errcode !== 0);
        if (isApiError) {
          console.warn(`[WeChatPlugin] getUpdates error: ${response.errmsg} (ret=${response.ret}, errcode=${response.errcode})`);
          await this.handlePollError(new Error(response.errmsg || `ret=${response.ret} errcode=${response.errcode}`));
          continue;
        }

        // Update pagination buffer
        if (response.get_updates_buf) {
          this.getUpdatesBuf = response.get_updates_buf;
        }

        // Reset reconnect counter on success
        this.reconnectAttempts = 0;

        // Process incoming messages
        const msgs = response.msgs || [];
        console.log(`[WeChatPlugin] getUpdates: ${msgs.length} messages`);
        for (const msg of msgs) {
          void this.handleIncomingMessage(msg);
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') break;
        await this.handlePollError(error);
      }
    }
  }

  private async handleIncomingMessage(msg: WeChatMessage): Promise<void> {
    const userId = msg.from_user_id || '';
    console.log(`[WeChatPlugin] Incoming: from=${userId}, type=${msg.message_type}, items=${msg.item_list?.length}, hasContextToken=${!!msg.context_token}, hasHandler=${!!this.messageHandler}`);

    // Store context token
    if (msg.context_token && userId) {
      this.tokenStore.set(this.accountId, userId, msg.context_token);
    }

    if (userId) this.activeUsers.add(userId);

    // Convert to unified message
    const unified = toUnifiedIncomingMessage(msg);
    if (!unified) return;

    // Forward to message handler
    if (this.messageHandler) {
      void this.messageHandler(unified).catch((error) => {
        console.error(`[WeChatPlugin] Message handler failed for ${msg.message_id}:`, error);
      });
    }
  }

  private async handlePollError(_error: unknown): Promise<void> {
    if (!this.pollingActive || this.status !== 'running') return;

    this.reconnectAttempts++;
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      console.error('[WeChatPlugin] Max reconnect attempts reached, stopping');
      this.setError('Connection failed after multiple attempts');
      await this.stop();
      return;
    }

    const delay = Math.min(this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1) + Math.random() * 1000, 30000);
    console.log(`[WeChatPlugin] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    await this.sleep(delay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  static async testConnection(token: string, _baseUrl?: string): Promise<{ success: boolean; botInfo?: BotInfo; error?: string }> {
    if (!token) return { success: false, error: 'Token is empty' };
    return { success: true, botInfo: { id: '', displayName: 'WeChat Bot' } };
  }
}
