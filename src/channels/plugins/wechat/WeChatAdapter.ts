/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IUnifiedIncomingMessage, IUnifiedOutgoingMessage } from '../../types';
import type { IWeChatSendMessagePayload, WeChatMessage } from './types';
import { MessageItemType, MessageState, MessageType, WECHAT_MESSAGE_LIMIT } from './types';

let clientIdCounter = 0;

/**
 * Convert a WeChatMessage (from getUpdates) to a unified incoming message.
 * Only processes USER messages with text items in Phase 1.
 */
export function toUnifiedIncomingMessage(msg: WeChatMessage): IUnifiedIncomingMessage | null {
  // Only handle user messages
  if (msg.message_type !== MessageType.USER) {
    return null;
  }

  const userId = msg.from_user_id || '';
  if (!userId) return null;

  // Extract text from item_list
  const textParts: string[] = [];
  let hasMedia = false;

  for (const item of msg.item_list || []) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      textParts.push(item.text_item.text);
    } else if (item.type && item.type !== MessageItemType.NONE && item.type !== MessageItemType.TEXT) {
      hasMedia = true;
    }
  }

  const text = textParts.join('\n') || (hasMedia ? '[Media message — not yet supported. Please send text.]' : '');
  if (!text) return null;

  return {
    id: String(msg.message_id || msg.seq || Date.now()),
    platform: 'wechat',
    chatId: `user:${userId}`,
    user: {
      id: userId,
      displayName: userId,
    },
    content: {
      type: 'text',
      text,
    },
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
