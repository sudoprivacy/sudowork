/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageAction, IUnifiedIncomingMessage, IUnifiedMessageContent, IUnifiedOutgoingMessage, IUnifiedUser } from '../../types';

/**
 * WeComAdapter - Converts between WeCom (WeChat Work) and Unified message formats
 *
 * Handles:
 * - WeCom WebSocket callback data -> UnifiedIncomingMessage
 * - UnifiedOutgoingMessage -> WeCom send parameters
 * - User info extraction
 */

// ==================== Constants ====================

/**
 * WeCom message length limit (for markdown messages)
 */
export const WECOM_MESSAGE_LIMIT = 4000;

// ==================== Types ====================

/**
 * WeCom WebSocket message callback body
 * Based on: https://developer.work.weixin.qq.com/document/path/101463
 */
export type WeComMsgCallback = {
  msgid: string;
  aibotid: string;
  chatid?: string;
  chattype: 'single' | 'group';
  from: { userid: string; name?: string };
  msgtype: string; // text | image | mixed | voice | file | video
  text?: { content: string };
  image?: { url: string; aeskey: string };
  mixed?: {
    items: Array<{
      /** Item type – WeCom may use "msgtype" or "type" depending on API version */
      msgtype?: string;
      /** Alternative item type field used by some WeCom API versions */
      type?: string;
      text?: { content: string };
      image?: { url: string; aeskey: string };
      /** Local file path after download+decrypt (set by WeComPlugin) */
      _localPath?: string;
    }>;
  };
  voice?: { content: string }; // voice-to-text transcription
  file?: { url: string; aeskey: string; filename?: string; filesize?: number };
  video?: { url: string; aeskey: string };
  /** Local file path for downloaded+decrypted image (set by WeComPlugin) */
  _imageLocalPath?: string;
  /** Local file path for downloaded+decrypted file (set by WeComPlugin) */
  _fileLocalPath?: string;
  /** Local file path for downloaded+decrypted video (set by WeComPlugin) */
  _videoLocalPath?: string;
};

/**
 * WeCom WebSocket event callback body
 */
export type WeComEventCallback = {
  event_type: string;
  aibotid: string;
  chatid?: string;
  chattype?: 'single' | 'group';
  from?: { userid: string; name?: string };
  template_card_event?: {
    response_code: string;
    task_id?: string;
  };
  feedback?: {
    msgid: string;
    type: 'like' | 'dislike';
  };
};

/**
 * WeCom outgoing message types supported by aibot_respond_msg / aibot_send_msg
 */
export type WeComOutgoingMsgType = 'text' | 'markdown' | 'stream' | 'template_card';

// ==================== Incoming Message Conversion ====================

/**
 * Encode chatId based on chat type
 * Single chat: user:{userid}
 * Group chat: group:{chatid}
 */
export function encodeChatId(msg: WeComMsgCallback): string {
  if (msg.chattype === 'single') {
    return `user:${msg.from.userid}`;
  }
  return `group:${msg.chatid || ''}`;
}

/**
 * Parse encoded chatId into type and id
 */
export function parseChatId(chatId: string): { type: 'user' | 'group'; id: string } {
  if (chatId.startsWith('user:')) {
    return { type: 'user', id: chatId.slice(5) };
  }
  if (chatId.startsWith('group:')) {
    return { type: 'group', id: chatId.slice(6) };
  }
  // Default to user
  return { type: 'user', id: chatId };
}

/**
 * Convert WeCom message callback to unified incoming message
 */
export function toUnifiedIncomingMessage(data: WeComMsgCallback, actionInfo?: IMessageAction): IUnifiedIncomingMessage | null {
  // Handle action
  if (actionInfo) {
    const userId = data.from.userid;
    const chatId = encodeChatId(data);

    return {
      id: data.msgid || Date.now().toString(),
      platform: 'wecom',
      chatId,
      user: {
        id: userId,
        displayName: data.from.name || `User ${userId.slice(-6)}`,
      },
      content: {
        type: 'action',
        text: actionInfo.name,
      },
      action: actionInfo,
      timestamp: Date.now(),
      raw: data,
    };
  }

  // Handle regular message
  if (!data.from?.userid) return null;

  const user = toUnifiedUser(data);
  if (!user) return null;

  const content = extractMessageContent(data);
  const chatId = encodeChatId(data);

  return {
    id: data.msgid || Date.now().toString(),
    platform: 'wecom',
    chatId,
    user,
    content,
    timestamp: Date.now(),
    raw: data,
  };
}

/**
 * Convert WeCom sender info to unified user format
 */
export function toUnifiedUser(data: WeComMsgCallback): IUnifiedUser | null {
  const userId = data.from?.userid;
  if (!userId) return null;

  return {
    id: userId,
    displayName: data.from.name || `User ${userId.slice(-6)}`,
  };
}

/**
 * Get default file extension for a WeCom message type.
 */
export function getDefaultExtension(msgtype: string): string {
  switch (msgtype) {
    case 'image':
      return '.jpg';
    case 'video':
      return '.mp4';
    case 'voice':
      return '.amr';
    case 'file':
      return '';
    default:
      return '';
  }
}

/**
 * Get the type of a mixed message item.
 * WeCom may use "msgtype" or "type" depending on the API version / endpoint.
 */
function getMixedItemType(item: NonNullable<WeComMsgCallback['mixed']>['items'][number]): string {
  return item.msgtype || item.type || '';
}

/**
 * Extract message content from WeCom message.
 *
 * Prefers local file paths (_localPath / _imageLocalPath / _fileLocalPath / _videoLocalPath)
 * when available (set by WeComPlugin after downloading and decrypting media).
 * Falls back to the original CDN URL if no local path is present.
 */
