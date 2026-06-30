/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageAction, IUnifiedIncomingMessage, IUnifiedMessageContent, IUnifiedOutgoingMessage, IUnifiedUser } from '../../types';
import type { AcpQuestionData } from '../../../common/chatLib';

/**
 * DingTalkAdapter - Converts between DingTalk and Unified message formats
 *
 * Handles:
 * - DingTalk Stream callback data -> UnifiedIncomingMessage
 * - UnifiedOutgoingMessage -> DingTalk send parameters
 * - User info extraction
 * - Card action handling
 */

// ==================== Constants ====================

/**
 * DingTalk message length limit (for markdown messages)
 */
export const DINGTALK_MESSAGE_LIMIT = 4000;

// ==================== Types ====================

/**
 * DingTalk Stream callback message data
 */
export interface DingTalkStreamMessage {
  conversationId?: string;
  atUsers?: Array<{
    dingtalkId?: string;
    staffId?: string;
  }>;
  chatbotCorpId?: string;
  chatbotUserId?: string;
  msgId?: string;
  senderNick?: string;
  isAdmin?: boolean;
  senderStaffId?: string;
  sessionWebhookExpiredTime?: number;
  createAt?: number;
  senderCorpId?: string;
  conversationType?: string; // '1' = private, '2' = group
  msgtype?: string;
  text?: {
    content?: string;
  };
  richText?: {
    richTextList?: Array<{
      text?: string;
      type?: string;
    }>;
  };
  picture?: {
    downloadCode?: string;
    photoURL?: string;
    _localPath?: string;
  };
  audio?: {
    downloadCode?: string;
    duration?: string;
    recognition?: string;
    _localPath?: string;
  };
  video?: {
    downloadCode?: string;
    duration?: string;
    videoType?: string;
    _localPath?: string;
  };
  file?: {
    downloadCode?: string;
    fileName?: string;
    fileSize?: string;
    _localPath?: string;
  };
  /** Stream callback content field (actual location of media downloadCode in newer API) */
  content?: {
    downloadCode?: string;
    pictureDownloadCode?: string;
    fileName?: string;
    fileSize?: string;
    duration?: string;
    recognition?: string;
    _localPath?: string;
    /** richText message items (DingTalk places richText array here for richText msgtype) */
    richText?: DingTalkRichTextItem[];
  };
  sessionWebhook?: string;
  robotCode?: string;
}

/**
 * DingTalk card action callback data
 */
export interface DingTalkCardActionData {
  outTrackId?: string;
  userId?: string;
  content?: {
    cardPrivateData?: {
      actionIds?: string[];
      params?: Record<string, string>;
    };
  };
}

// ==================== Incoming Message Conversion ====================

/**
 * Media message types supported by DingTalk robot.
 */
const DINGTALK_MEDIA_TYPES = new Set(['picture', 'audio', 'video', 'file']);

/**
 * A single item in a DingTalk richText message.
 * Items can be text or picture type.
 * Per DingTalk docs, picture items include downloadCode/pictureDownloadCode.
 */
export interface DingTalkRichTextItem {
  text?: string;
  downloadCode?: string;
  pictureDownloadCode?: string;
  type?: string; // 'text' | 'picture'
}

/**
 * Extract richText items from a DingTalk message, trying multiple data paths:
 * 1. content.richText (DingTalk Stream API actual path per official docs)
 * 2. richText.richTextList (legacy/alternative path)
 * 3. richText as a direct array
 */
function getRichTextItems(data: DingTalkStreamMessage): DingTalkRichTextItem[] {
  if (data.content?.richText && Array.isArray(data.content.richText)) {
    return data.content.richText;
  }
  if (data.richText?.richTextList) {
    return data.richText.richTextList;
  }
  if (Array.isArray((data as any).richText)) {
    return (data as any).richText;
  }
  return [];
}

