/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '../../common';
import { getConversationProvider, isRemoteProvider } from '../providers';
import { mainError } from '@process/utils/mainLogger';

export function initDatabaseBridge(): void {
  // Get conversation messages from database (or remote provider)
  // 从数据库获取会话消息（或远程 Provider）
  ipcBridge.database.getConversationMessages.provider(({ conversation_id, page = 0, pageSize = 10000 }) => {
    try {
      const provider = getConversationProvider();
      // For remote provider, messages are now stored locally after sync
      // Local-first approach: reads from local DB first, falls back to Moss Server API
      // 对于远程 Provider，消息在同步后存储在本地
      // 本地优先策略：先从本地数据库读取，回退到 Moss Server API
      return provider.getMessages(conversation_id, page, pageSize);
    } catch (error) {
      mainError('DatabaseBridge', 'Error getting conversation messages:', error);
      return Promise.resolve([]);
    }
  });

  // Get user conversations (paginated) via Provider
  // 通过 Provider 获取用户会话（分页）
  ipcBridge.database.getUserConversations.provider(async ({ page = 0, pageSize = 10000, sessionMode }) => {
    try {
      const provider = getConversationProvider(sessionMode);

      // For remote provider, this fetches from Moss Server
      // 对于远程 Provider，从 Moss Server 获取
      // For local provider, this fetches from database with file storage fallback
      // 对于本地 Provider，从数据库获取，并支持文件存储回退
      const conversations = await provider.listConversations(page, pageSize);

      return conversations;
    } catch (error) {
      mainError('DatabaseBridge', 'Error getting user conversations:', error);
      return [];
    }
  });
}