function extractMessageContent(data: WeComMsgCallback): IUnifiedMessageContent {
  const msgtype = data.msgtype;

  switch (msgtype) {
    case 'text': {
      let text = data.text?.content || '';
      // Remove @bot mentions in group chats
      if (data.chattype === 'group') {
        text = text.replace(/@\S+\s*/g, '').trim();
      }
      return { type: 'text', text };
    }

    case 'mixed': {
      // Mixed message: combine text parts and extract image attachments
      const textParts: string[] = [];
      const attachments: Array<{ type: 'photo'; fileId: string }> = [];

      const items = data.mixed?.items || [];
      if (items.length > 0) {
        console.log(`[WeComAdapter] mixed items (${items.length}): ${JSON.stringify(items.map((i) => ({ msgtype: i.msgtype, type: i.type, hasText: !!i.text, hasImage: !!i.image, hasLocalPath: !!i._localPath })))}`);
      }

      for (const item of items) {
        const itemType = getMixedItemType(item);
        if (itemType === 'text' && item.text?.content) {
          textParts.push(item.text.content);
        } else if (itemType === 'image') {
          // Prefer local path (after download+decrypt), fall back to URL
          const fileId = item._localPath || item.image?.url || '';
          if (fileId) {
            attachments.push({ type: 'photo', fileId });
          }
        }
      }

      let text = textParts.join('\n');
      if (data.chattype === 'group') {
        text = text.replace(/@\S+\s*/g, '').trim();
      }

      if (attachments.length > 0) {
        return { type: 'photo', text, attachments };
      }
      return { type: 'text', text };
    }

    case 'voice':
      // Voice messages include transcription
      return { type: 'text', text: data.voice?.content || '' };

    case 'image':
      return {
        type: 'photo',
        text: '',
        attachments: [
          {
            type: 'photo',
            // Prefer local path (after download+decrypt), fall back to URL
            fileId: data._imageLocalPath || data.image?.url || '',
          },
        ],
      };

    case 'file':
      return {
        type: 'document',
        text: '',
        attachments: [
          {
            type: 'document',
            // Prefer local path (after download+decrypt), fall back to URL
            fileId: data._fileLocalPath || data.file?.url || '',
            fileName: data.file?.filename,
            size: data.file?.filesize,
          },
        ],
      };

    case 'video':
      return {
        type: 'video',
        text: '',
        attachments: [
          {
            type: 'video',
            // Prefer local path (after download+decrypt), fall back to URL
            fileId: data._videoLocalPath || data.video?.url || '',
          },
        ],
      };

    default:
      return { type: 'text', text: '' };
  }
}

// ==================== Outgoing Message Conversion ====================

/**
 * Convert unified outgoing message to WeCom send parameters
 */
export function toWeComSendParams(message: IUnifiedOutgoingMessage): {
  msgtype: WeComOutgoingMsgType;
  content: string;
} {
  const text = message.text || '';

  // Default to markdown for rich text
  return {
    msgtype: 'markdown',
    content: convertHtmlToWeComMarkdown(text),
  };
}

// ==================== Text Formatting ====================

/**
 * Convert HTML to WeCom markdown format
 * WeCom supports a subset of markdown
 *
 * Security measures:
 * - Decodes only safe HTML entities
 * - Does NOT decode `<`, `>`, `&` to prevent tag injection
 * - Uses protocol whitelist for links
 * - Case-insensitive matching
 */
export function convertHtmlToWeComMarkdown(html: string): string {
  let result = html;

  // 1. Decode safe HTML entities
  result = result
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(parseInt(dec, 10)));

  // 2. Convert HTML tags to markdown (case-insensitive)
  result = result.replace(/<b>(.+?)<\/b>/gi, '**$1**');
  result = result.replace(/<strong>(.+?)<\/strong>/gi, '**$1**');
  result = result.replace(/<i>(.+?)<\/i>/gi, '*$1*');
  result = result.replace(/<em>(.+?)<\/em>/gi, '*$1*');
  result = result.replace(/<code>(.+?)<\/code>/gi, '`$1`');
  result = result.replace(/<pre><code>([\s\S]+?)<\/code><\/pre>/gi, '```\n$1\n```');

  // 3. Convert links with protocol whitelist
  result = result.replace(/<a href="([^"]+)">(.+?)<\/a>/gi, (_, url: string, text: string) => {
    const normalizedUrl = url.trim().toLowerCase();
    const isSafeUrl = /^(https?:\/\/|mailto:|\/)|^[^:]*$/.test(normalizedUrl);
    if (isSafeUrl) {
      return `[${text}](${url})`;
    }
    return text;
  });

  // 4. Remove all remaining HTML tags (loop until stable)
  let prevResult = '';
  while (prevResult !== result) {
    prevResult = result;
    result = result.replace(/<[^>]+>/g, '');
  }

  return result;
}

/**
 * Split long text into chunks that fit WeCom's message limit
 */
export function splitMessage(text: string, maxLength: number = WECOM_MESSAGE_LIMIT): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find a good split point (prefer newline, then space)
    let splitIndex = maxLength;

    const newlineSearchStart = Math.floor(maxLength * 0.8);
    const lastNewline = remaining.lastIndexOf('\n', maxLength);
    if (lastNewline > newlineSearchStart) {
      splitIndex = lastNewline + 1;
    } else {
      const lastSpace = remaining.lastIndexOf(' ', maxLength);
      if (lastSpace > newlineSearchStart) {
        splitIndex = lastSpace + 1;
      }
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  return chunks;
}