/**
 * Extract downloadCode and fileName from a DingTalk message if it contains media.
 * Returns null for non-media message types.
 */
export function extractMediaDownloadInfo(data: DingTalkStreamMessage): { downloadCode: string; fileName?: string } | null {
  const msgtype = data.msgtype;
  if (!msgtype) {
    return null;
  }

  // richText messages may contain picture items with downloadCode
  if (msgtype === 'richText') {
    const items = getRichTextItems(data);
    const pictureItem = items.find((item) => item.downloadCode && (item.type === 'picture' || !!item.pictureDownloadCode));
    if (pictureItem?.downloadCode) {
      return { downloadCode: pictureItem.downloadCode };
    }
    return null;
  }

  if (!DINGTALK_MEDIA_TYPES.has(msgtype)) {
    return null;
  }

  let downloadCode: string | undefined;
  let fileName: string | undefined;

  switch (msgtype) {
    case 'picture':
      downloadCode = data.picture?.downloadCode || data.content?.downloadCode || data.content?.pictureDownloadCode;
      break;
    case 'audio':
      downloadCode = data.audio?.downloadCode || data.content?.downloadCode;
      break;
    case 'video':
      downloadCode = data.video?.downloadCode || data.content?.downloadCode;
      break;
    case 'file':
      downloadCode = data.file?.downloadCode || data.content?.downloadCode;
      fileName = data.file?.fileName || data.content?.fileName;
      break;
  }

  if (!downloadCode) {
    return null;
  }

  return { downloadCode, fileName };
}

/**
 * Set _localPath on the appropriate media field of a DingTalk message.
 */
export function setMediaLocalPath(data: DingTalkStreamMessage, localPath: string): void {
  switch (data.msgtype) {
    case 'richText':
      if (data.content) data.content._localPath = localPath;
      break;
    case 'picture':
      if (data.picture) data.picture._localPath = localPath;
      if (data.content) data.content._localPath = localPath;
      break;
    case 'audio':
      if (data.audio) data.audio._localPath = localPath;
      if (data.content) data.content._localPath = localPath;
      break;
    case 'video':
      if (data.video) data.video._localPath = localPath;
      if (data.content) data.content._localPath = localPath;
      break;
    case 'file':
      if (data.file) data.file._localPath = localPath;
      if (data.content) data.content._localPath = localPath;
      break;
  }
}

/**
 * Map a DingTalk msgtype to a default file extension.
 */
export function getDefaultExtension(msgtype: string | undefined): string {
  switch (msgtype) {
    case 'picture':
      return '.jpg';
    case 'richText':
      return '.jpg'; // richText with picture items
    case 'audio':
      return '.amr';
    case 'video':
      return '.mp4';
    case 'file':
      return '';
    default:
      return '';
  }
}

/**
 * Map a DingTalk msgtype to a default MIME type.
 */
