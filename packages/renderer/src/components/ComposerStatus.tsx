import React from 'react';
import { useTranslation } from 'react-i18next';
import type { InputDelivery } from '@sudowork/contracts/input-delivery';

export interface QueuedComposerInput {
  id: string;
  preview: string;
  delivery?: InputDelivery;
}

/** Queue state occupies its own row above the editor, including in single-line mode. */
export function ComposerQueue({ inputs }: IComposerQueueProps) {
  const { t } = useTranslation();
  if (!inputs?.length) return null;
  return (
    <div className='flex flex-wrap gap-2 mb-2 w-full min-w-0' data-testid='composer-queue'>
      {inputs.map((input) => (
        <span key={input.id} data-testid='queued-input-chip' title={input.preview} className='inline-flex items-center max-w-full px-2 py-1 rounded bg-2 text-xs text-secondary'>
          {input.delivery && <span className='mr-1 flex-none font-medium'>{t(`messages.inputDelivery.${input.delivery}`)} · </span>}
          <span className='truncate min-w-0'>{input.preview}</span>
        </span>
      ))}
    </div>
  );
}

/** Keyboard help is ancillary chrome below the composer controls, outside the editor surface. */
export function ComposerKeyHints({ isEnabled, isRunning, isAnsweringQuestion, isQueuePending }: IComposerKeyHintsProps) {
  const { t } = useTranslation();
  if (!isEnabled || isAnsweringQuestion || (!isRunning && !isQueuePending)) return null;
  return (
    <div className='text-xs text-secondary px-3 mt-1 leading-relaxed' data-testid='input-delivery-hint'>
      {isRunning && <>{t('messages.inputDelivery.keys')} · </>}
      {t(isQueuePending ? 'messages.inputDelivery.flushHint' : 'messages.inputDelivery.cancelHint')}
    </div>
  );
}

interface IComposerQueueProps {
  inputs?: QueuedComposerInput[];
}
interface IComposerKeyHintsProps {
  isEnabled: boolean;
  isRunning: boolean;
  isAnsweringQuestion: boolean;
  isQueuePending: boolean;
}
