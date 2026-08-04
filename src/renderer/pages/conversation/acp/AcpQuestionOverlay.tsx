import { Button, Checkbox, Input, Message, Tag, Typography } from '@arco-design/web-react';
import { Check } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { acpConversation } from '@/common/ipcBridge';
import type { AcpQuestionAnswerItem, AcpQuestionItemOption, IMessageAcpQuestion } from '@/common/chatLib';
import { uuid } from '@/common/utils';
import { normalizeAcpQuestionAnswerValue, normalizeAcpQuestionItems, resolveAcpQuestionKind, type INormalizedAcpQuestionItem } from '@renderer/messages/acp/acpQuestionUtils';

const { Text } = Typography;
const TextArea = Input.TextArea;

export default function AcpQuestionOverlay({ message, onAnswered, onTeamAnswerQuestion, onTeamQuestionFallbackSend }: IAcpQuestionOverlayProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const conversationId = message.content?.conversationId || message.conversation_id;
  const items = useMemo(() => normalizeAcpQuestionItems(message, { yes: t('messages.yes'), no: t('messages.no') }), [message, t]);
  const [isResponding, setIsResponding] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [selectedMulti, setSelectedMulti] = useState<Record<string, string[]>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [currentStep, setCurrentStep] = useState(0);
  const currentItem = items[currentStep];
  const currentKind = currentItem ? resolveAcpQuestionKind(currentItem) : 'text';
  const currentMulti = currentItem ? selectedMulti[currentItem.id] || [] : [];
  const currentValue = currentItem ? (currentKind === 'multi_select' ? currentMulti.join(' / ') : selectedOptions[currentItem.id] || customAnswers[currentItem.id] || '') : '';
  const canContinue = currentItem ? currentItem.optional || (currentKind === 'multi_select' ? currentMulti.length > 0 || Boolean(customAnswers[currentItem.id]?.trim()) : Boolean(currentValue.trim())) : false;

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const onSingleOptionClick = (item: INormalizedAcpQuestionItem, option: AcpQuestionItemOption) => {
    if (isResponding) return;
    setSelectedOptions((previous) => ({ ...previous, [item.id]: option.label }));
    setCustomAnswers((previous) => (previous[item.id] ? { ...previous, [item.id]: '' } : previous));
    if (currentStep < items.length - 1) setCurrentStep((previous) => previous + 1);
  };

  const onMultiOptionToggle = (item: INormalizedAcpQuestionItem, option: AcpQuestionItemOption) => {
    if (isResponding) return;
    setSelectedMulti((previous) => {
      const values = previous[item.id] || [];
      return { ...previous, [item.id]: values.includes(option.label) ? values.filter((value) => value !== option.label) : [...values, option.label] };
    });
  };

  const onSubmit = async () => {
    if (isResponding) return;
    const payload = buildAnswerPayload(items, selectedOptions, selectedMulti, customAnswers);
    if (!payload) {
      Message.warning(t('messages.completeRequiredAnswers'));
      return;
    }

    setIsResponding(true);
    try {
      const answers = payload.answerItems.map((answer) => ({ id: answer.id, value: answer.submissionValue, label: answer.displayValue || undefined }));
      const toolCallId = message.content?.toolCallId ? message.content.responseToolCallId || message.content.toolCallId : undefined;
      const result = toolCallId
        ? onTeamAnswerQuestion
          ? await onTeamAnswerQuestion({ conversationId, toolCallId, answers })
          : await acpConversation.answerQuestion.invoke({ conversationId, toolCallId, answers })
        : onTeamQuestionFallbackSend
          ? await onTeamQuestionFallbackSend({ input: payload.submission, msg_id: uuid() })
          : await acpConversation.sendMessage.invoke({ input: payload.submission, msg_id: uuid(), conversation_id: conversationId });

      if (!result || result.success === true) {
        onAnswered({ selectedAnswer: payload.display, answerItems: payload.answerItems });
      } else {
        Message.error(result.msg || t('messages.failedToSendQuestionAnswer'));
      }
    } catch (error) {
      console.error('Error sending question answer:', error);
      Message.error(t('messages.failedToSendQuestionAnswer'));
    } finally {
      setIsResponding(false);
    }
  };

  if (!message.content?.question || !currentItem) return null;

  const heading = message.content.intro || (items.length > 1 ? message.content.question : currentItem.prompt);
  const isPromptDistinct = currentItem.prompt.trim() !== heading.trim();

  return (
    <div className='pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-5 pb-4'>
      <div ref={panelRef} tabIndex={-1} className='pointer-events-auto max-h-[70vh] w-full max-w-800px overflow-hidden rounded-2xl bg-card shadow-lg outline-none animate-in fade-in slide-in-from-bottom-4 duration-200' role='region' aria-label={t('messages.waitingForUserInput')}>
        <section className='flex max-h-[70vh] flex-col overflow-hidden bg-card'>
          <div className='min-h-0 flex-1 overflow-x-hidden overflow-y-auto'>
            <header className='flex items-start justify-between gap-4 px-5 pb-3 pt-5'>
              <div className='min-w-0 flex-1'>
                <Text className='block whitespace-pre-wrap text-base font-medium leading-snug'>{heading}</Text>
                {isPromptDistinct ? <Text className='mt-1 block whitespace-pre-wrap text-sm text-foreground-secondary'>{currentItem.prompt}</Text> : null}
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
                        <div className='group flex w-full cursor-pointer items-center gap-3 rounded-xl bg-transparent px-3 py-2.5 text-left transition-colors hover:bg-fill-shallow' onClick={() => onMultiOptionToggle(currentItem, option)}>
                          <span className='shrink-0' onClick={(event) => event.stopPropagation()}>
                            <Checkbox checked={isSelected} disabled={isResponding} onChange={() => onMultiOptionToggle(currentItem, option)} />
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
                          onClick={() => onSingleOptionClick(currentItem, option)}
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
                onChange={(value) => {
                  setCustomAnswers((previous) => ({ ...previous, [currentItem.id]: value }));
                  if (currentKind !== 'multi_select' && selectedOptions[currentItem.id]) setSelectedOptions((previous) => ({ ...previous, [currentItem.id]: '' }));
                }}
              />
            ) : null}
            <div className={`flex items-center justify-end gap-2 ${currentKind === 'text' || currentItem.allowCustomInput ? 'mt-2' : ''}`}>
              {currentStep > 0 ? (
                <Button size='small' disabled={isResponding} onClick={() => setCurrentStep((previous) => Math.max(0, previous - 1))}>
                  {t('common.ariaLabel.back')}
                </Button>
              ) : null}
              {currentStep < items.length - 1 ? (
                <Button type='primary' size='small' disabled={isResponding || !canContinue} onClick={() => setCurrentStep((previous) => Math.min(items.length - 1, previous + 1))}>
                  {t('common.ariaLabel.next')}
                </Button>
              ) : (
                <Button type='primary' size='small' disabled={isResponding || !canContinue} onClick={onSubmit}>
                  {isResponding ? t('messages.processing') : t('messages.confirm')}
                </Button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function buildAnswerPayload(items: INormalizedAcpQuestionItem[], selectedOptions: Record<string, string>, selectedMulti: Record<string, string[]>, customAnswers: Record<string, string>): IAnswerPayload | null {
  const answers = items.map((item, index) => {
    const kind = resolveAcpQuestionKind(item);
    const custom = normalizeAcpQuestionAnswerValue(customAnswers[item.id] || '');
    let displayValue = '';
    let submissionValue = '';

    if (kind === 'multi_select') {
      const labels = selectedMulti[item.id] || [];
      displayValue = [...labels, ...(custom ? [custom] : [])].join(' / ');
      submissionValue = [...labels.map((label) => item.options.find((option) => option.label === label)?.value || label), ...(custom ? [custom] : [])].join(' / ');
    } else {
      const label = selectedOptions[item.id]?.trim();
      displayValue = label || custom;
      submissionValue = label ? item.options.find((option) => option.label === label)?.value || label : custom;
    }

    if (!displayValue && !submissionValue && !item.optional) return null;
    return { id: item.id, index: index + 1, submissionValue: submissionValue || '[skipped]', displayValue, skipped: !displayValue };
  });

  if (answers.some((answer) => answer === null)) return null;
  const resolved = answers.filter(Boolean) as AcpQuestionAnswerItem[];
  if (resolved.length === 0) return null;
  if (resolved.length === 1) return { submission: resolved[0].submissionValue, display: resolved[0].displayValue || '[skipped]', answerItems: resolved };
  return {
    submission: resolved.map(({ index, submissionValue }) => `Q${index}: ${submissionValue}`).join('\n'),
    display: resolved.map(({ index, displayValue, skipped }) => `${index}. ${skipped ? '[skipped]' : displayValue}`).join('\n'),
    answerItems: resolved,
  };
}

interface IAnswerPayload {
  submission: string;
  display: string;
  answerItems: AcpQuestionAnswerItem[];
}

interface IQuestionSubmitResult {
  success: boolean;
  msg?: string;
}

interface IAcpQuestionOverlayProps {
  message: IMessageAcpQuestion;
  onAnswered: (answer: { selectedAnswer: string; answerItems: AcpQuestionAnswerItem[] }) => void;
  onTeamAnswerQuestion?: (params: { conversationId: string; toolCallId: string; answers: Array<{ id: string; value: string; label?: string }> }) => Promise<IQuestionSubmitResult | void>;
  onTeamQuestionFallbackSend?: (params: { input: string; msg_id: string }) => Promise<IQuestionSubmitResult | void>;
}
