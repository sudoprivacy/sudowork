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

/** Image content within a message item */
export interface ImageItem {
  url?: string;
  image_id?: string;
  width?: number;
  height?: number;
}

/** Voice content within a message item */
export interface VoiceItem {
  url?: string;
  voice_id?: string;
  duration?: number;
}

/** File content within a message item */
export interface FileItem {
  url?: string;
  file_id?: string;
  file_name?: string;
  file_size?: number;
}

/** Video content within a message item */
export interface VideoItem {
  url?: string;
  video_id?: string;
  duration?: number;
  width?: number;
  height?: number;
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

/** downloadMedia response */
export interface IWeChatDownloadMediaResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  file_url?: string;
  file_data?: string; // base64-encoded file data
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
