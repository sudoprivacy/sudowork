/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card, Input, Message, Tag, Typography } from '@arco-design/web-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AcpQuestionAnswerItem, AcpQuestionItem, AcpQuestionItemOption, IMessageAcpQuestion } from '@/common/chatLib';
import { uuid } from '@/common/utils';
import { acpConversation } from '@/common/ipcBridge';

const { Text } = Typography;
const TextArea = Input.TextArea;

interface MessageAcpQuestionProps {
  message: IMessageAcpQuestion;
}

interface NormalizedItem extends AcpQuestionItem {
  options: AcpQuestionItemOption[];
}

function toOption(raw: unknown): AcpQuestionItemOption | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return { label: trimmed, value: trimmed };
  }
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    const label = typeof record.label === 'string' ? record.label : typeof record.value === 'string' ? record.value : '';
    const value = typeof record.value === 'string' ? record.value : label;
    if (!label && !value) return null;
    return {
      label: label || value,
      value: value || label,
      description: typeof record.description === 'string' ? record.description : undefined,
      recommended: record.recommended === true,
    };
  }
  return null;
}

function normalizeItem(item: AcpQuestionItem, fallbackIndex: number, booleanFallback: { yes: string; no: string }): NormalizedItem {
  const rawOptions = (item.options as unknown[] | undefined) || [];
  let options = rawOptions.map((opt) => toOption(opt)).filter((opt): opt is AcpQuestionItemOption => Boolean(opt));
  // Boolean kind has no options in the model schema; supply Yes/No fallbacks
  // so the renderer always has selectable choices for yes/no questions.
  if (item.kind === 'boolean' && options.length === 0) {
    options = [
      { label: booleanFallback.yes, value: 'true' },
      { label: booleanFallback.no, value: 'false' },
    ];
  }
  return {
    ...item,
    id: item.id || `q${fallbackIndex + 1}`,
    options,
  };
}

function normalizeItems(message: IMessageAcpQuestion, booleanFallback: { yes: string; no: string }): NormalizedItem[] {
  const items = message.content?.items;
  if (items && items.length > 0) {
    return items.map((item, index) => normalizeItem(item, index, booleanFallback));
  }

  const legacyOptions = (message.content?.options || []).map((option) => ({ label: option, value: option }));
  return [
    {
      id: 'q1',
      prompt: message.content?.question || '',
      kind: legacyOptions.length > 0 ? 'single_select' : 'text',
      options: legacyOptions,
      allowCustomInput: legacyOptions.length === 0,
      optional: false,
    },
  ];
}

function resolveKind(item: NormalizedItem): 'single_select' | 'multi_select' | 'text' | 'boolean' {
  // Boolean is rendered with the same single-select widget once Yes/No fallback options are injected.
  if (item.kind === 'boolean') return 'single_select';
  if (item.kind) return item.kind;
  return item.options.length > 0 ? 'single_select' : 'text';
}

function normalizeAnswerValue(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' / ');
}

function parseStructuredAnswer(answer: string, items: NormalizedItem[]): AcpQuestionAnswerItem[] {
  const normalized = answer.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const structured = lines
    .map((line) => {
      const match = line.match(/^Q(\d+):\s*(.*)$/i);
      if (!match) return null;
      const index = Number(match[1]);
      const submissionValue = (match[2] || '').trim();
      const item = items[index - 1];
      if (!item) return null;
      const answerItem: AcpQuestionAnswerItem = {
        id: item.id,
        index,
        submissionValue,
        displayValue: submissionValue === '[skipped]' ? '' : submissionValue,
        skipped: submissionValue === '[skipped]',
      };
      return answerItem;
    })
    .filter((item): item is AcpQuestionAnswerItem => Boolean(item));

  if (structured.length > 0) {
    return structured;
  }

  if (items.length === 1) {
    return [
      {
        id: items[0].id,
        index: 1,
        submissionValue: normalized,
        displayValue: normalized === '[skipped]' ? '' : normalized,
        skipped: normalized === '[skipped]',
      },
    ];
  }

  return [];
}

