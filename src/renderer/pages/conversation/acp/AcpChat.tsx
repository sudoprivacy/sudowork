/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ConversationProvider } from '@/renderer/context/ConversationContext';
import type { AcpBackend } from '@/types/acpTypes';
import FlexFullContainer from '@renderer/components/FlexFullContainer';
import MessageList from '@renderer/messages/MessageList';
import { MessageListProvider, useMessageList, useMessageLstCache, useUpdateMessageList } from '@renderer/messages/hooks';
import HOC from '@renderer/utils/HOC';
import LocalImageView from '@renderer/components/LocalImageView';
import type { AcpQuestionAnswerItem, IMessageAcpQuestion, TMessage } from '@/common/chatLib';
import ConversationChatConfirm from '../components/ConversationChatConfirm';
import { SafetyChatConfirm } from '../SafetyChatConfirm';
import AcpQuestionOverlay from './AcpQuestionOverlay';
import AcpSendBox from './AcpSendBox';

function getPendingQuestion(list: TMessage[]): IMessageAcpQuestion | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const message = list[i];
    if (message.type !== 'acp_question') continue;
    if (message.content?.answered || message.content?.cancelled) continue;
    return message;
  }
  return null;
}

const AcpChat: React.FC<{
  conversation_id: string;
  workspace?: string;
  backend: AcpBackend;
  sessionMode?: string;
  agentName?: string;
  emptyState?: React.ReactNode;
  showEmptyStateWhenNoMessages?: boolean;
  onTeamAnswerQuestion?: (params: { conversationId: string; toolCallId: string; answers: Array<{ id: string; value: string; label?: string }> }) => Promise<{ success: boolean; msg?: string } | void>;
  /** Team override: when set, sends go through the team API instead of the single-chat ACP API (附录 II.8). */
  teamSendMessage?: (params: { input: string; files?: string[]; msg_id?: string }) => Promise<void>;
  teamAnswerQuestion?: (params: { conversationId: string; toolCallId: string; answers: Array<{ id: string; value: string; label?: string }> }) => Promise<{ success: boolean; msg?: string } | void>;
  onProcessingChange?: (isProcessing: boolean) => void;
}> = ({ conversation_id, workspace, backend, sessionMode, agentName, emptyState, showEmptyStateWhenNoMessages, onTeamAnswerQuestion, teamSendMessage, teamAnswerQuestion, onProcessingChange }) => {
  const { loaded: messagesLoaded } = useMessageLstCache(conversation_id);
  const [aiProcessing, setAiProcessing] = useState(false);
  const messages = useMessageList();
  const updateMessages = useUpdateMessageList();

  // Reset aiProcessing when conversation changes
  // 切换会话时重置 aiProcessing 状态
  useEffect(() => {
    setAiProcessing(false);
  }, [conversation_id]);

  const pendingQuestion = useMemo(() => getPendingQuestion(messages), [messages]);
  const isAwaitingUserInput = pendingQuestion !== null;
  const shouldShowProcessing = aiProcessing && !isAwaitingUserInput;
  const onQuestionAnswered = useCallback(
    ({ selectedAnswer, answerItems }: { selectedAnswer: string; answerItems: AcpQuestionAnswerItem[] }) => {
      if (!pendingQuestion) return;
      updateMessages((list) => list.map((message) => (message.type === 'acp_question' && message.msg_id === pendingQuestion.msg_id ? { ...message, content: { ...message.content, answered: true, selectedAnswer, answerItems } } : message)));
    },
    [pendingQuestion, updateMessages]
  );
  const onTeamQuestionFallbackSend = teamSendMessage ? ({ input, msg_id }: { input: string; msg_id: string }) => teamSendMessage({ input, msg_id }) : undefined;

  return (
    <ConversationProvider value={{ conversationId: conversation_id, workspace, type: backend === 'remote-agent' ? 'remote-agent' : 'acp' }}>
      <div className='relative flex-1 flex flex-col px-20px min-h-0'>
        <LocalImageView.Provider value={{ root: workspace || '' }}>
          <FlexFullContainer>
            <MessageList className='flex-1' aiProcessing={shouldShowProcessing} emptyState={emptyState} isEmptyStateReady={Boolean(showEmptyStateWhenNoMessages && messagesLoaded) && !isAwaitingUserInput}></MessageList>
          </FlexFullContainer>
        </LocalImageView.Provider>
        <div inert={isAwaitingUserInput ? true : undefined} aria-hidden={isAwaitingUserInput || undefined}>
          <SafetyChatConfirm conversation_id={conversation_id}>
            <ConversationChatConfirm conversation_id={conversation_id}>
              <AcpSendBox conversation_id={conversation_id} backend={backend} sessionMode={sessionMode} agentName={agentName} teamSendMessage={teamSendMessage} isAwaitingUserInput={isAwaitingUserInput} onAiProcessingChange={setAiProcessing} onProcessingChange={onProcessingChange}></AcpSendBox>
            </ConversationChatConfirm>
          </SafetyChatConfirm>
        </div>
        {pendingQuestion ? <AcpQuestionOverlay key={pendingQuestion.msg_id || pendingQuestion.id} message={pendingQuestion} onAnswered={onQuestionAnswered} onTeamAnswerQuestion={teamAnswerQuestion ?? onTeamAnswerQuestion} onTeamQuestionFallbackSend={onTeamQuestionFallbackSend} /> : null}
      </div>
    </ConversationProvider>
  );
};

export default HOC(MessageListProvider)(AcpChat);
