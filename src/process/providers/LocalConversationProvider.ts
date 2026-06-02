/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IConversationProvider, IProviderConfig } from './types';
import type { TChatConversation } from '@/common/storage';
import type { TMessage } from '@/common/chatLib';
import type { ICreateConversationParams, IBridgeResponse, ISendMessageParams } from '@/common/ipcBridge';
import { getDatabase } from '@process/database';
import { ConversationService } from '@process/services/conversationService';
import WorkerManage from '@process/WorkerManage';
import { ProcessChat } from '@process/initStorage';
import { migrateConversationToDatabase } from '@process/bridge/migrationUtils';
import { mainLog, mainError } from '@process/utils/mainLogger';

/**
 * Local Conversation Provider
 * 本地会话 Provider
 *
 * Wraps existing database-backed conversation and message logic.
 * 包装现有的数据库会话和消息逻辑。
 * Used for local mode (ACP, OpenClaw agents).
 * 用于本地模式（ACP、OpenClaw Agent）。
 */
export class LocalConversationProvider implements IConversationProvider {
  readonly type = 'local' as const;

  constructor(_config?: IProviderConfig) {
    // Local provider doesn't need config / 本地 Provider 不需要配置
  }

  // ========== Conversation CRUD / 会话 CRUD ==========

  async createConversation(params: ICreateConversationParams): Promise<TChatConversation> {
    mainLog('LocalProvider', `Creating conversation: type=${params.type}`);

    const result = await ConversationService.createConversation({
      ...params,
      source: 'aionui',
    });

    if (!result.success || !result.conversation) {
      mainError('LocalProvider', `Failed to create conversation: ${result.error}`);
      throw new Error(result.error || 'Failed to create conversation');
    }

    mainLog('LocalProvider', `Conversation created: id=${result.conversation.id}`);
    return result.conversation;
  }

  async getConversation(id: string): Promise<TChatConversation | undefined> {
    try {
      const db = getDatabase();

      // Try database first / 先尝试数据库
      const result = db.getConversation(id);
      if (result.success && result.data) {
        const conversation = result.data;
        const task = WorkerManage.getTaskById(id);
        const taskStatus = task?.status === 'idle' ? 'finished' : task?.status;
        conversation.status = taskStatus || 'finished';
        return conversation;
      }

      // Fallback to file storage (with lazy migration) / 回退到文件存储（延迟迁移）
      const history = await ProcessChat.get('chat.history');
      const conversation = (history || []).find((item) => item.id === id);
      if (conversation) {
        const task = WorkerManage.getTaskById(id);
        const taskStatus = task?.status === 'idle' ? 'finished' : task?.status;
        conversation.status = taskStatus || 'finished';
        void migrateConversationToDatabase(conversation);
        return conversation;
      }

      return undefined;
    } catch (error) {
      mainError('LocalProvider', 'Failed to get conversation:', error);
      return undefined;
    }
  }

  async updateConversation(id: string, updates: Partial<TChatConversation>, mergeExtra?: boolean): Promise<boolean> {
    try {
      const db = getDatabase();
      const existing = db.getConversation(id);

      let finalUpdates = updates;
      if (mergeExtra && updates.extra && existing.success && existing.data) {
        finalUpdates = {
          ...updates,
          extra: {
            ...existing.data.extra,
            ...updates.extra,
          },
        } as Partial<TChatConversation>;
      }

      const result = await Promise.resolve(db.updateConversation(id, finalUpdates));
      return result.success;
    } catch (error) {
      mainError('LocalProvider', 'Failed to update conversation:', error);
      return false;
    }
  }

  async deleteConversation(id: string): Promise<boolean> {
    try {
      const db = getDatabase();

      // Kill running task / 终止运行中的任务
      WorkerManage.kill(id);

      // Delete from database (cascade deletes messages) / 从数据库删除（级联删除消息）
      const result = db.deleteConversation(id);
      if (!result.success) {
        mainError('LocalProvider', `Failed to delete conversation: ${result.error}`);
        return false;
      }

      return true;
    } catch (error) {
      mainError('LocalProvider', 'Failed to delete conversation:', error);
      return false;
    }
  }

  async listConversations(page = 0, pageSize = 10000): Promise<TChatConversation[]> {
    try {
      const db = getDatabase();
      const result = db.getUserConversations(undefined, page, pageSize);
      const dbConversations = result.data || [];

      // Filter out enterprise mode conversations (remote-agent)
      // 过滤掉企业模式会话（remote-agent）
      // Local mode should only show acp and openclaw-gateway types
      // 本地模式只显示 acp 和 openclaw-gateway 类型
      const localDbConversations = dbConversations.filter((c) => c.type !== 'remote-agent' && c.extra?.backend !== 'remote-agent');

      // Lazy migration from file storage / 从文件存储延迟迁移
      let fileConversations: TChatConversation[] = [];
      try {
        fileConversations = (await ProcessChat.get('chat.history')) || [];
      } catch {
        // No file storage / 无文件存储
      }

      // Filter file conversations too / 同时过滤文件存储的会话
      const localFileConversations = fileConversations.filter((c) => c.type !== 'remote-agent' && c.extra?.backend !== 'remote-agent');

      // Merge: database is primary, add missing from file / 合并：数据库为主，补充文件中缺失的
      const dbIds = new Set(localDbConversations.map((c) => c.id));
      const fileOnly = localFileConversations.filter((c) => !dbIds.has(c.id));

      if (fileOnly.length > 0) {
        void Promise.all(fileOnly.map((c) => migrateConversationToDatabase(c)));
      }

      const all = [...localDbConversations, ...fileOnly];
      all.sort((a, b) => (b.modifyTime || b.createTime || 0) - (a.modifyTime || a.createTime || 0));

      return all;
    } catch (error) {
      mainError('LocalProvider', 'Failed to list conversations:', error);
      return [];
    }
  }

  // ========== Messages / 消息 ==========

  async getMessages(conversationId: string, page = 0, pageSize = 10000): Promise<TMessage[]> {
    try {
      const db = getDatabase();
      const result = db.getConversationMessages(conversationId, page, pageSize);
      return result.data || [];
    } catch (error) {
      mainError('LocalProvider', 'Failed to get messages:', error);
      return [];
    }
  }

  async sendMessage(params: ISendMessageParams): Promise<IBridgeResponse> {
    // This is a complex operation - delegate to WorkerManage
    // 这是一个复杂操作 - 委托给 WorkerManage
    // The actual implementation is in conversationBridge.ts sendMessage handler
    // 实际实现在 conversationBridge.ts sendMessage 处理器中

    // For now, return success - the actual sendMessage logic
    // 目前返回成功 - 实际的 sendMessage 逻辑
    // will be handled by the refactored conversationBridge
    // 将由重构后的 conversationBridge 处理
    return { success: true };
  }

  async stop(conversationId: string): Promise<IBridgeResponse> {
    try {
      const task = WorkerManage.getTaskById(conversationId);
      if (!task) {
        return { success: true, msg: 'conversation not found' };
      }
      if (task.type !== 'acp' && task.type !== 'openclaw-gateway' && task.type !== 'remote-agent') {
        return { success: false, msg: 'not support' };
      }
      await task.stop();
      return { success: true };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  }
}

export default LocalConversationProvider;
