/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import type { AcpBackend } from '@sudowork/common/acpTypes';
import type { IMessageAcpQuestion, TMessage } from '@sudowork/common/chatLib';
import { ConversationProvider } from '@renderer/context/ConversationContext';
import FlexFullContainer from '@renderer/components/FlexFullContainer';
import MessageList from '@renderer/messages/MessageList';
import { MessageListProvider, useMessageList, useMessageLstCache } from '@renderer/messages/hooks';
import HOC from '@renderer/utils/HOC';
import LocalImageView from '@renderer/components/LocalImageView';
import ConversationChatConfirm from '../components/ConversationChatConfirm';
import SafetyChatConfirm from '../SafetyChatConfirm';
import AcpSendBox from './AcpSendBox';

function buildLegacyQuestionItems(message: IMessageAcpQuestion) {
  const options = (message.content.options || []).map((option) => ({ label: option, value: option }));
  return [
    {
      id: 'q1',
      prompt: message.content.question || '',
      kind: options.length > 0 ? ('single_select' as const) : ('text' as const),
      options,
      allowCustomInput: options.length === 0,
      optional: false,
    },
  ];
}

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
  /** Team override: when set, the stop button goes through the team API (pauseMember) instead of
   * conversation.stop — team agents are built with skipCache and are invisible to that path. */
  teamStop?: () => Promise<void>;
  teamAnswerQuestion?: (params: { conversationId: string; toolCallId: string; answers: Array<{ id: string; value: string; label?: string }> }) => Promise<{ success: boolean; msg?: string } | void>;
  onProcessingChange?: (isProcessing: boolean) => void;
}> = ({ conversation_id, workspace, backend, sessionMode, agentName, emptyState, showEmptyStateWhenNoMessages, onTeamAnswerQuestion, teamSendMessage, teamStop, teamAnswerQuestion, onProcessingChange }) => {
  const { loaded: messagesLoaded } = useMessageLstCache(conversation_id);
  const [aiProcessing, setAiProcessing] = useState(false);
  const messages = useMessageList();

  // Reset aiProcessing when conversation changes
  // 切换会话时重置 aiProcessing 状态
  useEffect(() => {
    setAiProcessing(false);
  }, [conversation_id]);

  const pendingQuestion = useMemo(() => getPendingQuestion(messages), [messages]);
  const isAwaitingUserInput = pendingQuestion !== null;
  const shouldShowProcessing = aiProcessing && !isAwaitingUserInput;
  const pendingQuestionItems = useMemo(() => {
    if (!pendingQuestion) return [];
    return pendingQuestion.content.items?.length ? pendingQuestion.content.items : buildLegacyQuestionItems(pendingQuestion);
  }, [pendingQuestion]);

  return (
    <ConversationProvider value={{ conversationId: conversation_id, workspace, type: backend === 'remote-agent' ? 'remote-agent' : 'acp' }}>
      <div className='flex-1 flex flex-col px-20px min-h-0'>
        <LocalImageView.Provider value={{ root: workspace || '' }}>
          <FlexFullContainer>
            <MessageList
              className='flex-1'
              aiProcessing={shouldShowProcessing}
              emptyState={emptyState}
              isEmptyStateReady={Boolean(showEmptyStateWhenNoMessages && messagesLoaded) && !isAwaitingUserInput}
              onTeamAnswerQuestion={onTeamAnswerQuestion}
              onTeamQuestionFallbackSend={teamSendMessage ? ({ input, msg_id }) => teamSendMessage({ input, msg_id }) : undefined}
            ></MessageList>
          </FlexFullContainer>
        </LocalImageView.Provider>
        <SafetyChatConfirm conversation_id={conversation_id}>
          <ConversationChatConfirm conversation_id={conversation_id}>
            <AcpSendBox
              conversation_id={conversation_id}
              backend={backend}
              sessionMode={sessionMode}
              agentName={agentName}
              teamSendMessage={teamSendMessage}
              teamStop={teamStop}
              teamAnswerQuestion={teamAnswerQuestion}
              pendingQuestion={pendingQuestion}
              pendingQuestionItems={pendingQuestionItems}
              isAwaitingUserInput={isAwaitingUserInput}
              onAiProcessingChange={setAiProcessing}
              onProcessingChange={onProcessingChange}
            ></AcpSendBox>
          </ConversationChatConfirm>
        </SafetyChatConfirm>
      </div>
    </ConversationProvider>
  );
};

export default HOC(MessageListProvider)(AcpChat);
