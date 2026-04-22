/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AttachmentType, IUnifiedAttachment, IUnifiedIncomingMessage, IUnifiedOutgoingMessage, MessageContentType } from '../../types';
import type { IWeChatSendMessagePayload, WeChatMediaInfo, WeChatMessage, WeChatMessageItem } from './types';
import { MessageItemType, MessageState, MessageType, WECHAT_MESSAGE_LIMIT } from './types';

let clientIdCounter = 0;

/**
 * Media info extracted from a WeChat message item.
 */
export interface WeChatMediaExtract {
  /** The CDN download URL (full_url or constructed from encrypt_query_param) */
  url: string;
  /** Base64-encoded AES key for decryption (from media.aes_key), or null if absent */
  aesKeyBase64: string | null;
  /** Whether the AES key is hex-encoded (from ImageItem.aeskey) */
  aesKeyIsHex: boolean;
}

/**
 * Get the media info object from a WeChat message item.
 * Returns the first non-null media from image_item, voice_item, file_item, video_item.
 */
function getMediaInfo(item: WeChatMessageItem): WeChatMediaInfo | undefined {
  return item.image_item?.media || item.voice_item?.media || item.file_item?.media || item.video_item?.media;
}

/**
 * Build a CDN download URL from an encrypt_query_param value.
 * Used as a fallback when full_url is not available.
 */
function buildCdnDownloadUrl(media: WeChatMediaInfo, baseUrl: string): string | undefined {
  if (!media.encrypt_query_param) return undefined;
  return `${baseUrl}/download?encrypted_query_param=${encodeURIComponent(media.encrypt_query_param)}`;
}

/**
 * Extract the CDN download URL from a WeChat message item.
 * First checks full_url, then falls back to constructing from encrypt_query_param.
 *
 * @param item - The message item
 * @param cdnBaseUrl - Optional CDN base URL for encrypt_query_param fallback
 */
export function getMediaUrl(item: WeChatMessageItem, cdnBaseUrl?: string): string | undefined {
  const media = getMediaInfo(item);
  if (!media) return undefined;

  // Prefer full_url
  if (media.full_url) return media.full_url;

  // Fallback: construct from encrypt_query_param
  if (media.encrypt_query_param && cdnBaseUrl) {
    return buildCdnDownloadUrl(media, cdnBaseUrl);
  }

  return undefined;
}

/**
 * Extract media download info (URL + AES key) from a WeChat message item.
 * Handles the image-specific aeskey (hex) field and the standard media.aes_key (base64).
 *
 * @param item - The message item
 * @param cdnBaseUrl - Optional CDN base URL for encrypt_query_param fallback
 */
export function getMediaExtract(item: WeChatMessageItem, cdnBaseUrl?: string): WeChatMediaExtract | undefined {
  const url = getMediaUrl(item, cdnBaseUrl);
  if (!url) return undefined;

  // Image items have a separate hex-encoded aeskey field that takes priority
  if (item.image_item?.aeskey) {
    return {
      url,
      aesKeyBase64: item.image_item.aeskey,
      aesKeyIsHex: true,
    };
  }

  // Standard media.aes_key (base64-encoded)
  const media = getMediaInfo(item);
  return {
    url,
    aesKeyBase64: media?.aes_key || null,
    aesKeyIsHex: false,
  };
}

/**
 * Map a WeChat MessageItemType to a unified content type.
 */
