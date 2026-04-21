/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { randomBytes } from 'node:crypto';
import type { BotInfo, IChannelPluginConfig, IUnifiedOutgoingMessage, PluginType } from '../../types';
import { BasePlugin } from '../BasePlugin';
import { getDefaultExtension, getMediaExtract, splitMessage, stripMarkdownToPlain, toUnifiedIncomingMessage, toWeChatSendPayload } from './WeChatAdapter';
import { WeChatApiClient } from './WeChatApiClient';
import { WeChatContextTokenStore } from './WeChatContextTokenStore';
import { encryptAesEcb, generateAesKey } from './WeChatCrypto';
import type { WeChatMessage, WeChatMessageItem } from './types';
import { MessageItemType, MessageItemType as MIT, UploadMediaType, WECHAT_CDN_BASE_URL, WECHAT_MESSAGE_LIMIT, WECHAT_SESSION_EXPIRED_CODE, WECHAT_SESSION_PAUSE_MS } from './types';

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

  // Media workspace
  private mediaDir: string | null = null;

  // Cross-batch message merging: cache pending messages for short-time merging
  // WeChat sometimes splits text+file into separate getUpdates calls
  private pendingUserMessages: Map<string, { msg: WeChatMessage; receivedAt: number }> = new Map();
  private pendingMessageTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly PENDING_MESSAGE_TIMEOUT_MS = 3000; // 3 seconds to wait for possible companion message

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

    // Clear pending message timers
    for (const timer of this.pendingMessageTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingMessageTimers.clear();
    this.pendingUserMessages.clear();

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

    // Build message items
    const items: WeChatMessageItem[] = [];

    // Handle image attachment
    if (message.imageUrl) {
      const imageItem = await this.uploadMedia(message.imageUrl, UploadMediaType.IMAGE, userId);
      if (imageItem) items.push(imageItem);
    }

    // Handle file attachment
    if (message.fileUrl) {
      const fileItem = await this.uploadMedia(message.fileUrl, UploadMediaType.FILE, userId);
      if (fileItem) items.push(fileItem);
    }

    // Handle text content
    const text = stripMarkdownToPlain(message.text || '');

    // Send each item as its own request (text first, then media)
    // Reference: photon-hq/wechat-ilink-client/src/media/send.ts
    if (text.trim()) {
      const chunks = splitMessage(text, WECHAT_MESSAGE_LIMIT);
      for (const chunk of chunks) {
        const textPayload = toWeChatSendPayload(userId, { type: 'text', text: chunk }, contextToken);
        await this.apiClient.sendMessage(textPayload);
      }
    }

    // Send each media item separately
    for (const item of items) {
      const clientId = `sudowork-wechat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const mediaPayload = {
        msg: {
          from_user_id: '',
          to_user_id: userId,
          client_id: clientId,
          context_token: contextToken,
          message_type: 2, // MessageType.BOT
          message_state: 2, // MessageState.FINISH
          item_list: [item],
        },
      };
      console.log('[WeChatPlugin] sendMessage media item:', JSON.stringify(mediaPayload, null, 2));
      await this.apiClient.sendMessage(mediaPayload);
    }

    if (items.length === 0 && !text.trim()) {
      return `wechat_empty_${Date.now()}`;
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

        // Merge messages from same user (e.g., text + file sent together as separate messages)
        const mergedMsgs = this.mergeUserMessages(msgs);
        console.log(`[WeChatPlugin] After merge: ${mergedMsgs.length} messages`);

        for (const msg of mergedMsgs) {
          void this.handleIncomingMessage(msg);
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') break;
        await this.handlePollError(error);
      }
    }
  }

  /**
   * Merge user messages from the same batch that are likely sent together.
   *
   * WeChat sometimes splits a single user action (text + file) into multiple messages.
   * This method merges them back into one message to prevent duplicate AI responses.
   *
   * Merge conditions:
   * - Same from_user_id
   * - Time difference < 5 seconds
   * - One has text, another has only media items
   *
   * @param msgs - Raw messages from getUpdates
   * @returns Merged messages
   */
  private mergeUserMessages(msgs: WeChatMessage[]): WeChatMessage[] {
    if (msgs.length <= 1) return msgs;

    const MERGE_TIME_THRESHOLD_MS = 5000; // 5 seconds
    const result: WeChatMessage[] = [];
    const userMsgMap = new Map<string, WeChatMessage[]>();

    // Group messages by user
    for (const msg of msgs) {
      const userId = msg.from_user_id || '';
      if (!userId) {
        result.push(msg);
        continue;
      }
      const group = userMsgMap.get(userId) || [];
      group.push(msg);
      userMsgMap.set(userId, group);
    }

    // Process each user's messages
    for (const [userId, userMsgs] of userMsgMap) {
      if (userMsgs.length === 1) {
        result.push(userMsgs[0]);
        continue;
      }

      // Sort by create_time_ms
      userMsgs.sort((a, b) => (a.create_time_ms || 0) - (b.create_time_ms || 0));

      // Try to merge consecutive messages
      const merged: WeChatMessage[] = [];
      for (const msg of userMsgs) {
        const lastMerged = merged[merged.length - 1];

        if (lastMerged && this.shouldMergeMessages(lastMerged, msg, MERGE_TIME_THRESHOLD_MS)) {
          // Merge msg into lastMerged
          lastMerged.item_list = [...(lastMerged.item_list || []), ...(msg.item_list || [])];
          // Keep the earlier context_token (usually from the first message)
          if (!lastMerged.context_token && msg.context_token) {
            lastMerged.context_token = msg.context_token;
          }
          console.log(`[WeChatPlugin] Merged messages for user ${userId}: text + media`);
        } else {
          merged.push(msg);
        }
      }

      result.push(...merged);
    }

    return result;
  }

  /**
   * Check if two messages should be merged.
   *
   * Conditions:
   * - Same user (already checked before calling)
   * - Time difference < threshold
   * - One has text item, another has only media items (no text)
   */
  private shouldMergeMessages(msg1: WeChatMessage, msg2: WeChatMessage, thresholdMs: number): boolean {
    // Check time difference
    const time1 = msg1.create_time_ms || 0;
    const time2 = msg2.create_time_ms || 0;
    if (Math.abs(time2 - time1) > thresholdMs) return false;

    // Check content types
    const hasText1 = this.messageHasTextItem(msg1);
    const hasText2 = this.messageHasTextItem(msg2);
    const hasMedia1 = this.messageHasMediaItem(msg1);
    const hasMedia2 = this.messageHasMediaItem(msg2);

    // Merge if one has text and another has only media (no text)
    // Case 1: msg1 has text, msg2 has only media
    if (hasText1 && !hasText2 && hasMedia2) return true;
    // Case 2: msg1 has only media, msg2 has text
    if (!hasText1 && hasMedia1 && hasText2) return true;

    return false;
  }

  /**
   * Check if a message has text item.
   */
  private messageHasTextItem(msg: WeChatMessage): boolean {
    return (msg.item_list || []).some((item) => item.type === MessageItemType.TEXT && item.text_item?.text?.trim());
  }

  /**
   * Check if a message has media item (non-text).
   */
  private messageHasMediaItem(msg: WeChatMessage): boolean {
    return (msg.item_list || []).some((item) => item.type !== undefined && item.type !== MessageItemType.NONE && item.type !== MessageItemType.TEXT);
  }

  /**
   * Download media files from WeChat CDN to local workspace.
   * Handles AES-128-ECB decryption using aes_key when present.
   * Sets `_localPath` on each item that was successfully downloaded.
   */
  private async downloadMediaItems(items: WeChatMessageItem[]): Promise<void> {
    if (!this.apiClient) return;

    const cdnBaseUrl = this.apiClient.getBaseUrl();

    for (const item of items) {
      const itemType = item.type ?? MessageItemType.NONE;
      if (itemType === MessageItemType.NONE || itemType === MessageItemType.TEXT) continue;

      // Extract URL and AES key info from the message item
      const mediaExtract = getMediaExtract(item, cdnBaseUrl);
      if (!mediaExtract) {
        console.warn(`[WeChatPlugin] No media URL available for item type=${itemType}`);
        continue;
      }

      try {
        // Ensure media directory exists
        if (!this.mediaDir) {
          const { getDataPath } = await import('@/process/utils');
          this.mediaDir = path.join(getDataPath(), 'channel-media', 'wechat');
          fs.mkdirSync(this.mediaDir, { recursive: true });
        }

        // Determine file name from file_item or generate one
        const ext = item.file_item?.file_name ? path.extname(item.file_item.file_name) : getDefaultExtension(itemType);
        const baseName = item.file_item?.file_name || `wechat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
        const filePath = path.join(this.mediaDir, baseName);

        // Download and decrypt (decryption is handled by the API client when AES key is present)
        const buffer = await this.apiClient.downloadMedia(mediaExtract.url, mediaExtract.aesKeyBase64, mediaExtract.aesKeyIsHex);
        fs.writeFileSync(filePath, buffer);

        item._localPath = filePath;
        console.log(`[WeChatPlugin] Downloaded media: type=${itemType}, size=${buffer.length}, encrypted=${!!mediaExtract.aesKeyBase64}, path=${filePath}`);
      } catch (error) {
        console.error(`[WeChatPlugin] Failed to download media for item type=${itemType}:`, error);
      }
    }
  }

  /**
   * Upload a local file to WeChat CDN and return the message item for sendMessage.
   *
   * Flow:
   * 1. Read file and compute MD5
   * 2. Generate AES key and encrypt content
   * 3. Call getUploadUrl to get CDN upload URL
   * 4. POST encrypted content to CDN, get downloadParam
   * 5. Construct message item with encrypt_query_param
   *
   * @param filePath - Local file path to upload
   * @param mediaType - UploadMediaType (IMAGE, FILE, VIDEO, VOICE)
   * @param userId - Target user ID for getUploadUrl
   * @returns WeChatMessageItem with media info, or null on failure
   */
  private async uploadMedia(filePath: string, mediaType: number, userId: string): Promise<WeChatMessageItem | null> {
    if (!this.apiClient) return null;

    try {
      // Read file content
      const rawContent = fs.readFileSync(filePath);
      const rawSize = rawContent.length;
      const rawMd5 = this.apiClient.computeMd5(rawContent);

      // Generate AES key
      const { hex: aesKeyHex, buffer: aesKeyBuffer } = generateAesKey();

      // Encrypt content
      const encryptedContent = encryptAesEcb(rawContent, aesKeyBuffer);
      const encryptedSize = encryptedContent.length;

      // Generate filekey (random 16-byte hex = 32 chars)
      const filekey = randomBytes(16).toString('hex');

      // Request upload URL
      const uploadResp = await this.apiClient.getUploadUrl({
        filekey,
        media_type: mediaType,
        to_user_id: userId,
        rawsize: rawSize,
        rawfilemd5: rawMd5,
        filesize: encryptedSize,
        no_need_thumb: true,
        aeskey: aesKeyHex,
      });

      console.log('[WeChatPlugin] getUploadUrl response:', JSON.stringify(uploadResp));

      if (uploadResp.errcode !== undefined && uploadResp.errcode !== 0) {
        console.error('[WeChatPlugin] getUploadUrl failed with errcode:', uploadResp.errcode, 'errmsg:', uploadResp.errmsg);
        return null;
      }

      const uploadParam = uploadResp.upload_param;
      if (!uploadParam) {
        console.error('[WeChatPlugin] getUploadUrl missing upload_param:', uploadResp);
        return null;
      }

      // Construct CDN upload URL: {cdnBaseUrl}/upload?encrypted_query_param={uploadParam}&filekey={filekey}
      // Reference: photon-hq/wechat-ilink-client/src/cdn/cdn-url.ts
      const cdnUploadUrl = `${WECHAT_CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`;

      console.log('[WeChatPlugin] CDN upload URL:', cdnUploadUrl);

      // Upload encrypted content to CDN
      const downloadParam = await this.apiClient.uploadToCdn(cdnUploadUrl, encryptedContent);

      // aes_key must be base64-encoded for message sending
      // photon-hq uses Buffer.from(aeskey) for all types (base64 of hex string as ASCII)
      // This yields ~44 chars base64, NOT ~24 chars from raw bytes
      const aesKeyBase64 = Buffer.from(aesKeyHex).toString('base64');

      // Construct message item based on media type
      const item: WeChatMessageItem = { type: uploadMediaTypeToItemType(mediaType) };

      if (mediaType === UploadMediaType.IMAGE) {
        item.image_item = {
          media: {
            encrypt_query_param: downloadParam,
            aes_key: aesKeyBase64,
            encrypt_type: 1,
          },
          mid_size: encryptedSize,
        };
      } else if (mediaType === UploadMediaType.FILE) {
        item.file_item = {
          media: {
            encrypt_query_param: downloadParam,
            aes_key: aesKeyBase64,
            encrypt_type: 1,
          },
          file_name: path.basename(filePath),
          len: String(rawSize),
        };
      } else if (mediaType === UploadMediaType.VIDEO) {
        item.video_item = {
          media: {
            encrypt_query_param: downloadParam,
            aes_key: aesKeyBase64,
            encrypt_type: 1,
          },
          video_size: encryptedSize,
        };
      } else if (mediaType === UploadMediaType.VOICE) {
        item.voice_item = {
          media: {
            encrypt_query_param: downloadParam,
            aes_key: aesKeyBase64,
            encrypt_type: 1,
          },
        };
      }

      console.log(`[WeChatPlugin] Uploaded media: type=${mediaType}, size=${rawSize}, encrypted=${encryptedSize}`);
      return item;
    } catch (error) {
      console.error('[WeChatPlugin] uploadMedia failed:', error);
      return null;
    }
  }

  private async handleIncomingMessage(msg: WeChatMessage): Promise<void> {
    const userId = msg.from_user_id || '';
    const itemTypes = (msg.item_list || []).map((item) => {
      if (item.type === MessageItemType.TEXT) return `TEXT:${item.text_item?.text?.slice(0, 30)}...`;
      return `${item.type}:${item.file_item?.file_name || 'unknown'}`;
    });
    console.log(`[WeChatPlugin] Incoming: from=${userId}, type=${msg.message_type}, items=${msg.item_list?.length}, itemTypes=[${itemTypes.join(', ')}], hasContextToken=${!!msg.context_token}`);

    // Store context token
    if (msg.context_token && userId) {
      this.tokenStore.set(this.accountId, userId, msg.context_token);
    }

    if (userId) this.activeUsers.add(userId);

    // Cross-batch message merging: check if there's a pending message for this user
    const pending = this.pendingUserMessages.get(userId);
    if (pending) {
      const canMerge = this.canMergeCrossBatch(pending.msg, msg);
      if (canMerge) {
        // Merge and process immediately
        console.log(`[WeChatPlugin] Cross-batch merge: combining pending + new message for user ${userId}`);
        this.clearPendingMessage(userId);

        // Download media for both messages
        if (pending.msg.item_list?.length) {
          await this.downloadMediaItems(pending.msg.item_list);
        }
        if (msg.item_list?.length) {
          await this.downloadMediaItems(msg.item_list);
        }

        // Merge item lists
        const mergedMsg: WeChatMessage = {
          ...msg,
          item_list: [...(pending.msg.item_list || []), ...(msg.item_list || [])],
          context_token: msg.context_token || pending.msg.context_token,
          create_time_ms: Math.min(pending.msg.create_time_ms || 0, msg.create_time_ms || 0),
        };

        // Process merged message
        const unified = toUnifiedIncomingMessage(mergedMsg);
        if (unified && this.messageHandler) {
          void this.messageHandler(unified).catch((error) => {
            console.error(`[WeChatPlugin] Message handler failed for merged message:`, error);
          });
        }
        return;
      } else {
        // Cannot merge, process pending message first
        console.log(`[WeChatPlugin] Cannot merge, processing pending message first for user ${userId}`);
        this.clearPendingMessage(userId);
        await this.processSingleMessage(pending.msg);
      }
    }

    // Check if this message should be cached for potential merging
    const shouldCache = this.shouldCacheForMerging(msg);
    if (shouldCache) {
      console.log(`[WeChatPlugin] Caching message for potential cross-batch merge: user=${userId}`);
      this.cachePendingMessage(userId, msg);
    } else {
      // Process immediately
      await this.processSingleMessage(msg);
    }
  }

  /**
   * Process a single message immediately (download + forward to handler)
   */
  private async processSingleMessage(msg: WeChatMessage): Promise<void> {
    // Download media items to local workspace before converting
    if (msg.item_list?.length) {
      await this.downloadMediaItems(msg.item_list);
    }

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
   * Check if two messages from different batches can be merged.
   * Merge if: one has text, another has only media (no text)
   */
  private canMergeCrossBatch(msg1: WeChatMessage, msg2: WeChatMessage): boolean {
    const hasText1 = this.messageHasTextItem(msg1);
    const hasText2 = this.messageHasTextItem(msg2);
    const hasMedia1 = this.messageHasMediaItem(msg1);
    const hasMedia2 = this.messageHasMediaItem(msg2);

    // Merge if one has text and another has only media (no text)
    if (hasText1 && !hasText2 && hasMedia2) return true;
    if (!hasText1 && hasMedia1 && hasText2) return true;

    return false;
  }

  /**
   * Check if a message should be cached for potential merging.
   * Cache if: message has only text OR only media (not both)
   */
  private shouldCacheForMerging(msg: WeChatMessage): boolean {
    const hasText = this.messageHasTextItem(msg);
    const hasMedia = this.messageHasMediaItem(msg);

    // Cache if message is "partial" (only text or only media)
    return (hasText && !hasMedia) || (!hasText && hasMedia);
  }

  /**
   * Cache a message for potential cross-batch merging.
   * Sets a timer to auto-process if no companion message arrives.
   */
  private cachePendingMessage(userId: string, msg: WeChatMessage): void {
    this.pendingUserMessages.set(userId, { msg, receivedAt: Date.now() });

    // Set timer to auto-process after timeout
    const timer = setTimeout(() => {
      const pending = this.pendingUserMessages.get(userId);
      if (pending) {
        console.log(`[WeChatPlugin] Pending message timeout, processing: user=${userId}`);
        this.pendingUserMessages.delete(userId);
        this.pendingMessageTimers.delete(userId);
        void this.processSingleMessage(pending.msg);
      }
    }, this.PENDING_MESSAGE_TIMEOUT_MS);

    this.pendingMessageTimers.set(userId, timer);
  }

  /**
   * Clear pending message and timer for a user.
   */
  private clearPendingMessage(userId: string): void {
    const timer = this.pendingMessageTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.pendingMessageTimers.delete(userId);
    }
    this.pendingUserMessages.delete(userId);
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

/**
 * Convert UploadMediaType to MessageItemType for constructing message items.
 */
function uploadMediaTypeToItemType(mediaType: number): number {
  switch (mediaType) {
    case UploadMediaType.IMAGE:
      return MIT.IMAGE;
    case UploadMediaType.VIDEO:
      return MIT.VIDEO;
    case UploadMediaType.FILE:
      return MIT.FILE;
    case UploadMediaType.VOICE:
      return MIT.VOICE;
    default:
      return MIT.NONE;
  }
}
