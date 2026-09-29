/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { deriveConversationTitle, isUnnamedConversation } from '@sudowork/common/conversationTitle';
import { useConversationTabs } from '@renderer/pages/conversation/context/ConversationTabsContext';
import { emitter } from '@renderer/utils/emitter';

/**
 * useAutoTitle —— 自动为对话生成标题。
 *
 * 返回 checkAndUpdateTitle(conversationId, messageContent)：在用户发送消息时调用，
 * 对话还没有自己的名字时，用这条消息推导一个。推导规则与 WebUI 服务端共用
 * （@sudowork/common/conversationTitle），两个端不会对同一个对话叫出不同名字。
 */
export const useAutoTitle = () => {
  const { t } = useTranslation();
  const { updateTabName } = useConversationTabs();

  const checkAndUpdateTitle = useCallback(
    async (conversationId: string, messageContent: string) => {
      try {
        const conversation = await ipcBridge.conversation.get.invoke({ id: conversationId });
        if (!conversation) return;
        if (
          !isUnnamedConversation(conversation.name, {
            localizedDefaults: [t('conversation.welcome.newConversation')],
            conversationId: conversation.id,
          })
        )
          return;

        const newTitle = deriveConversationTitle(messageContent);
        if (!newTitle) return;

        await ipcBridge.conversation.update.invoke({
          id: conversationId,
          updates: { name: newTitle },
        });

        updateTabName(conversationId, newTitle);
        emitter.emit('chat.history.refresh');
      } catch (error) {
        console.error('Failed to auto-update conversation title:', error);
      }
    },
    [t, updateTabName]
  );

  return { checkAndUpdateTitle };
};
