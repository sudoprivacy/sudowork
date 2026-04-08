/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { getDataPath } from '@/process/utils';
import type { BotInfo, IChannelPluginConfig, IUnifiedOutgoingMessage, PluginType } from '../../types';
import { saveMediaToWorkspace } from '../../utils/mediaDownloader';
import { BasePlugin } from '../BasePlugin';
import { getMediaFileId, getMediaUrl, splitMessage, stripMarkdownToPlain, toUnifiedIncomingMessage, toWeChatSendPayload } from './WeChatAdapter';
import { WeChatApiClient } from './WeChatApiClient';
import { WeChatContextTokenStore } from './WeChatContextTokenStore';
import type { WeChatMessage, WeChatMessageItem } from './types';
import { MessageItemType, WECHAT_MESSAGE_LIMIT, WECHAT_SESSION_EXPIRED_CODE, WECHAT_SESSION_PAUSE_MS } from './types';

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

  // Typing state
  private typingTickets: Map<string, string> = new Map();
  private typingIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

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

    for (const interval of this.typingIntervals.values()) {
      clearInterval(interval);
    }
    this.typingIntervals.clear();
    this.typingTickets.clear();

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

  async sendTyping(chatId: string, stop = false): Promise<void> {
    if (!this.apiClient) return;
    const userId = chatId.startsWith('user:') ? chatId.slice(5) : chatId;

    if (stop) {
      const interval = this.typingIntervals.get(userId);
      if (interval) {
        clearInterval(interval);
        this.typingIntervals.delete(userId);
      }
      return;
    }

    if (this.typingIntervals.has(userId)) return;

    const doSend = async () => {
      try {
        let ticket = this.typingTickets.get(userId);
        if (!ticket) {
          const config = await this.apiClient!.getConfig(userId);
          if (config.typing_ticket) {
            ticket = config.typing_ticket;
            this.typingTickets.set(userId, ticket);
          }
        }
        if (ticket) {
          await this.apiClient!.sendTyping({
            ilink_user_id: userId,
            typing_ticket: ticket,
            status: 1,
          });
        }
      } catch (error) {
        console.warn('[WeChatPlugin] sendTyping failed:', error);
      }
    };

    void doSend();
    const interval = setInterval(doSend, 5000);
    this.typingIntervals.set(userId, interval);
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

    // Download media items before converting to unified message.
    // This ensures the attachment fileId is replaced with a local file path
    // that the ActionExecutor can pass to the agent.
    await this.downloadMediaItems(msg);

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

  /**
   * Download all media items in a message and update item URLs to local file paths.
   * Downloads images, voice, files, and videos from WeChat CDN to the workspace.
   */
  private async downloadMediaItems(msg: WeChatMessage): Promise<void> {
    if (!this.apiClient || !msg.item_list) return;

    for (const item of msg.item_list) {
      if (!item.type || item.type === MessageItemType.NONE || item.type === MessageItemType.TEXT) {
        continue;
      }

      try {
        const localPath = await this.downloadMediaItem(item);
        if (localPath) {
          // Store the local file path back into the item's URL field
          // so that the adapter can include it in the attachment's fileId.
          this.setMediaItemLocalPath(item, localPath);
        }
      } catch (error) {
        console.warn(`[WeChatPlugin] Failed to download media item (type=${item.type}):`, error);
      }
    }
  }

  /**
   * Download a single media item from WeChat to local workspace.
   * Returns the absolute local file path, or null if download failed.
   */
  private async downloadMediaItem(item: WeChatMessageItem): Promise<string | null> {
    if (!this.apiClient) return null;

    // First try the direct URL from the item
    let mediaUrl = getMediaUrl(item);

    // If no direct URL, try resolving via file ID
    if (!mediaUrl) {
      const fileId = getMediaFileId(item);
      if (fileId) {
        try {
          const response = await this.apiClient.getMediaUrl(fileId);
          if (response.file_url) {
            mediaUrl = response.file_url;
          } else if (response.file_data) {
            // API returned base64 data directly
            const buffer = Buffer.from(response.file_data, 'base64');
            const attachment = this.buildTempAttachment(item);
            return saveMediaToWorkspace(buffer, this.getWorkspacePath(), 'wechat', attachment);
          }
        } catch (error) {
          console.warn(`[WeChatPlugin] Failed to resolve media URL for fileId=${fileId}:`, error);
          return null;
        }
      }
    }

    if (!mediaUrl) {
      console.warn(`[WeChatPlugin] No media URL available for item type=${item.type}`);
      return null;
    }

    // Download the media file
    const buffer = await this.apiClient.downloadMedia(mediaUrl);
    const attachment = this.buildTempAttachment(item);
    return saveMediaToWorkspace(buffer, this.getWorkspacePath(), 'wechat', attachment);
  }

  /**
   * Build a temporary attachment object for media file saving (before full conversion).
   */
  private buildTempAttachment(item: WeChatMessageItem) {
    switch (item.type) {
      case MessageItemType.IMAGE:
        return { type: 'photo' as const, fileId: '', mimeType: 'image/jpeg' };
      case MessageItemType.VOICE:
        return { type: 'voice' as const, fileId: '', mimeType: 'audio/amr' };
      case MessageItemType.FILE:
        return {
          type: 'document' as const,
          fileId: '',
          fileName: item.file_item?.file_name,
          size: item.file_item?.file_size,
        };
      case MessageItemType.VIDEO:
        return { type: 'video' as const, fileId: '', mimeType: 'video/mp4' };
      default:
        return { type: 'document' as const, fileId: '' };
    }
  }

  /**
   * Update the media item's URL field with the local file path.
   * This ensures the adapter reads the local path as the fileId.
   */
  private setMediaItemLocalPath(item: WeChatMessageItem, localPath: string): void {
    switch (item.type) {
      case MessageItemType.IMAGE:
        if (!item.image_item) item.image_item = {};
        item.image_item.url = localPath;
        break;
      case MessageItemType.VOICE:
        if (!item.voice_item) item.voice_item = {};
        item.voice_item.url = localPath;
        break;
      case MessageItemType.FILE:
        if (!item.file_item) item.file_item = {};
        item.file_item.url = localPath;
        break;
      case MessageItemType.VIDEO:
        if (!item.video_item) item.video_item = {};
        item.video_item.url = localPath;
        break;
    }
  }

  /**
   * Get the workspace root path for media downloads.
   */
  private getWorkspacePath(): string {
    // Use the data path's channel-media directory (consistent with ActionExecutor)
    const dir = path.join(getDataPath(), 'channel-media');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
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
