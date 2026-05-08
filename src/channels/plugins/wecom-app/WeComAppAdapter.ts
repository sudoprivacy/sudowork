/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IUnifiedIncomingMessage, IUnifiedMessageContent, IUnifiedOutgoingMessage, IUnifiedUser } from '../../types';
import { convertHtmlToWeComMarkdown } from '../wecom/WeComAdapter';

/**
 * WeCom 自建应用 callback adapter.
 *
 * Parses the XML payload from callback messages, and converts unified outgoing
 * messages to qyapi send-message parameters.
 *
 * Incoming callback XML (after decryption) for a text message:
 *   <xml>
 *     <ToUserName>corpId</ToUserName>
 *     <FromUserName>userid</FromUserName>
 *     <CreateTime>1234567890</CreateTime>
 *     <MsgType>text</MsgType>
 *     <Content>hello</Content>
 *     <MsgId>...</MsgId>
 *     <AgentID>10002</AgentID>
 *   </xml>
 *
 * For images/files, the payload includes a MediaId that must be downloaded
 * separately via media/get.
 *
 * For approval events the envelope is:
 *   <MsgType>event</MsgType>
 *   <Event>sys_approval_change | open_approval_change</Event>
 *   <ApprovalInfo>...</ApprovalInfo>
 */

export interface WeComAppCallbackXml {
  ToUserName: string; // corpId
  FromUserName: string; // userid (for chat msgs) or sender for events
  CreateTime: string;
  MsgType: string; // text, image, voice, video, file, location, link, event
  MsgId?: string;
  AgentID?: string;
  Content?: string;
  MediaId?: string;
  PicUrl?: string;
  Format?: string;
  Recognition?: string;
  Title?: string;
  Description?: string;
  Url?: string;
  Location_X?: string;
  Location_Y?: string;
  Label?: string;
  Event?: string;
  EventKey?: string;
  // Approval (sys_approval_change)
  ApprovalInfo?: Record<string, unknown>;
  // Approval (open_approval_change)
  ApprovalData?: Record<string, unknown>;
  // Free-form extras
  [key: string]: unknown;
}

/**
 * A light-weight XML parser sufficient for WeCom callback payloads.
 *
 * WeCom payloads are flat: one-level elements under <xml>, with CDATA values.
 * ApprovalInfo is nested; we parse it recursively into an object / array
 * structure where repeated sibling names (e.g. <SpStatus>) become arrays.
 */
export function parseCallbackXml(xml: string): WeComAppCallbackXml {
  // Strip XML declaration
  const trimmed = xml.replace(/<\?xml[^?]*\?>/i, '').trim();
  const rootMatch = trimmed.match(/<xml>([\s\S]*)<\/xml>/i);
  const body = rootMatch ? rootMatch[1] : trimmed;
  const parsed = parseElementBody(body) as Record<string, unknown>;
  return parsed as WeComAppCallbackXml;
}

/**
 * Parse the body of an XML element into a plain object. Nested elements are
 * parsed recursively; repeated sibling names collect into arrays. Text content
 * (CDATA or plain) is returned as a string when no child elements are present.
 */
function parseElementBody(body: string): unknown {
  const trimmedBody = body.trim();
  if (!trimmedBody) return '';

  // If there are no child tags, treat as a leaf value (with optional CDATA)
  if (!/<[a-zA-Z][^>]*>/.test(trimmedBody)) {
    return unwrapCdata(trimmedBody);
  }

  const result: Record<string, unknown> = {};
  const tagRe = /<([a-zA-Z_][\w-]*)>([\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(trimmedBody)) !== null) {
    const name = match[1];
    const inner = parseElementBody(match[2]);
    if (Object.prototype.hasOwnProperty.call(result, name)) {
      const existing = result[name];
      if (Array.isArray(existing)) {
        existing.push(inner);
      } else {
        result[name] = [existing, inner];
      }
    } else {
      result[name] = inner;
    }
  }
  return result;
}

function unwrapCdata(value: string): string {
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) return cdata[1];
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ==================== Chat ID encoding ====================

/**
 * Encode a conversation id for a WeCom 自建应用 message.
 * Single chat (per-user): `{agentId}_{userid}` (e.g. `10002_zhuyx`).
 * Group chat: `{agentId}_chat_{chatid}`.
 */
export function encodeChatId(agentId: string, userid: string, chatid?: string): string {
  if (chatid) return `${agentId}_chat_${chatid}`;
  return `${agentId}_${userid}`;
}

/**
 * Parse a chatId produced by `encodeChatId`.
 */
export function parseChatId(chatId: string): { agentId: string; type: 'user' | 'group'; id: string } {
  const groupMatch = chatId.match(/^([^_]+)_chat_(.+)$/);
  if (groupMatch) {
    return { agentId: groupMatch[1], type: 'group', id: groupMatch[2] };
  }
  const singleMatch = chatId.match(/^([^_]+)_(.+)$/);
  if (singleMatch) {
    return { agentId: singleMatch[1], type: 'user', id: singleMatch[2] };
  }
  return { agentId: '', type: 'user', id: chatId };
}

