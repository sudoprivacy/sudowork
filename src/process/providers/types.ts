/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/storage';
import type { TMessage } from '@/common/chatLib';
import type { ICreateConversationParams, IBridgeResponse, ISendMessageParams } from '@/common/ipcBridge';

/**
 * Conversation Provider interface
 * 会话 Provider 接口
 *
 * Unified abstraction for conversation CRUD and message operations.
 * 会话 CRUD 和消息操作的统一抽象层。
 * Supports both local (database-backed) and remote (Moss Server) implementations.
 * 支持本地（数据库）和远程（Moss Server）两种实现。
 */
export interface IConversationProvider {
  /** Provider type identifier / Provider 类型标识 */
  readonly type: 'local' | 'remote';

  // ========== Conversation CRUD / 会话 CRUD ==========

  /**
   * Create a new conversation / 创建新会话
   * @param params Creation parameters (type, workspace, agent info, etc.) / 创建参数（类型、工作空间、Agent 信息等）
   * @returns The created conversation object / 创建的会话对象
   */
  createConversation(params: ICreateConversationParams): Promise<TChatConversation>;

  /**
   * Get conversation by ID / 根据 ID 获取会话
   * @param id Conversation ID / 会话 ID
   * @returns The conversation or undefined if not found / 会话对象，如果未找到则返回 undefined
   */
  getConversation(id: string): Promise<TChatConversation | undefined>;

  /**
   * Update conversation / 更新会话
   * @param id Conversation ID / 会话 ID
   * @param updates Partial updates to apply / 要应用的更新
   * @param mergeExtra Whether to merge extra field (default: false, replace) / 是否合并 extra 字段（默认：false，替换）
   * @returns Success status / 成功状态
   */
  updateConversation(id: string, updates: Partial<TChatConversation>, mergeExtra?: boolean): Promise<boolean>;

  /**
   * Delete conversation / 删除会话
   * @param id Conversation ID / 会话 ID
   * @returns Success status / 成功状态
   */
  deleteConversation(id: string): Promise<boolean>;

  /**
   * List conversations (paginated) / 列出会话（分页）
   * @param page Page number (default: 0) / 页码（默认：0）
   * @param pageSize Page size (default: 10000) / 每页大小（默认：10000）
   * @returns List of conversations sorted by modifyTime / 按 modifyTime 排序的会话列表
   */
  listConversations(page?: number, pageSize?: number): Promise<TChatConversation[]>;

  // ========== Messages / 消息 ==========

  /**
   * Get messages for a conversation (paginated) / 获取会话消息（分页）
   * @param conversationId Conversation ID / 会话 ID
   * @param page Page number (default: 0) / 页码（默认：0）
   * @param pageSize Page size (default: 10000) / 每页大小（默认：10000）
   * @returns List of messages / 消息列表
   */
  getMessages(conversationId: string, page?: number, pageSize?: number): Promise<TMessage[]>;

  /**
   * Send message to conversation / 发送消息到会话
   * Dispatches to appropriate agent (ACP, OpenClaw, or Remote) / 分发到相应的 Agent（ACP、OpenClaw 或 Remote）
   * @param params Message parameters (content, files, conversation_id, etc.) / 消息参数（内容、文件、会话 ID 等）
   * @returns Response with success status / 响应状态
   */
  sendMessage(params: ISendMessageParams): Promise<IBridgeResponse>;

  /**
   * Stop/interrupt current operation / 停止/中断当前操作
   * @param conversationId Conversation ID / 会话 ID
   * @returns Response with success status / 响应状态
   */
  stop(conversationId: string): Promise<IBridgeResponse>;

  /**
   * Sync messages from remote server to local DB (enterprise mode only)
   * 从远程服务器同步消息到本地数据库（仅企业模式）
   *
   * Only implemented by RemoteConversationProvider.
   * 仅由 RemoteConversationProvider 实现。
   * Called when user clicks on a history conversation to ensure local data is up-to-date.
   * 当用户点击历史会话时调用，确保本地数据是最新的。
   *
   * @param conversationId Conversation ID / 会话 ID
   * @returns Sync result with count and name update status / 同步结果（消息数量和名称更新状态）
   */
  syncFromMossServer?(conversationId: string): Promise<{ syncedCount: number; nameUpdated: boolean }>;
}

/**
 * Provider factory configuration / Provider 工厂配置
 *
 * For enterprise mode, uses JWT access_token directly from eeclaw auth storage.
 * 企业模式下，直接使用 eeclaw auth storage 中的 JWT access_token。
 */
export interface IProviderConfig {
  /** Whether to use remote (enterprise) mode / 是否使用远程（企业）模式 */
  isEnterpriseMode: boolean;
  /** Moss Server URL (for remote provider) / Moss Server URL（用于远程 Provider） */
  mossServerUrl?: string;
  /** JWT access token from enterprise login (for remote provider) / 企业登录的 JWT access token（用于远程 Provider） */
  authToken?: string;
  /** Runtime type / 运行时类型 */
  runtimeType?: 'host' | 'docker';
}