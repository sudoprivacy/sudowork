/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConversationProvider } from '@/renderer/context/ConversationContext';
import FlexFullContainer from '@renderer/components/FlexFullContainer';
import MessageList from '@renderer/messages/MessageList';
import { MessageListProvider, useMessageLstCache } from '@renderer/messages/hooks';
import HOC from '@renderer/utils/HOC';
import React, { createContext, useEffect, useState } from 'react';
import LocalImageView from '../../../components/LocalImageView';
import ConversationChatConfirm from '../components/ConversationChatConfirm';
import SafetyChatConfirm from '../SafetyChatConfirm';
import OpenClawSendBox from './OpenClawSendBox';

// Context for AI processing state
export const AIProcessingContext = createContext<boolean>(false);

const OpenClawChat: React.FC<{
  conversation_id: string;
  workspace: string;
}> = ({ conversation_id, workspace }) => {
  useMessageLstCache(conversation_id);
  const updateLocalImage = LocalImageView.useUpdateLocalImage();
  const [aiProcessing, setAiProcessing] = useState(false);

  useEffect(() => {
    updateLocalImage({ root: workspace });
  }, [workspace]);

  // Reset aiProcessing when conversation changes
  // 切换会话时重置 aiProcessing 状态
  useEffect(() => {
    setAiProcessing(false);
  }, [conversation_id]);

  return (
    <AIProcessingContext.Provider value={aiProcessing}>
      <ConversationProvider value={{ conversationId: conversation_id, workspace, type: 'openclaw-gateway' }}>
        <div className='flex-1 flex flex-col px-20px min-h-0'>
          <FlexFullContainer>
            <MessageList className='flex-1' aiProcessing={aiProcessing} />
          </FlexFullContainer>
          <SafetyChatConfirm conversation_id={conversation_id}>
            <ConversationChatConfirm conversation_id={conversation_id}>
              <OpenClawSendBox conversation_id={conversation_id} onAiProcessingChange={setAiProcessing} />
            </ConversationChatConfirm>
          </SafetyChatConfirm>
        </div>
      </ConversationProvider>
    </AIProcessingContext.Provider>
  );
};

export default HOC(MessageListProvider)(OpenClawChat);
