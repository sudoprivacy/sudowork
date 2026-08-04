import { Card, Typography } from '@arco-design/web-react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { IMessageAcpQuestion } from '@/common/chatLib';
import { normalizeAcpQuestionItems, parseAcpQuestionAnswer } from './acpQuestionUtils';

const { Text } = Typography;

export default React.memo(function MessageAcpQuestion({ message }: IMessageAcpQuestionProps) {
  const { t } = useTranslation();
  const { question, intro, answered, cancelled, answerItems, selectedAnswer } = message.content || {};
  const items = useMemo(() => normalizeAcpQuestionItems(message, { yes: t('messages.yes'), no: t('messages.no') }), [message, t]);
  const answers = useMemo(() => {
    if (answerItems?.length) return answerItems;
    return selectedAnswer ? parseAcpQuestionAnswer(selectedAnswer, items) : [];
  }, [answerItems, items, selectedAnswer]);

  if (!question && !cancelled) return null;

  return (
    <Card className='mb-4 bg-card' bordered={false}>
      <div className='space-y-4'>
        {question || intro ? (
          <div className='flex items-start space-x-2'>
            <span className='shrink-0 text-2xl'>{'💬'}</span>
            <Text className='mt-1 block min-w-0 flex-1 whitespace-pre-wrap'>{intro || question}</Text>
          </div>
        ) : null}

        {!answered && !cancelled ? <Text className='block text-sm text-foreground-secondary'>{t('messages.waitingForUserInput')}</Text> : null}

        {answered && !cancelled ? (
          <div className='mt-2.5 space-y-2'>
            {items.map((item, index) => {
              const answer = answers.find((candidate) => candidate.id === item.id || candidate.index === index + 1);
              const isSkipped = answer?.skipped === true;
              return (
                <div key={item.id} className='rounded-md border border-border bg-muted p-2'>
                  <div className='mb-1 text-xs text-foreground-secondary'>
                    {items.length > 1 ? `${index + 1}. ` : ''}
                    {item.prompt}
                  </div>
                  <Text className={`whitespace-pre-wrap text-sm ${isSkipped ? 'text-foreground-tertiary' : 'text-success'}`}>{isSkipped ? `⊘ ${t('messages.questionSkipped')}` : `✓ ${answer?.displayValue || ''}`}</Text>
                </div>
              );
            })}
          </div>
        ) : null}

        {cancelled ? (
          <div className='bg-warning-surface mt-2.5 rounded-md border border-border p-2'>
            <Text className='whitespace-pre-wrap text-sm text-warning'>
              {'⚠ '}
              {t('messages.questionCancelled')}
            </Text>
          </div>
        ) : null}
      </div>
    </Card>
  );
});

interface IMessageAcpQuestionProps {
  message: IMessageAcpQuestion;
}