// ==================== Callback -> Unified ====================

/**
 * Convert a parsed callback XML payload into a unified incoming message.
 *
 * Returns null for events we don't want to route as messages (approval events
 * are handled separately in the plugin).
 */
export function toUnifiedIncomingMessage(xml: WeComAppCallbackXml, opts?: { mediaLocalPath?: string }): IUnifiedIncomingMessage | null {
  const agentId = xml.AgentID ?? '';
  const userid = xml.FromUserName;
  if (!userid) return null;

  const user: IUnifiedUser = {
    id: userid,
    displayName: userid,
  };
  const chatId = encodeChatId(agentId, userid);
  const content = extractContent(xml, opts?.mediaLocalPath);

  return {
    id: xml.MsgId ?? `${xml.CreateTime}-${userid}`,
    platform: 'wecom-app',
    chatId,
    user,
    content,
    timestamp: xml.CreateTime ? Number(xml.CreateTime) * 1000 : Date.now(),
    raw: xml,
  };
}

function extractContent(xml: WeComAppCallbackXml, mediaLocalPath?: string): IUnifiedMessageContent {
  switch (xml.MsgType) {
    case 'text':
      return { type: 'text', text: xml.Content ?? '' };
    case 'image':
      return {
        type: 'photo',
        text: '',
        attachments: [
          {
            type: 'photo',
            fileId: mediaLocalPath ?? xml.MediaId ?? xml.PicUrl ?? '',
          },
        ],
      };
    case 'voice':
      return {
        type: 'voice',
        text: xml.Recognition ?? '',
        attachments: [
          {
            type: 'voice',
            fileId: mediaLocalPath ?? xml.MediaId ?? '',
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
            fileId: mediaLocalPath ?? xml.MediaId ?? '',
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
            fileId: mediaLocalPath ?? xml.MediaId ?? '',
            fileName: typeof xml.Title === 'string' ? xml.Title : undefined,
          },
        ],
      };
    case 'location':
      return {
        type: 'text',
        text: `[位置] ${xml.Label ?? ''} (${xml.Location_X ?? ''}, ${xml.Location_Y ?? ''})`.trim(),
      };
    case 'link':
      return {
        type: 'text',
        text: `[链接] ${xml.Title ?? ''}\n${xml.Url ?? ''}\n${xml.Description ?? ''}`.trim(),
      };
    default:
      return { type: 'text', text: '' };
  }
}

// ==================== Unified -> qyapi ====================

/**
 * Convert an outgoing unified message to a WeCom 自建应用 send-shape descriptor.
 *
 * The returned object tells the plugin which qyapi endpoint to hit. Media
 * messages carry a `source` path that the plugin uploads and substitutes for a
 * media_id before calling `message/send`.
 */
export type WeComAppSendDescriptor =
  | { kind: 'text'; content: string }
  | { kind: 'markdown'; content: string }
  | { kind: 'image'; source: string; sourceKind: 'local' | 'remote' }
  | { kind: 'file'; source: string; sourceKind: 'local' | 'remote'; fileName?: string }
  | { kind: 'template_card'; templateCard: Record<string, unknown> };

export function toSendDescriptor(message: IUnifiedOutgoingMessage): WeComAppSendDescriptor {
  if (message.type === 'image' && message.imageUrl) {
    return { kind: 'image', source: message.imageUrl, sourceKind: isRemote(message.imageUrl) ? 'remote' : 'local' };
  }
  if (message.type === 'file' && message.fileUrl) {
    return {
      kind: 'file',
      source: message.fileUrl,
      sourceKind: isRemote(message.fileUrl) ? 'remote' : 'local',
      fileName: message.fileName,
    };
  }
  // Default: text → markdown (WeCom text msgtype does not render markdown)
  const text = message.text ?? '';
  return { kind: 'markdown', content: convertHtmlToWeComMarkdown(text) };
}

function isRemote(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

/**
 * WeCom markdown length limit (bytes, not chars). We conservatively split by
 * character count, matching the existing WeCom bot adapter behavior.
 */
export const WECOM_APP_MSG_LIMIT = 4000;

export function splitMarkdown(text: string, maxLength = WECOM_APP_MSG_LIMIT): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let splitIndex = maxLength;
    const searchFloor = Math.floor(maxLength * 0.8);
    const nl = remaining.lastIndexOf('\n', maxLength);
    if (nl > searchFloor) {
      splitIndex = nl + 1;
    } else {
      const sp = remaining.lastIndexOf(' ', maxLength);
      if (sp > searchFloor) splitIndex = sp + 1;
    }
    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }
  return chunks;
}
