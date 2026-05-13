/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageAcpQuestion } from '@/common/chatLib';
import { uuid } from '@/common/utils';
import { acpConversation } from '@/common/ipcBridge';
import { Button, Card, Typography } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

interface MessageAcpQuestionProps {
  message: IMessageAcpQuestion;
}

const MessageAcpQuestion: React.FC<MessageAcpQuestionProps> = React.memo(({ message }) => {
  const { question, options = [], conversationId } = message.content || {};
  const { t } = useTranslation();

  const [isResponding, setIsResponding] = useState(false);
  const [hasResponded, setHasResponded] = useState(message.content?.answered || false);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(message.content?.selectedAnswer || null);

  const handleOptionClick = async (option: string) => {
    if (hasResponded || isResponding) return;

    setIsResponding(true);
    setSelectedAnswer(option);

    try {
      // Send the selected option as a user message to continue the conversation
      const result = await acpConversation.sendMessage.invoke({
        input: option,
        msg_id: uuid(),
        conversation_id: conversationId,
      });

      if (result && result.success === true) {
        setHasResponded(true);
        // Update message content to persist answered state
        message.content.answered = true;
        message.content.selectedAnswer = option;
      } else {
        setSelectedAnswer(null);
        console.error('Failed to send question answer:', result);
      }
    } catch (error) {
      setSelectedAnswer(null);
      console.error('Error sending question answer:', error);
    } finally {
      setIsResponding(false);
    }
  };

  if (!question) {
    return null;
  }

  return (
    <Card className='mb-4' bordered={false} style={{ background: 'var(--bg-1)' }}>
      <div className='space-y-4'>
        {/* Header with icon and question */}
        <div className='flex items-start space-x-2'>
          <span className='text-2xl flex-shrink-0'>{'💬'}</span>
          <Text className='block whitespace-pre-wrap'>{question}</Text>
        </div>

        {!hasResponded && (
          <>
            <div className='mt-10px'>
              <Text className='text-xs text-t-secondary'>{t('messages.chooseAction')}</Text>
            </div>
            <div className='flex flex-col gap-8px pl-20px'>
              {options.length > 0 ? (
                options.map((option, index) => (
                  <Button
                    key={`option-${index}`}
                    type='outline'
                    size='small'
                    long
                    disabled={isResponding}
                    className='text-left justify-start'
                    onClick={() => handleOptionClick(option)}
                  >
                    {option}
                  </Button>
                ))
              ) : (
                <Text type='secondary'>{t('messages.noOptionsAvailable')}</Text>
              )}
            </div>
          </>
        )}

        {hasResponded && selectedAnswer && (
          <div className='mt-10px p-2 rounded-md border' style={{ backgroundColor: 'var(--color-success-light-1)', borderColor: 'rgb(var(--success-3))' }}>
            <Text className='text-sm' style={{ color: 'rgb(var(--success-6))' }}>
              {'✓ '}{t('messages.questionAnswered')}{': '}{selectedAnswer}
            </Text>
          </div>
        )}
      </div>
    </Card>
  );
});

export default MessageAcpQuestion;
