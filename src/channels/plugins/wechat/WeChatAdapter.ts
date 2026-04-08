/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AttachmentType, IUnifiedAttachment, IUnifiedIncomingMessage, IUnifiedOutgoingMessage, MessageContentType } from '../../types';
import type { IWeChatSendMessagePayload, WeChatMessage, WeChatMessageItem } from './types';
import { MessageItemType, MessageState, MessageType, WECHAT_MESSAGE_LIMIT } from './types';

let clientIdCounter = 0;

/**
 * Extract the CDN download URL from a WeChat message item.
 * Checks image_item, voice_item, file_item, video_item for media.full_url.
 */
export function getMediaUrl(item: WeChatMessageItem): string | undefined {
  if (item.type === MessageItemType.IMAGE && item.image_item?.media?.full_url) {
    return item.image_item.media.full_url;
  }
  if (item.type === MessageItemType.VOICE && item.voice_item?.media?.full_url) {
    return item.voice_item.media.full_url;
  }
  if (item.type === MessageItemType.FILE && item.file_item?.media?.full_url) {
    return item.file_item.media.full_url;
  }
  if (item.type === MessageItemType.VIDEO && item.video_item?.media?.full_url) {
    return item.video_item.media.full_url;
  }
  return undefined;
}

/**
 * Map a WeChat MessageItemType to unified AttachmentType.
 */
function toAttachmentType(itemType: number): AttachmentType {
  switch (itemType) {
    case MessageItemType.IMAGE:
      return 'photo';
    case MessageItemType.VOICE:
      return 'voice';
    case MessageItemType.FILE:
      return 'document';
    case MessageItemType.VIDEO:
      return 'video';
    default:
      return 'document';
  }
}

/**
 * Map a WeChat MessageItemType to unified MessageContentType.
 */
function toContentType(itemType: number): MessageContentType {
  switch (itemType) {
    case MessageItemType.IMAGE:
      return 'photo';
    case MessageItemType.VOICE:
      return 'voice';
    case MessageItemType.FILE:
      return 'document';
    case MessageItemType.VIDEO:
      return 'video';
    default:
      return 'text';
  }
}

/**
 * Get a default file extension for a media item type.
 */
function getDefaultExtension(itemType: number): string {
  switch (itemType) {
    case MessageItemType.IMAGE:
      return '.jpg';
    case MessageItemType.VOICE:
      return '.mp3';
    case MessageItemType.FILE:
      return '';
    case MessageItemType.VIDEO:
      return '.mp4';
    default:
      return '';
  }
}

/**
 * Convert a WeChatMessage (from getUpdates) to a unified incoming message.
 * Handles text, image, voice, file, and video message items.
 */
export function toUnifiedIncomingMessage(msg: WeChatMessage): IUnifiedIncomingMessage | null {
  // Only handle user messages
  if (msg.message_type !== MessageType.USER) {
    return null;
  }

  const userId = msg.from_user_id || '';
  if (!userId) return null;

  // Extract text and media from item_list
  const textParts: string[] = [];
  const attachments: IUnifiedAttachment[] = [];
  let primaryMediaType: MessageContentType = 'text';

  for (const item of msg.item_list || []) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      textParts.push(item.text_item.text);
    } else if (item.type && item.type !== MessageItemType.NONE && item.type !== MessageItemType.TEXT) {
      // Media item — use local path (set by WeChatPlugin after download) or CDN URL
      const fileId = item._localPath || getMediaUrl(item) || '';
      if (fileId) {
        const attachment: IUnifiedAttachment = {
          type: toAttachmentType(item.type),
          fileId,
        };
        // Add optional metadata
        if (item.type === MessageItemType.FILE && item.file_item?.file_name) {
          attachment.fileName = item.file_item.file_name;
        }
        if (item.type === MessageItemType.IMAGE && item.image_item?.hd_size) {
          attachment.size = item.image_item.hd_size;
        }
        if (item.type === MessageItemType.VOICE && item.voice_item?.duration) {
          attachment.duration = item.voice_item.duration;
        }
        if (item.type === MessageItemType.VIDEO && item.video_item?.duration) {
          attachment.duration = item.video_item.duration;
        }
        attachments.push(attachment);
        // Use the first media item's type as the content type
        if (primaryMediaType === 'text') {
          primaryMediaType = toContentType(item.type);
        }
      }
    }
  }

  const hasAttachments = attachments.length > 0;
  const text = textParts.join('\n') || (hasAttachments ? `[${primaryMediaType} message]` : '');
  if (!text && !hasAttachments) return null;

  return {
    id: String(msg.message_id || msg.seq || Date.now()),
    platform: 'wechat',
    chatId: `user:${userId}`,
    user: {
      id: userId,
      displayName: userId,
    },
    content: {
      type: hasAttachments ? primaryMediaType : 'text',
      text,
      ...(hasAttachments && { attachments }),
    },
    timestamp: msg.create_time_ms || Date.now(),
    raw: msg,
  };
}

export { getDefaultExtension };

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
