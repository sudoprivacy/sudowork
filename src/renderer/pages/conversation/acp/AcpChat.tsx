import React, { useEffect, useState } from 'react';
import { ConversationProvider } from '@/renderer/context/ConversationContext';
import type { AcpBackend } from '@/types/acpTypes';
import FlexFullContainer from '@renderer/components/FlexFullContainer';
import MessageList from '@renderer/messages/MessageList';
import { MessageListProvider, useMessageLstCache } from '@renderer/messages/hooks';
import HOC from '@renderer/utils/HOC';
import LocalImageView from '@renderer/components/LocalImageView';
import ConversationChatConfirm from '../components/ConversationChatConfirm';
import { SafetyChatConfirm } from '../SafetyChatConfirm';
import AcpSendBox from './AcpSendBox';

const AcpChat: React.FC<{
  conversation_id: string;
  workspace?: string;
  backend: AcpBackend;
  sessionMode?: string;
  agentName?: string;
}> = ({ conversation_id, workspace, backend, sessionMode, agentName }) => {
  useMessageLstCache(conversation_id);
  const [aiProcessing, setAiProcessing] = useState(false);

  // Reset aiProcessing when conversation changes
  // 切换会话时重置 aiProcessing 状态
  useEffect(() => {
    setAiProcessing(false);
  }, [conversation_id]);

  return (
    <ConversationProvider value={{ conversationId: conversation_id, workspace, type: backend === 'remote-agent' ? 'remote-agent' : 'acp' }}>
      <div className='flex-1 flex flex-col px-20px min-h-0'>
        <LocalImageView.Provider value={{ root: workspace || '' }}>
          <FlexFullContainer>
            <MessageList className='flex-1' aiProcessing={aiProcessing}></MessageList>
          </FlexFullContainer>
        </LocalImageView.Provider>
        <SafetyChatConfirm conversation_id={conversation_id}>
          <ConversationChatConfirm conversation_id={conversation_id}>
            <AcpSendBox conversation_id={conversation_id} backend={backend} sessionMode={sessionMode} agentName={agentName} onAiProcessingChange={setAiProcessing}></AcpSendBox>
          </ConversationChatConfirm>
        </SafetyChatConfirm>
      </div>
    </ConversationProvider>
  );
};

export default HOC(MessageListProvider)(AcpChat);
