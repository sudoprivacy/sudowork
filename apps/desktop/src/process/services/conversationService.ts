/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICreateConversationParams } from '@/common/ipcBridge';
import type { ConversationSource, TChatConversation } from '@/common/storage';
import { getDatabase } from '@process/database';
import { mainLog, mainError } from '@process/utils/mainLogger';
import { createAcpAgent } from '../initAgent';
import WorkerManage from '../WorkerManage';

/**
 * 创建会话的通用参数（基于 IPC 参数扩展）
 * Common parameters for creating conversation (extends IPC params)
 */
export interface ICreateConversationOptions extends ICreateConversationParams {
  /** 会话来源 / Conversation source */
  source?: ConversationSource;
  /** Channel chat isolation ID (e.g. user:xxx, group:xxx) */
  channelChatId?: string;
  /** Internal-only option for create-only provisioning paths. */
  skipWorkerRegistration?: boolean;
}

/**
 * 创建会话的返回结果
 * Result of creating a conversation
 */
export interface ICreateConversationResult {
  success: boolean;
  conversation?: TChatConversation;
  error?: string;
}

/**
 * 通用会话创建服务
 * Common conversation creation service
 *
 * 提供统一的会话创建逻辑，供 Sudowork、Telegram 及其他 IM 使用
 * Provides unified conversation creation logic for Sudowork, Telegram and other IMs
 */
export class ConversationService {
  /**
   * 创建会话（通用方法，支持所有类型）
   * Create conversation (common method, supports all types)
   */
  static async createConversation(params: ICreateConversationOptions): Promise<ICreateConversationResult> {
    const { type, extra, name, id, source } = params;

    try {
      let conversation: TChatConversation;

      if (type === 'remote-agent') {
        // Enterprise mode: create local metadata record only (no agent process)
        // Moss Server manages the session, local DB stores name for sidebar display
        conversation = {
          id: id || '',
          name: name || 'Remote Agent',
          type: 'remote-agent', // Use 'remote-agent' type for proper dispatch in WorkerManage
          createTime: Date.now(),
          modifyTime: Date.now(),
          extra: {
            ...extra,
            backend: 'remote-agent',
          },
          status: 'finished',
          source: source || 'sudowork',
        } as TChatConversation;
      } else if (type === 'acp') {
        conversation = await createAcpAgent(params);
      } else {
        return { success: false, error: `Invalid conversation type: ${type}` };
      }

      // Apply custom ID, name, source, and channelChatId
      if (name) {
        conversation.name = name;
      }
      if (id) {
        conversation.id = id;
      }
      if (source) {
        conversation.source = source;
      }
      if (params.channelChatId) {
        conversation.channelChatId = params.channelChatId;
      }

      // Save to database
      const db = getDatabase();
      const result = db.createConversation(conversation);
      if (!result.success) {
        mainError('ConversationService', 'Failed to create conversation in database:', result.error);
        return { success: false, error: result.error };
      }

      // Register with WorkerManage after DB save so early emitted messages can be persisted reliably.
      // Note: Don't call initAgent() here - let it be lazy initialized when sendMessage() is called.
      if (!params.skipWorkerRegistration) {
        WorkerManage.buildConversation(conversation);
      }

      mainLog('ConversationService', `Created ${type} conversation ${conversation.id} with source=${source || 'sudowork'}`);
      return { success: true, conversation };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      mainError('ConversationService', 'Failed to create conversation:', error);
      mainError('ConversationService', 'Error details:', {
        type: params.type,
        hasModel: !!params.model,
        hasWorkspace: !!params.extra?.workspace,
        error: errorMessage,
        stack: errorStack,
      });
      return { success: false, error: `Failed to create ${params.type} conversation: ${errorMessage}` };
    }
  }
}

// Export convenience functions
export const createConversation = ConversationService.createConversation.bind(ConversationService);
