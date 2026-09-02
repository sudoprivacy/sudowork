/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

// ==================== iLink Bot API Types (protobuf-over-JSON) ====================

/** Common request metadata attached to every CGI request. */
export interface BaseInfo {
  channel_version?: string;
}

/** Message item types (from proto MessageItemType) */
export const MessageItemType = {
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

/** Message types (from proto MessageType) */
export const MessageType = {
  NONE: 0,
  USER: 1,
  BOT: 2,
} as const;

/** Message state (from proto MessageState) */
export const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const;

/** Text content within a message item */
export interface TextItem {
  text?: string;
}

/** Media info within image/voice/file/video items */
export interface WeChatMediaInfo {
  encrypt_query_param?: string;
  aes_key?: string;
  full_url?: string;
  /** 0 = only encrypt fileid, 1 = packed thumb/mid info */
  encrypt_type?: number;
}

/** Image content within a message item */
export interface ImageItem {
  aeskey?: string;
  media?: WeChatMediaInfo;
  mid_size?: number;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
  hd_size?: number;
}

/** Voice content within a message item */
export interface VoiceItem {
  media?: WeChatMediaInfo;
  voice_length?: number;
  voice_format?: string;
}

/** File content within a message item */
export interface FileItem {
  media?: WeChatMediaInfo;
  file_name?: string;
  md5?: string;
  /** File size as string */
  len?: string;
  file_size?: number;
  file_type?: string;
}

/** Video content within a message item */
export interface VideoItem {
  media?: WeChatMediaInfo;
  video_size?: number;
  play_length?: number;
  video_md5?: string;
  thumb_media?: WeChatMediaInfo;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
  video_length?: number;
  video_width?: number;
  video_height?: number;
}

/** A single item in a message (text, image, etc.) */
export interface WeChatMessageItem {
  type?: number;
  create_time_ms?: number;
  update_time_ms?: number;
  is_completed?: boolean;
  msg_id?: string;
  text_item?: TextItem;
  image_item?: ImageItem;
  voice_item?: VoiceItem;
  file_item?: FileItem;
  video_item?: VideoItem;
  /** Local file path set after media download (not from API) */
  _localPath?: string;
}

/** A full message from getUpdates */
export interface WeChatMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  update_time_ms?: number;
  session_id?: string;
  group_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: WeChatMessageItem[];
  context_token?: string;
}

/** getUpdates response */
export interface IWeChatGetUpdatesResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeChatMessage[];
  get_updates_buf?: string;
  /** @deprecated compat */
  sync_buf?: string;
  longpolling_timeout_ms?: number;
}

/** sendMessage request (wraps a single WeChatMessage) */
export interface IWeChatSendMessagePayload {
  msg?: WeChatMessage;
  base_info?: BaseInfo;
}

/** sendTyping request */
export interface IWeChatSendTypingPayload {
  ilink_user_id: string;
  typing_ticket?: string;
  status?: number;
  base_info?: BaseInfo;
}

/** getConfig response */
export interface IWeChatGetConfigResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  typing_ticket?: string;
}

// ==================== QR Login Types (flat response, different from API) ====================

/** QR code login - get QR code */
export interface IWeChatQrCodeResponse {
  qrcode?: string;
  qrcode_img_content?: string;
  errcode?: number;
  errmsg?: string;
}

/** QR code login - poll status */
export interface IWeChatQrStatusResponse {
  status?: 'wait' | 'scaned' | 'confirmed' | 'expired';
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  errcode?: number;
  errmsg?: string;
}

// ==================== Plugin Config ====================

export interface IWeChatCredentials {
  token: string;
  accountId: string;
  botApiBaseUrl?: string;
}

// ==================== Constants ====================

export const WECHAT_API_BASE_URL = 'https://ilinkai.weixin.qq.com';
export const WECHAT_LONG_POLL_TIMEOUT_MS = 35_000;
export const WECHAT_API_TIMEOUT_MS = 15_000;
export const WECHAT_MESSAGE_LIMIT = 4000;
export const WECHAT_SESSION_EXPIRED_CODE = -14;
export const WECHAT_SESSION_PAUSE_MS = 60 * 60 * 1000;
export const WECHAT_CHANNEL_VERSION = '1.0.0';

// ==================== Upload Types ====================

/** Media type for upload (getUploadUrl.media_type) */
export const UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const;

/** getUploadUrl request */
export interface IWeChatGetUploadUrlRequest {
  filekey?: string; // Random 16-byte hex (32 chars)
  media_type?: number; // 1=IMAGE, 2=VIDEO, 3=FILE, 4=VOICE
  to_user_id?: string; // Target user ID
  rawsize?: number; // Original file size (bytes)
  rawfilemd5?: string; // MD5 hash of original file (hex)
  filesize?: number; // Encrypted file size (rawsize + padding)
  no_need_thumb?: boolean; // Skip thumbnail upload URL
  aeskey?: string; // AES key (hex, 32 chars)
  base_info?: BaseInfo;
}

/** getUploadUrl response */
export interface IWeChatGetUploadUrlResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  upload_url?: string; // CDN URL to POST encrypted content (optional)
  upload_param?: string; // Encrypted upload parameter (base64) - used to construct CDN URL
  download_param?: string; // Pre-generated download param (optional)
}

/** CDN base URL for media upload/download */
export const WECHAT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';
