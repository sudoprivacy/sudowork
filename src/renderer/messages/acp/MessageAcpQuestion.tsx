/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card, Checkbox, Input, Message, Tag, Typography } from '@arco-design/web-react';
import { Check } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AcpQuestionAnswerItem, AcpQuestionItem, AcpQuestionItemOption, IMessageAcpQuestion } from '@/common/chatLib';
import { uuid } from '@/common/utils';
import { acpConversation } from '@/common/ipcBridge';

const { Text } = Typography;
const TextArea = Input.TextArea;

interface IQuestionSubmitResult {
  success: boolean;
  msg?: string;
}

interface IMessageAcpQuestionProps {
  message: IMessageAcpQuestion;
  className?: string;
  isInteractive?: boolean;
  variant?: 'message' | 'overlay';
  onAnswered?: (answer: { selectedAnswer: string; answerItems: AcpQuestionAnswerItem[] }) => void;
  onTeamAnswerQuestion?: (params: { conversationId: string; toolCallId: string; answers: Array<{ id: string; value: string; label?: string }> }) => Promise<IQuestionSubmitResult | void>;
  onTeamQuestionFallbackSend?: (params: { input: string; msg_id: string }) => Promise<IQuestionSubmitResult | void>;
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

const MessageAcpQuestion: React.FC<IMessageAcpQuestionProps> = React.memo(({ message, className = '', isInteractive = true, variant = 'message', onAnswered, onTeamAnswerQuestion, onTeamQuestionFallbackSend }) => {
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

  useEffect(() => {
    setHasResponded(message.content?.answered === true);
  }, [message.content?.answered]);
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

    try {
      const answers = answerPayload.answerItems.map((answer) => ({
        id: answer.id,
        value: answer.submissionValue,
        label: answer.displayValue || undefined,
      }));
      const toolCallId = message.content?.toolCallId ? message.content.responseToolCallId || message.content.toolCallId : undefined;
      const result = toolCallId
        ? onTeamAnswerQuestion
          ? await onTeamAnswerQuestion({ conversationId, toolCallId, answers })
          : await acpConversation.answerQuestion.invoke({ conversationId, toolCallId, answers })
        : onTeamQuestionFallbackSend
          ? await onTeamQuestionFallbackSend({ input: answerPayload.submission, msg_id: uuid() })
          : await acpConversation.sendMessage.invoke({
              input: answerPayload.submission,
              msg_id: uuid(),
              conversation_id: conversationId,
            });

      if (!result || result.success === true) {
        setHasResponded(true);
        if (onAnswered) {
          onAnswered({ selectedAnswer: answerPayload.display, answerItems: answerPayload.answerItems });
        } else {
          message.content.answered = true;
          message.content.selectedAnswer = answerPayload.display;
          message.content.answerItems = answerPayload.answerItems;
        }
      } else {
        Message.error(result?.msg || t('messages.failedToSendQuestionAnswer'));
      }
    } catch (error) {
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

  if (variant === 'overlay' && !hasResponded && !isCancelled && currentItem) {
    const heading = displayedIntro || question;
    const isPromptDistinct = currentItem.prompt.trim() !== heading.trim();

    return (
      <section className={`flex max-h-[70vh] flex-col overflow-hidden bg-card ${className}`}>
        <div className='min-h-0 flex-1 overflow-x-hidden overflow-y-auto'>
          <header className='flex items-start justify-between gap-4 px-5 pb-3 pt-5'>
            <div className='min-w-0 flex-1'>
              <Text className='block text-base font-medium leading-snug whitespace-pre-wrap'>{heading}</Text>
              {isPromptDistinct ? <Text className='mt-1 block text-sm text-foreground-secondary whitespace-pre-wrap'>{currentItem.prompt}</Text> : null}
            </div>
            {items.length > 1 ? (
              <Text className='shrink-0 pt-0.5 text-xs tabular-nums text-foreground-secondary'>
                {currentStep + 1} / {items.length}
              </Text>
            ) : null}
          </header>

          {currentKind !== 'text' && currentItem.options.length > 0 ? (
            <div className='px-3 pb-2'>
              {currentItem.options.map((option, index) => {
                const isSelected = currentKind === 'multi_select' ? currentMulti.includes(option.label) : selectedOptions[currentItem.id] === option.label;
                const content = (
                  <span className='min-w-0 flex-1'>
                    <span className='flex items-center gap-2 text-sm text-foreground'>
                      {option.label}
                      {option.recommended ? (
                        <Tag size='small' color='arcoblue'>
                          {t('messages.recommended')}
                        </Tag>
                      ) : null}
                    </span>
                    {option.description ? <span className='mt-0.5 block text-xs text-foreground-secondary'>{option.description}</span> : null}
                  </span>
                );
                return (
                  <div key={`${currentItem.id}-${option.value}`}>
                    {currentKind === 'multi_select' ? (
                      <div className='group flex w-full cursor-pointer items-center gap-3 rounded-xl bg-transparent px-3 py-2.5 text-left transition-colors hover:bg-fill-shallow' onClick={() => handleMultiOptionToggle(currentItem, option)}>
                        <span className='shrink-0' onClick={(event) => event.stopPropagation()}>
                          <Checkbox checked={isSelected} disabled={isResponding} onChange={() => handleMultiOptionToggle(currentItem, option)} />
                        </span>
                        {content}
                      </div>
                    ) : (
                      <button
                        type='button'
                        disabled={isResponding}
                        aria-label={option.label}
                        aria-pressed={isSelected}
                        className='group flex w-full items-center gap-3 rounded-xl border-none bg-transparent px-3 py-2.5 text-left transition-colors hover:bg-fill-shallow disabled:cursor-not-allowed disabled:opacity-50'
                        onClick={() => handleSingleOptionClick(currentItem, option)}
                      >
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-medium transition-colors ${isSelected ? 'bg-fill-medium text-foreground' : 'bg-fill-default text-foreground-secondary group-hover:bg-fill-medium group-hover:text-foreground'}`}>
                          {index + 1}
                        </span>
                        {content}
                        {isSelected ? <Check size={16} className='shrink-0 text-primary' /> : null}
                      </button>
                    )}
                    {index < currentItem.options.length - 1 ? <div className='mx-3 h-px bg-border' /> : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className='shrink-0 border-t border-border px-5 py-3'>
          {currentKind === 'text' || currentItem.allowCustomInput ? (
            <TextArea
              autoFocus={currentKind === 'text'}
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

          <div className={`flex items-center justify-end gap-2 ${currentKind === 'text' || currentItem.allowCustomInput ? 'mt-2' : ''}`}>
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
              <Button type='primary' size='small' disabled={isResponding || !canGoNext} onClick={handleSubmit}>
                {isResponding ? t('messages.processing') : t('messages.confirm')}
              </Button>
            )}
          </div>
        </div>
      </section>
    );
  }

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
    <Card className={`mb-4 bg-card ${className}`} bordered={false}>
      <div className='space-y-4'>
        <div className='flex items-start space-x-2'>
          <span className='text-2xl shrink-0'>{'💬'}</span>
          <div className='min-w-0 flex-1 mt-1'>{displayedIntro ? <Text className='block whitespace-pre-wrap'>{displayedIntro}</Text> : <Text className='block whitespace-pre-wrap'>{question}</Text>}</div>
        </div>

        {!hasResponded && !isCancelled && !isInteractive ? <Text className='block text-sm text-foreground-secondary'>{t('messages.waitingForUserInput')}</Text> : null}

        {!hasResponded && !isCancelled && isInteractive && (
          <>
            <div className='mt-10px'>
              <Text className='text-xs text-foreground-secondary'>{items.length > 1 ? `${currentStep + 1}/${items.length}` : t('messages.chooseAction')}</Text>
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
                            {option.description ? <Text className='pl-1 text-xs text-foreground-secondary'>{option.description}</Text> : null}
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
                    <Text className='text-xs text-foreground-secondary'>
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
                    <Button type='primary' size='small' disabled={isResponding || !canGoNext} onClick={handleSubmit}>
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
                <div key={item.id} className='rounded-md border border-border bg-muted p-2'>
                  <div className='mb-1 text-xs text-foreground-secondary'>
                    {items.length > 1 ? `${idx + 1}. ` : ''}
                    {item.prompt}
                  </div>
                  <Text className={`whitespace-pre-wrap text-sm ${skipped ? 'text-foreground-tertiary' : 'text-success'}`}>{skipped ? `⊘ ${t('messages.questionSkipped')}` : `✓ ${displayValue}`}</Text>
                </div>
              );
            })}
          </div>
        )}

        {isCancelled && (
          <div className='bg-warning-surface mt-2.5 rounded-md border border-border p-2'>
            <Text className='whitespace-pre-wrap text-sm text-warning'>
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
