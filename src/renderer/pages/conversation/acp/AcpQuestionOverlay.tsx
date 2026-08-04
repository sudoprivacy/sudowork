import { useTranslation } from 'react-i18next';
import React, { useEffect, useRef } from 'react';
import type { AcpQuestionAnswerItem, IMessageAcpQuestion } from '@/common/chatLib';
import MessageAcpQuestion from '@renderer/messages/acp/MessageAcpQuestion';

export default function AcpQuestionOverlay({ message, onAnswered, onTeamAnswerQuestion, onTeamQuestionFallbackSend }: IAcpQuestionOverlayProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div className='pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-20px pb-16px'>
      <div ref={panelRef} tabIndex={-1} className='pointer-events-auto max-h-[70vh] w-full max-w-800px overflow-hidden rounded-2xl bg-card shadow-lg outline-none animate-in fade-in slide-in-from-bottom-4 duration-200' role='region' aria-label={t('messages.waitingForUserInput')}>
        <MessageAcpQuestion variant='overlay' message={message} onAnswered={onAnswered} onTeamAnswerQuestion={onTeamAnswerQuestion} onTeamQuestionFallbackSend={onTeamQuestionFallbackSend} />
      </div>
    </div>
  );
}

interface IAcpQuestionOverlayProps {
  message: IMessageAcpQuestion;
  onAnswered: (answer: { selectedAnswer: string; answerItems: AcpQuestionAnswerItem[] }) => void;
  onTeamAnswerQuestion?: (params: { conversationId: string; toolCallId: string; answers: Array<{ id: string; value: string; label?: string }> }) => Promise<{ success: boolean; msg?: string } | void>;
  onTeamQuestionFallbackSend?: (params: { input: string; msg_id: string }) => Promise<{ success: boolean; msg?: string } | void>;
}
