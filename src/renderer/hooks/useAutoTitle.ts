/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { useConversationTabs } from '@/renderer/pages/conversation/context/ConversationTabsContext';
import { emitter } from '@/renderer/utils/emitter';
import { stripThinkTags, hasThinkTags } from '@/renderer/utils/thinkTagFilter';

/**
 * useAutoTitle —— 自动为对话生成标题。
 *
 * 返回 checkAndUpdateTitle(conversationId, messageContent)：在用户发送消息时调用，
 * 当对话名仍为默认值（"新对话" / "Remote Agent"）或过长（> 50 字符，通常是误用整条消息当标题）时，
 * 取消息首行前 50 字符（先剥离 <think> 思考内容）作为新标题，写库并刷新 tab 名与历史列表。
 */
export const useAutoTitle = () => {
  const { t } = useTranslation();
  const { updateTabName } = useConversationTabs();

  const checkAndUpdateTitle = useCallback(
    async (conversationId: string, messageContent: string) => {
      const defaultTitle = t('conversation.welcome.newConversation');
      const remoteAgentDefaultTitle = 'Remote Agent';
      try {
        const conversation = await ipcBridge.conversation.get.invoke({ id: conversationId });
        // Only update if current name matches default titles or is too long (user message as title)
        const isDefaultName = conversation && (conversation.name === defaultTitle || conversation.name === remoteAgentDefaultTitle);
        // Also check if name is too long (> 50 chars) - likely full user message, should truncate
        const isTooLong = conversation && conversation.name && conversation.name.length > 50;

        if (conversation && (isDefaultName || isTooLong)) {
          // Strip think tags before extracting title to avoid thinking content in conversation name
          const cleanContent = hasThinkTags(messageContent) ? stripThinkTags(messageContent) : messageContent;
          // Create title from message: take first 50 chars, remove newlines
          const newTitle = cleanContent.split('\n')[0].substring(0, 50).trim();
          if (!newTitle) return; // Don't update if empty

          await ipcBridge.conversation.update.invoke({
            id: conversationId,
            updates: { name: newTitle },
          });

          updateTabName(conversationId, newTitle);
          emitter.emit('chat.history.refresh');
        }
      } catch (error) {
        console.error('Failed to auto-update conversation title:', error);
      }
    },
    [t, updateTabName]
  );

  return { checkAndUpdateTitle };
};