const MessageAcpQuestion: React.FC<MessageAcpQuestionProps> = React.memo(({ message }) => {
  const { question, intro } = message.content || {};
  const conversationId = message.content?.conversationId || message.conversation_id;
  const { t } = useTranslation();
  const yesLabel = t('messages.yes');
  const noLabel = t('messages.no');
  const items = useMemo(() => normalizeItems(message, { yes: yesLabel, no: noLabel }), [message, yesLabel, noLabel]);

  const hydratedAnswers = useMemo(() => {
    if (message.content?.answerItems && message.content.answerItems.length > 0) {
      return message.content.answerItems;
    }
    if (message.content?.selectedAnswer) {
      return parseStructuredAnswer(message.content.selectedAnswer, items);
    }
    return [];
  }, [message.content?.answerItems, message.content?.selectedAnswer, items]);

  const initialSelectedOptions = useMemo(() => {
    const map: Record<string, string> = {};
    hydratedAnswers.forEach((answer) => {
      if (!answer.displayValue) return;
      const item = items[answer.index - 1];
      if (!item) return;
      if (resolveKind(item) === 'multi_select') return;
      const hit = item.options.find((opt) => opt.label === answer.displayValue || opt.value === answer.submissionValue || opt.value === answer.displayValue);
      if (hit) map[item.id] = hit.label;
    });
    return map;
  }, [hydratedAnswers, items]);

  const initialSelectedMulti = useMemo(() => {
    const map: Record<string, string[]> = {};
    hydratedAnswers.forEach((answer) => {
      const item = items[answer.index - 1];
      if (!item || resolveKind(item) !== 'multi_select') return;
      const labels = (answer.displayValue || '')
        .split(' / ')
        .map((part) => part.trim())
        .filter(Boolean);
      if (labels.length > 0) map[item.id] = labels;
    });
    return map;
  }, [hydratedAnswers, items]);

  const initialCustomAnswers = useMemo(() => {
    const map: Record<string, string> = {};
    hydratedAnswers.forEach((answer) => {
      if (!answer.displayValue) return;
      const item = items[answer.index - 1];
      if (!item) return;
      const kind = resolveKind(item);
      if (kind === 'multi_select') return;
      const matched = item.options.some((opt) => opt.label === answer.displayValue || opt.value === answer.submissionValue || opt.value === answer.displayValue);
      if (!matched) map[item.id] = answer.displayValue;
    });
    return map;
  }, [hydratedAnswers, items]);

  const initialCurrentStep = useMemo(() => {
    const firstUnansweredIndex = items.findIndex((item) => {
      const selectedOption = initialSelectedOptions[item.id];
      const selectedMulti = initialSelectedMulti[item.id]?.length || 0;
      const customAnswer = initialCustomAnswers[item.id];
      return !selectedOption && !selectedMulti && !customAnswer;
    });
    if (firstUnansweredIndex === -1) {
      return Math.max(0, items.length - 1);
    }
    return firstUnansweredIndex;
  }, [initialCustomAnswers, initialSelectedMulti, initialSelectedOptions, items]);

  const [isResponding, setIsResponding] = useState(false);
  const [hasResponded, setHasResponded] = useState(message.content?.answered || false);
  const isCancelled = message.content?.cancelled === true;
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(message.content?.selectedAnswer || null);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>(initialSelectedOptions);
  const [selectedMulti, setSelectedMulti] = useState<Record<string, string[]>>(initialSelectedMulti);
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>(initialCustomAnswers);
  const [customInputEnabled, setCustomInputEnabled] = useState<Record<string, boolean>>({});
  const [currentStep, setCurrentStep] = useState(initialCurrentStep);

  const displayedIntro = intro || (items.length > 1 ? question : '');
  const currentItem = items[currentStep];
  const currentKind = currentItem ? resolveKind(currentItem) : 'text';

  const handleSingleOptionClick = (item: NormalizedItem, option: AcpQuestionItemOption) => {
    if (hasResponded || isResponding) return;
    setSelectedOptions((prev) => ({ ...prev, [item.id]: option.label }));
    setCustomAnswers((prev) => (prev[item.id] ? { ...prev, [item.id]: '' } : prev));
    setCustomInputEnabled((prev) => (prev[item.id] ? { ...prev, [item.id]: false } : prev));

    if (currentItem?.id !== item.id) return;
    if (currentStep < items.length - 1) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleMultiOptionToggle = (item: NormalizedItem, option: AcpQuestionItemOption) => {
    if (hasResponded || isResponding) return;
    setSelectedMulti((prev) => {
      const existing = prev[item.id] || [];
      const exists = existing.includes(option.label);
      const next = exists ? existing.filter((l) => l !== option.label) : [...existing, option.label];
      return { ...prev, [item.id]: next };
    });
  };

  const buildAnswerPayload = (): { submission: string; display: string; answerItems: AcpQuestionAnswerItem[] } | null => {
    const answers = items.map((item, index) => {
      const kind = resolveKind(item);
      let displayValue = '';
      let submissionValue = '';

      if (kind === 'multi_select') {
        const labels = selectedMulti[item.id] || [];
        const values = labels.map((label) => {
          const opt = item.options.find((o) => o.label === label);
          return opt?.value || label;
        });
        const custom = normalizeAnswerValue(customAnswers[item.id] || '');
        const merged = [...labels, ...(custom ? [custom] : [])];
        displayValue = merged.join(' / ');
        submissionValue = [...values, ...(custom ? [custom] : [])].join(' / ');
      } else {
        const selectedLabel = selectedOptions[item.id]?.trim();
        const customValue = normalizeAnswerValue(customAnswers[item.id] || '');
        if (selectedLabel) {
          displayValue = selectedLabel;
          const opt = item.options.find((o) => o.label === selectedLabel);
          submissionValue = opt?.value || selectedLabel;
        } else if (customValue) {
          displayValue = customValue;
          submissionValue = customValue;
        }
      }

      if (!displayValue && !submissionValue && !item.optional) return null;

      return {
        id: item.id,
        index: index + 1,
        submissionValue: submissionValue || '[skipped]',
        displayValue,
        skipped: !displayValue,
      };
    });

    if (answers.some((part) => part === null)) return null;

    const resolved = answers.filter(Boolean) as NonNullable<(typeof answers)[number]>[];
    if (resolved.length === 0) return null;

    if (resolved.length === 1) {
      const only = resolved[0];
      return {
        submission: only.submissionValue,
        display: only.displayValue || '[skipped]',
        answerItems: [
          {
            id: only.id,
            index: only.index,
            submissionValue: only.submissionValue,
            displayValue: only.displayValue,
            skipped: only.skipped,
          },
        ],
      };
    }

    return {
      submission: resolved.map(({ index, submissionValue }) => `Q${index}: ${submissionValue}`).join('\n'),
      display: resolved.map(({ index, displayValue, skipped }) => `${index}. ${skipped ? '[skipped]' : displayValue}`).join('\n'),
      answerItems: resolved.map(({ id, index, submissionValue, displayValue, skipped }) => ({
        id,
        index,
        submissionValue,
        displayValue,
        skipped,
      })),
    };
  };

  const handleSubmit = async () => {
    if (hasResponded || isResponding) return;

    const answerPayload = buildAnswerPayload();
    if (!answerPayload) {
      Message.warning(t('messages.completeRequiredAnswers'));
      return;
    }

    setIsResponding(true);
    setSelectedAnswer(answerPayload.display);

    try {
      const result = message.content?.toolCallId
        ? await acpConversation.answerQuestion.invoke({
            conversationId,
            toolCallId: message.content.responseToolCallId || message.content.toolCallId,
            answers: answerPayload.answerItems.map((answer) => ({
              id: answer.id,
              value: answer.submissionValue,
              label: answer.displayValue || undefined,
            })),
          })
        : await acpConversation.sendMessage.invoke({
            input: answerPayload.submission,
            msg_id: uuid(),
            conversation_id: conversationId,
          });

      if (result && result.success === true) {
        setHasResponded(true);
        message.content.answered = true;
        message.content.selectedAnswer = answerPayload.display;
        message.content.answerItems = answerPayload.answerItems;
      } else {
        setSelectedAnswer(null);
        Message.error(result?.msg || t('messages.failedToSendQuestionAnswer'));
      }
    } catch (error) {
      setSelectedAnswer(null);
      console.error('Error sending question answer:', error);
      Message.error(t('messages.failedToSendQuestionAnswer'));
    } finally {
      setIsResponding(false);
    }
  };

  if (!question) {
    return null;
  }

  const currentMulti = currentItem ? selectedMulti[currentItem.id] || [] : [];
  const currentValueLabel = currentItem ? (currentKind === 'multi_select' ? currentMulti.join(' / ') : selectedOptions[currentItem.id] || customAnswers[currentItem.id] || '') : '';
  const canGoNext = currentItem ? currentItem.optional || (currentKind === 'multi_select' ? currentMulti.length > 0 || Boolean(customAnswers[currentItem.id]?.trim()) : Boolean(currentValueLabel.trim())) : false;
  const shouldShowCustomInput = currentItem ? currentKind === 'text' || (currentItem.allowCustomInput && (currentItem.options.length === 0 || customInputEnabled[currentItem.id])) : false;

  const renderOptionExtras = (option: AcpQuestionItemOption) => (
    <>
      {option.recommended ? (
        <Tag size='small' color='arcoblue' className='ml-4px'>
          {t('messages.recommended')}
        </Tag>
      ) : null}
    </>
  );

  return (
    <Card className='mb-4' bordered={false} style={{ background: 'var(--bg-1)' }}>
      <div className='space-y-4'>
        <div className='flex items-start space-x-2'>
          <span className='text-2xl flex-shrink-0'>{'💬'}</span>
          <div className='min-w-0 flex-1'>{displayedIntro ? <Text className='block whitespace-pre-wrap'>{displayedIntro}</Text> : <Text className='block whitespace-pre-wrap'>{question}</Text>}</div>
        </div>

        {!hasResponded && !isCancelled && (
          <>
            <div className='mt-10px'>
              <Text className='text-xs text-secondary'>{items.length > 1 ? `${currentStep + 1}/${items.length}` : t('messages.chooseAction')}</Text>
            </div>

            {currentItem ? (
              <div className='flex flex-col gap-12px pl-20px'>
                <div className='flex flex-col gap-8px'>
                  <Text className='block whitespace-pre-wrap'>{items.length > 1 ? `${currentStep + 1}. ${currentItem.prompt}` : currentItem.prompt}</Text>

                  {currentKind !== 'text' && currentItem.options.length > 0 ? (
                    <div className='flex flex-wrap gap-8px'>
                      {currentItem.options.map((option) => {
                        const isSelected = currentKind === 'multi_select' ? currentMulti.includes(option.label) : selectedOptions[currentItem.id] === option.label;
                        return (
                          <div key={`${currentItem.id}-${option.value}`} className='flex flex-col gap-2px'>
                            <Button type={isSelected ? 'primary' : 'outline'} size='small' disabled={isResponding} onClick={() => (currentKind === 'multi_select' ? handleMultiOptionToggle(currentItem, option) : handleSingleOptionClick(currentItem, option))}>
                              {option.label}
                              {renderOptionExtras(option)}
                            </Button>
                            {option.description ? <Text className='text-xs text-secondary pl-4px'>{option.description}</Text> : null}
                          </div>
                        );
                      })}

                      {currentItem.allowCustomInput ? (
                        <Button
                          type={customInputEnabled[currentItem.id] ? 'primary' : 'outline'}
                          size='small'
                          disabled={isResponding}
                          onClick={() =>
                            setCustomInputEnabled((prev) => ({
                              ...prev,
                              [currentItem.id]: !prev[currentItem.id],
                            }))
                          }
                        >
                          {t('common.edit')}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}

                  {shouldShowCustomInput ? (
                    <TextArea
                      value={customAnswers[currentItem.id] || ''}
                      disabled={isResponding}
                      autoSize={{ minRows: 1, maxRows: 4 }}
                      placeholder={currentItem.optional ? t('common.skip') : currentItem.customInputHint || t('messages.enterAnswer')}
                      onChange={(nextValue) => {
                        setCustomAnswers((prev) => ({ ...prev, [currentItem.id]: nextValue }));
                        if (currentKind !== 'multi_select' && selectedOptions[currentItem.id]) {
                          setSelectedOptions((prev) => ({ ...prev, [currentItem.id]: '' }));
                        }
                      }}
                    />
                  ) : null}

                  {!!currentValueLabel && (
                    <Text className='text-xs text-secondary'>
                      {t('messages.option')}: {currentValueLabel}
                    </Text>
                  )}
                </div>

                <div className='flex gap-8px pt-4px'>
                  {currentStep > 0 ? (
                    <Button size='small' disabled={isResponding} onClick={() => setCurrentStep((prev) => Math.max(0, prev - 1))}>
                      {t('common.ariaLabel.back')}
                    </Button>
                  ) : null}

                  {currentStep < items.length - 1 ? (
                    <Button type='primary' size='small' disabled={isResponding || !canGoNext} onClick={() => setCurrentStep((prev) => Math.min(items.length - 1, prev + 1))}>
                      {t('common.ariaLabel.next')}
                    </Button>
                  ) : (
                    <Button type='primary' size='small' disabled={isResponding} onClick={handleSubmit}>
                      {isResponding ? t('messages.processing') : t('messages.confirm')}
                    </Button>
                  )}
                </div>
              </div>
            ) : null}
          </>
        )}

        {hasResponded && !isCancelled && (
          <div className='mt-10px space-y-2'>
            {items.map((item, idx) => {
              const answer = hydratedAnswers.find((a) => a.id === item.id || a.index === idx + 1);
              const displayValue = answer?.displayValue || '';
              const skipped = answer?.skipped || false;
              return (
                <div
                  key={item.id}
                  className='p-2 rounded-md border'
                  style={{
                    backgroundColor: skipped ? 'var(--color-fill-1)' : 'var(--success-soft)',
                    borderColor: skipped ? 'rgb(var(--gray-3))' : 'var(--success-line)',
                  }}
                >
                  <div className='text-xs text-secondary mb-1'>
                    {items.length > 1 ? `${idx + 1}. ` : ''}
                    {item.prompt}
                  </div>
                  <Text className='text-sm whitespace-pre-wrap' style={{ color: skipped ? 'var(--color-text-3)' : 'var(--success)' }}>
                    {skipped ? `⊘ ${t('messages.questionSkipped')}` : `✓ ${displayValue}`}
                  </Text>
                </div>
              );
            })}
          </div>
        )}

        {isCancelled && (
          <div className='mt-10px p-2 rounded-md border' style={{ backgroundColor: 'var(--warning-soft)', borderColor: 'var(--warning-line)' }}>
            <Text className='text-sm whitespace-pre-wrap' style={{ color: 'var(--warning)' }}>
              {'⚠ '}
              {t('messages.questionCancelled')}
            </Text>
          </div>
        )}
      </div>
    </Card>
  );
});

export default MessageAcpQuestion;
