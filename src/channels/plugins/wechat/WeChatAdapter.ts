/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IUnifiedAttachment, IUnifiedIncomingMessage, IUnifiedMessageContent, IUnifiedOutgoingMessage, MessageContentType } from '../../types';
import type { IWeChatSendMessagePayload, WeChatMessage, WeChatMessageItem } from './types';
import { MessageItemType, MessageState, MessageType, WECHAT_MESSAGE_LIMIT } from './types';

let clientIdCounter = 0;

/**
 * Extract a single attachment from a WeChat media message item.
 * Returns null for non-media or unsupported item types.
 */
function extractAttachment(item: WeChatMessageItem): IUnifiedAttachment | null {
  switch (item.type) {
    case MessageItemType.IMAGE: {
      const img = item.image_item;
      return {
        type: 'photo',
        fileId: img?.image_id || img?.url || item.msg_id || '',
        mimeType: 'image/jpeg',
      };
    }
    case MessageItemType.VOICE: {
      const voice = item.voice_item;
      return {
        type: 'voice',
        fileId: voice?.voice_id || voice?.url || item.msg_id || '',
        mimeType: 'audio/amr',
        duration: voice?.duration,
      };
    }
    case MessageItemType.FILE: {
      const file = item.file_item;
      return {
        type: 'document',
        fileId: file?.file_id || file?.url || item.msg_id || '',
        fileName: file?.file_name,
        size: file?.file_size,
      };
    }
    case MessageItemType.VIDEO: {
      const video = item.video_item;
      return {
        type: 'video',
        fileId: video?.video_id || video?.url || item.msg_id || '',
        mimeType: 'video/mp4',
        duration: video?.duration,
      };
    }
    default:
      return null;
  }
}

/**
 * Get the direct download URL for a media item (if available).
 * Returns the URL from the item's media sub-object.
 */
export function getMediaUrl(item: WeChatMessageItem): string | undefined {
  switch (item.type) {
    case MessageItemType.IMAGE:
      return item.image_item?.url;
    case MessageItemType.VOICE:
      return item.voice_item?.url;
    case MessageItemType.FILE:
      return item.file_item?.url;
    case MessageItemType.VIDEO:
      return item.video_item?.url;
    default:
      return undefined;
  }
}

/**
 * Get the file ID for a media item (used when no direct URL is available).
 */
export function getMediaFileId(item: WeChatMessageItem): string | undefined {
  switch (item.type) {
    case MessageItemType.IMAGE:
      return item.image_item?.image_id;
    case MessageItemType.VOICE:
      return item.voice_item?.voice_id;
    case MessageItemType.FILE:
      return item.file_item?.file_id;
    case MessageItemType.VIDEO:
      return item.video_item?.video_id;
    default:
      return undefined;
  }
}

/**
 * Determine the content type for a message based on its items.
 * Returns the most specific type; defaults to 'text'.
 */
function determineContentType(items: WeChatMessageItem[]): MessageContentType {
  for (const item of items) {
    switch (item.type) {
      case MessageItemType.IMAGE:
        return 'photo';
      case MessageItemType.VOICE:
        return 'voice';
      case MessageItemType.VIDEO:
        return 'video';
      case MessageItemType.FILE:
        return 'document';
    }
  }
  return 'text';
}

/**
 * Convert a WeChatMessage (from getUpdates) to a unified incoming message.
 * Supports text, image, voice, file, and video message items.
 */
export function toUnifiedIncomingMessage(msg: WeChatMessage): IUnifiedIncomingMessage | null {
  // Only handle user messages
  if (msg.message_type !== MessageType.USER) {
    return null;
  }

  const userId = msg.from_user_id || '';
  if (!userId) return null;

  const items = msg.item_list || [];

  // Extract text from text items (caption/text accompanying media)
  const textParts: string[] = [];
  const attachments: IUnifiedAttachment[] = [];

  for (const item of items) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      textParts.push(item.text_item.text);
    } else {
      const attachment = extractAttachment(item);
      if (attachment) {
        attachments.push(attachment);
      }
    }
  }

  const contentType = determineContentType(items);
  const text = textParts.join('\n') || (attachments.length > 0 ? '' : '');

  // Skip empty messages (no text and no attachments)
  if (!text && attachments.length === 0) return null;

  const content: IUnifiedMessageContent = {
    type: contentType,
    text,
    ...(attachments.length > 0 && { attachments }),
  };

  return {
    id: String(msg.message_id || msg.seq || Date.now()),
    platform: 'wechat',
    chatId: `user:${userId}`,
    user: {
      id: userId,
      displayName: userId,
    },
    content,
    timestamp: msg.create_time_ms || Date.now(),
    raw: msg,
  };
}

/**
 * Build a sendMessage payload from a unified outgoing message.
 */
export function toWeChatSendPayload(userId: string, message: IUnifiedOutgoingMessage, contextToken: string): IWeChatSendMessagePayload {
  const text = stripMarkdownToPlain(message.text || '');

  return {
    msg: {
      from_user_id: '',
      to_user_id: userId,
      client_id: `sudowork-wechat-${Date.now()}-${++clientIdCounter}`,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: contextToken || undefined,
      item_list: [
        {
          type: MessageItemType.TEXT,
          text_item: { text },
        },
      ],
    },
  };
}

/**
 * Strip HTML/Markdown markup to plain text.
 */
export function stripMarkdownToPlain(text: string): string {
  let result = text;
  // Code blocks: strip fences, keep code content
  result = result.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code) => (code as string).trim());
  // Inline code
  result = result.replace(/`([^`]+)`/g, '$1');
  // Images: remove entirely
  result = result.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  // Links: keep display text only
  result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Bold/italic
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, '$1');
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  result = result.replace(/\*(.+?)\*/g, '$1');
  result = result.replace(/__(.+?)__/g, '$1');
  result = result.replace(/_(.+?)_/g, '$1');
  result = result.replace(/~~(.+?)~~/g, '$1');
  // Headers
  result = result.replace(/^#{1,6}\s+/gm, '');
  // Blockquotes
  result = result.replace(/^>\s?/gm, '');
  // Horizontal rules
  result = result.replace(/^[-*_]{3,}$/gm, '');
  // Table separator rows
  result = result.replace(/^\|[\s:|-]+\|$/gm, '');
  // Table rows: extract cell text
  result = result.replace(/^\|(.+)\|$/gm, (_, row) =>
    (row as string)
      .split('|')
      .map((c: string) => c.trim())
      .join(' | ')
  );
  // HTML tags
  result = result.replace(/<br\s*\/?>/gi, '\n');
  result = result.replace(/<\/?(b|strong|i|em|u|s|code|pre|a|p|div|span|blockquote|h[1-6])[^>]*>/gi, '');
  // HTML entities
  result = result.replace(/&lt;/g, '<');
  result = result.replace(/&gt;/g, '>');
  result = result.replace(/&amp;/g, '&');
  result = result.replace(/&quot;/g, '"');
  result = result.replace(/&#39;/g, "'");
  result = result.replace(/&nbsp;/g, ' ');
  // Clean up whitespace
  result = result.replace(/\n{3,}/g, '\n\n');
  return result.trim();
}

/**
 * Split a long text message into chunks.
 */
export function splitMessage(text: string, limit: number = WECHAT_MESSAGE_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    let splitIndex = remaining.lastIndexOf('\n', limit);
    if (splitIndex < limit * 0.5) splitIndex = remaining.lastIndexOf(' ', limit);
    if (splitIndex < limit * 0.5) splitIndex = limit;
    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).replace(/^\n/, '');
  }

  return chunks;
}