export function getDefaultMimeType(msgtype: string | undefined): string {
  switch (msgtype) {
    case 'picture':
      return 'image/jpeg';
    case 'audio':
      return 'audio/amr';
    case 'video':
      return 'video/mp4';
    case 'file':
      return 'application/octet-stream';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Encode chatId based on conversation type
 * Private chat: user:{senderStaffId}
 * Group chat: group:{conversationId}
 */
export function encodeChatId(data: DingTalkStreamMessage): string {
  if (data.conversationType === '1') {
    // Private chat
    return `user:${data.senderStaffId || data.chatbotUserId || ''}`;
  }
  // Group chat
  return `group:${data.conversationId || ''}`;
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
 * Convert DingTalk Stream callback data to unified incoming message
 */
export function toUnifiedIncomingMessage(data: DingTalkStreamMessage, actionInfo?: IMessageAction): IUnifiedIncomingMessage | null {
  // Handle card action
  if (actionInfo) {
    const userId = data.senderStaffId || '';
    const chatId = encodeChatId(data);

    return {
      id: data.msgId || Date.now().toString(),
      platform: 'dingtalk',
      chatId,
      user: {
        id: userId,
        displayName: data.senderNick || `User ${userId.slice(-6)}`,
      },
      content: {
        type: 'action',
        text: actionInfo.name,
      },
      action: actionInfo,
      timestamp: data.createAt || Date.now(),
      raw: data,
    };
  }

  // Handle regular message
  if (!data.senderStaffId && !data.chatbotUserId) return null;

  const user = toUnifiedUser(data);
  if (!user) return null;

  const content = extractMessageContent(data);
  const chatId = encodeChatId(data);

  return {
    id: data.msgId || Date.now().toString(),
    platform: 'dingtalk',
    chatId,
    user,
    content,
    timestamp: data.createAt || Date.now(),
    raw: data,
  };
}

/**
 * Convert DingTalk sender info to unified user format
 */
export function toUnifiedUser(data: DingTalkStreamMessage): IUnifiedUser | null {
  const userId = data.senderStaffId || '';
  if (!userId) return null;

  return {
    id: userId,
    displayName: data.senderNick || `User ${userId.slice(-6)}`,
  };
}

/**
 * Extract message content from DingTalk message
 */
function extractMessageContent(data: DingTalkStreamMessage): IUnifiedMessageContent {
  const msgtype = data.msgtype;

  switch (msgtype) {
    case 'text': {
      let text = data.text?.content || '';
      // Remove @bot mentions in group chats
      if (data.conversationType === '2') {
        text = text.replace(/@\S+\s*/g, '').trim();
      }
      return { type: 'text', text };
    }

    case 'richText': {
      const items = getRichTextItems(data);
      const textParts: string[] = [];
      const pictureCodes: Array<{ downloadCode: string }> = [];

      for (const item of items) {
        if (item.text) {
          textParts.push(item.text);
        }
        if (item.downloadCode && (item.type === 'picture' || !!item.pictureDownloadCode)) {
          pictureCodes.push({ downloadCode: item.downloadCode });
        }
      }

      let text = textParts.join('');
      if (data.conversationType === '2') {
        text = text.replace(/@\S+\s*/g, '').trim();
      }

      if (pictureCodes.length > 0) {
        const fileId = data.content?._localPath || pictureCodes[0].downloadCode;
        return {
          type: 'photo',
          text,
          attachments: [{ type: 'photo', fileId }],
        };
      }

      return { type: 'text', text };
    }

    case 'picture':
      return {
        type: 'photo',
        text: '',
        attachments: [
          {
            type: 'photo',
            fileId: data.picture?._localPath || data.content?._localPath || data.picture?.downloadCode || data.content?.downloadCode || '',
          },
        ],
      };

    case 'audio':
      return {
        type: 'audio',
        text: data.audio?.recognition || data.content?.recognition || '',
        attachments: [
          {
            type: 'audio',
            fileId: data.audio?._localPath || data.content?._localPath || data.audio?.downloadCode || data.content?.downloadCode || '',
            duration: data.audio?.duration ? parseInt(data.audio.duration, 10) : data.content?.duration ? parseInt(data.content.duration, 10) : undefined,
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
            fileId: data.video?._localPath || data.content?._localPath || data.video?.downloadCode || data.content?.downloadCode || '',
            duration: data.video?.duration ? parseInt(data.video.duration, 10) : data.content?.duration ? parseInt(data.content.duration, 10) : undefined,
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
            fileId: data.file?._localPath || data.content?._localPath || data.file?.downloadCode || data.content?.downloadCode || '',
            fileName: data.file?.fileName || data.content?.fileName,
            size: data.file?.fileSize ? parseInt(data.file.fileSize, 10) : data.content?.fileSize ? parseInt(data.content.fileSize, 10) : undefined,
          },
        ],
      };

    default:
      return { type: 'text', text: '' };
  }
}

// ==================== Outgoing Message Conversion ====================

/**
 * DingTalk send content types
 */
export type DingTalkContentType = 'text' | 'markdown' | 'actionCard';

/**
 * Convert unified outgoing message to DingTalk send parameters
 */
export function toDingTalkSendParams(message: IUnifiedOutgoingMessage): {
  contentType: DingTalkContentType;
  content: Record<string, unknown>;
  rawText?: string;
} {
  // If message has replyMarkup (card), send as actionCard
  if (message.replyMarkup) {
    return {
      contentType: 'actionCard',
      content: message.replyMarkup as Record<string, unknown>,
    };
  }

  // If message has buttons, convert to actionCard
  if (message.buttons && message.buttons.length > 0) {
    const card = buildActionCard(message.text || '', message.buttons);
    return {
      contentType: 'actionCard',
      content: card,
    };
  }

  // Default to markdown message
  const text = message.text || '';
  return {
    contentType: 'markdown',
    content: {
      title: 'Message',
      text,
    },
    rawText: text,
  };
}

/**
 * Build an action card with buttons
 */
function buildActionCard(text: string, buttons: IUnifiedOutgoingMessage['buttons']): Record<string, unknown> {
  const markdownText = convertHtmlToDingTalkMarkdown(text);
  const btnList: Array<Record<string, unknown>> = [];

  if (buttons && buttons.length > 0) {
    buttons.forEach((row) => {
      row.forEach((button) => {
        btnList.push({
          title: button.label,
          actionURL: `dingtalk://dingtalkclient/action/openAppAction?action=${encodeURIComponent(button.action)}&params=${encodeURIComponent(JSON.stringify(button.params || {}))}`,
        });
      });
    });
  }

  return {
    title: 'Message',
    text: markdownText,
    btnOrientation: '1', // Horizontal layout
    btns: btnList,
  };
}

// ==================== ACP Question (dtmd buttons) ====================

/**
 * Build DingTalk markdown with dtmd buttons for an ACP question item.
 *
 * dtmd links make the DingTalk client send the option label back as a plain
 * TOPIC_ROBOT message when tapped, so the bot receives the answer without any
 * cardTemplate — end users only configure the bot (clientId/secret), never the
 * DingTalk backend. (Verified in step 0: tapped content arrives verbatim.)
 *
 * 为 ACP 选项题构造带 dtmd 按钮的钉钉 markdown。支持 single_select /
 * multi_select（boolean 视作 single_select）；text 降级为纯文本提示。
 * 多题问答（items.length > 1）由调用方按 itemIndex 逐题分发渲染。
 */
export function buildDingTalkQuestionMarkdown(content: AcpQuestionData, itemIndex = 0): { markdown: string; isSupported: boolean } {
  const items = content.items ?? [];
  const item = items[itemIndex];
  const kind = item?.kind;
  const isSupported = !!item && (kind === 'single_select' || kind === 'multi_select' || kind === 'boolean');

  if (!isSupported) {
    const questionText = content.question || item?.prompt || '请回答';
    return {
      markdown: `${questionText}\n\n此题型暂不支持按钮选择，请直接文字说明。`,
      isSupported: false,
    };
  }

  const lines: string[] = [];
  if (items.length > 1) {
    lines.push(`**第 ${itemIndex + 1} / ${items.length} 题**`);
    const header = content.intro || content.question;
    if (header) lines.push(header);
    lines.push(item.prompt || '请选择');
  } else {
    lines.push(content.question || item.prompt || '请选择');
  }
  lines.push('');
  for (const option of item.options ?? []) {
    lines.push(`- [${option.label}](dtmd://dingtalkclient/sendMessage?content=${encodeURIComponent(option.label)})`);
  }
  if (kind === 'multi_select') {
    lines.push('', `- [✅ 提交](dtmd://dingtalkclient/sendMessage?content=${encodeURIComponent('__qa_submit__')})`);
  }

  return { markdown: lines.join('\n'), isSupported: true };
}

// ==================== Text Formatting ====================

/**
 * Convert HTML to DingTalk markdown format
 * DingTalk supports a subset of markdown
 *
 * Security measures:
 * - Decodes only safe HTML entities
 * - Does NOT decode `<`, `>`, `&` to prevent tag injection
 * - Uses protocol whitelist for links
 * - Case-insensitive matching
 */
export function convertHtmlToDingTalkMarkdown(html: string): string {
  let result = html;

  // 1. Decode safe HTML entities
  result = result
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));

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
 * Escape special characters for DingTalk markdown
 */
export function escapeDingTalkMarkdown(text: string): string {
  return text.replace(/[\\*_`[\]()~]/g, '\\$&');
}

// ==================== Message Length Utilities ====================

/**
 * Split long text into chunks that fit DingTalk's message limit
 */
export function splitMessage(text: string, maxLength: number = DINGTALK_MESSAGE_LIMIT): string[] {
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

// ==================== Card Action Utilities ====================

/**
 * Build card action value object
 */
export function buildCardActionValue(action: string, params?: Record<string, string>): Record<string, string> {
  return {
    action,
    ...params,
  };
}

/**
 * Map action prefix to valid ActionCategory
 */
function mapToActionCategory(prefix: string): 'platform' | 'system' | 'chat' {
  if (prefix === 'pairing') return 'platform';
  if (prefix === 'chat') return 'chat';
  return 'system';
}

/**
 * Extract action info from DingTalk card callback
 */
export function extractCardAction(params: Record<string, string>): IMessageAction | null {
  const actionName = params.action || '';
  if (!actionName) return null;

  // Parse action name and params
  // Format: "category.action" or "category.action:param1=value1"
  const [fullAction, paramsStr] = actionName.split(':');
  const [prefix, name] = fullAction.includes('.') ? fullAction.split('.') : ['system', fullAction];

  const actionParams: Record<string, string> = {};
  if (paramsStr) {
    paramsStr.split(',').forEach((param) => {
      const [key, val] = param.split('=');
      if (key && val) {
        actionParams[key] = val;
      }
    });
  }

  // Merge with other action values
  Object.entries(params).forEach(([key, val]) => {
    if (key !== 'action' && typeof val === 'string') {
      actionParams[key] = val;
    }
  });

  return {
    type: mapToActionCategory(prefix),
    name: `${prefix}.${name}`,
    params: actionParams,
  };
}

// ==================== Media Upload Helpers ====================

/**
 * DingTalk upload API supported image extensions
 * https://open.dingtalk.com/document/orgapp/upload-media-files
 */
const DINGTALK_UPLOAD_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'gif', 'png', 'bmp']);

/**
 * Map file extension to DingTalk sampleFile fileType parameter.
 * https://open.dingtalk.com/document/development/robot-message-type
 * Official supported: xlsx, pdf, zip, rar, doc, docx
 */
const DINGTALK_FILE_TYPE_MAP: Record<string, string> = {
  pdf: 'pdf',
  doc: 'doc',
  docx: 'doc',
  xls: 'xlsx',
  xlsx: 'xlsx',
  ppt: 'ppt',
  pptx: 'ppt',
  zip: 'zip',
  rar: 'rar',
};

/**
 * Determine upload media type based on file extension.
 * Only returns 'image' for extensions DingTalk upload API explicitly supports as image type.
 * All other extensions default to 'file'.
 */
export function getUploadMediaType(fileName: string): 'image' | 'file' {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return DINGTALK_UPLOAD_IMAGE_EXTENSIONS.has(ext) ? 'image' : 'file';
}

/**
 * Map file extension to DingTalk sampleFile fileType parameter.
 * Falls back to 'pdf' for unknown extensions.
 */
export function getDingTalkFileType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return DINGTALK_FILE_TYPE_MAP[ext] || 'pdf';
}