function itemTypeToContentType(itemType: number): MessageContentType {
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
 * Map a WeChat MessageItemType to an attachment type.
 */
function itemTypeToAttachmentType(itemType: number): AttachmentType {
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
 * Get a default file extension based on item type.
 */
export function getDefaultExtension(itemType: number): string {
  switch (itemType) {
    case MessageItemType.IMAGE:
      return '.jpg';
    case MessageItemType.VOICE:
      return '.amr';
    case MessageItemType.FILE:
      return '';
    case MessageItemType.VIDEO:
      return '.mp4';
    default:
      return '';
  }
}

/**
 * Get default MIME type based on item type.
 */
function getDefaultMimeType(itemType: number): string {
  switch (itemType) {
    case MessageItemType.IMAGE:
      return 'image/jpeg';
    case MessageItemType.VOICE:
      return 'audio/amr';
    case MessageItemType.FILE:
      return 'application/octet-stream';
    case MessageItemType.VIDEO:
      return 'video/mp4';
    default:
      return 'application/octet-stream';
  }
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

  // Extract text and media from item_list
  const textParts: string[] = [];
  const attachments: IUnifiedAttachment[] = [];
  let contentType: MessageContentType = 'text';

  for (const item of msg.item_list || []) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      textParts.push(item.text_item.text);
    } else if (item.type && item.type !== MessageItemType.NONE && item.type !== MessageItemType.TEXT) {
      // Media item — use _localPath (set by WeChatPlugin after download) or CDN URL as fileId
      const fileId = item._localPath || getMediaUrl(item) || '';
      if (fileId) {
        const fileName = item.file_item?.file_name || undefined;
        attachments.push({
          type: itemTypeToAttachmentType(item.type),
          fileId,
          fileName,
          mimeType: getDefaultMimeType(item.type),
          size: item.image_item?.hd_size || item.file_item?.file_size || undefined,
          duration: item.voice_item?.voice_length || item.video_item?.video_length || undefined,
        });
        // Set the content type to the first media type encountered
        if (contentType === 'text') {
          contentType = itemTypeToContentType(item.type);
        }
      }
    }
  }

  const text = textParts.join('\n');

  // If no text and no attachments, nothing to process
  if (!text && attachments.length === 0) return null;

  return {
    id: String(msg.message_id || msg.seq || Date.now()),
    platform: 'wechat',
    chatId: `user:${userId}`,
    user: {
      id: userId,
      displayName: userId,
    },
    content: {
      type: contentType,
      text: text || (attachments.length > 0 ? '' : ''),
      attachments: attachments.length > 0 ? attachments : undefined,
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
 * Extract all image URLs from markdown text.
 * Matches `![alt](url)` patterns and returns the URLs.
 *
 * @param text - Markdown text that may contain image references
 * @returns Array of image URLs found in the markdown
 */
export function extractMarkdownImageUrls(text: string): string[] {
  const imageRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
  const urls: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = imageRegex.exec(text)) !== null) {
    const url = match[1].trim();
    if (url) urls.push(url);
  }
  return urls;
}

/**
 * Extract all file URLs from markdown links that point to downloadable files.
 * Matches `[text](url)` patterns where the URL ends with a known file extension.
 * Excludes image links (which are handled by extractMarkdownImageUrls).
 *
 * @param text - Markdown text that may contain file links
 * @returns Array of { url, fileName } for files found in the markdown
 */
export function extractMarkdownFileUrls(text: string): Array<{ url: string; fileName: string }> {
  // Match [text](url) but NOT ![text](url)
  const linkRegex = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;
  const fileExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.rar', '.7z', '.tar', '.gz', '.csv', '.txt', '.json', '.xml', '.yaml', '.yml', '.mp3', '.wav', '.mp4', '.avi', '.mov'];
  const files: Array<{ url: string; fileName: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(text)) !== null) {
    const linkText = match[1].trim();
    const url = match[2].trim();
    if (!url) continue;
    // Check if URL ends with a known file extension
    const urlLower = url.toLowerCase().split('?')[0]; // Remove query params for extension check
    const hasFileExt = fileExtensions.some((ext) => urlLower.endsWith(ext));
    if (hasFileExt) {
      // Use link text as filename if available, otherwise extract from URL
      // Split on both / and \ to handle Windows paths (e.g., C:\Users\docs\report.pdf)
      const fileName = linkText || url.split(/[/\\]/).pop()?.split('?')[0] || 'file';
      files.push({ url, fileName });
    }
  }
  return files;
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
