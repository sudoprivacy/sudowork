import { Button, Divider, Typography } from '@arco-design/web-react';
import type { PropsWithChildren } from 'react';
import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IConfirmation } from '@sudowork/common/chatLib';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { removeStack } from '../../../utils';
import styles from './ConversationChatConfirm.module.css';

function ConversationChatConfirm({ conversation_id, children }: PropsWithChildren<IConversationChatConfirmProps>) {
  const [confirmations, setConfirmations] = useState<IConfirmation<unknown>[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { t } = useTranslation();
  useEffect(() => {
    // Fix #475: Add error handling and retry mechanism
    let retryCount = 0;
    const maxRetries = 3;

    const loadConfirmations = async () => {
      try {
        const data = await ipcBridge.conversation.confirmation.list.invoke({ conversation_id });
        setConfirmations(data);
        setLoadError(null);
      } catch (error) {
        console.error('[ConversationChatConfirm] Failed to load confirmations:', error);
        if (retryCount < maxRetries) {
          retryCount++;
          setTimeout(loadConfirmations, 1000);
        } else {
          const errorMsg = error instanceof Error ? error.message : 'Failed to load confirmations';
          setLoadError(errorMsg);
        }
      }
    };

    void loadConfirmations();

    return removeStack(
      ipcBridge.conversation.confirmation.add.on((data) => {
        if (conversation_id !== data.conversation_id) return;
        setConfirmations((prev) => prev.concat(data));
        setLoadError(null);
      }),
      ipcBridge.conversation.confirmation.remove.on((data) => {
        if (conversation_id !== data.conversation_id) return;
        setConfirmations((prev) => prev.filter((p) => p.id !== data.id));
      }),
      ipcBridge.conversation.confirmation.update.on(({ ...data }) => {
        if (conversation_id !== data.conversation_id) return;
        setConfirmations((list) => list.map((p) => (p.id === data.id ? { ...p, ...data } : p)));
      })
    );
  }, [conversation_id]);

  const onConfirmOption = useCallback(
    (confirmation: IConfirmation<unknown>, option: IConfirmation<unknown>['options'][number]) => {
      setConfirmations((prev) => prev.filter((p) => p.id !== confirmation.id));
      void ipcBridge.conversation.confirmation.confirm.invoke({
        conversation_id,
        callId: confirmation.callId,
        msg_id: confirmation.id,
        data: option.value,
      });
    },
    [conversation_id]
  );

  // Install shortcuts in the same commit as the visible actions, before paint.
  // Mouse and keyboard actions share the same submission path.
  useLayoutEffect(() => {
    if (!confirmations.length) return;
    const confirmation = confirmations[0];
    const onKeyDown = (event: KeyboardEvent) => {
      // Skip if user is typing in an input
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      // Let a focused action button handle its own native Enter activation.
      if (event.key === 'Enter' && target.closest('button')) return;

      const options = confirmation.options;

      // Enter → first option (typically Allow)
      if (event.key === 'Enter') {
        event.preventDefault();
        if (options[0]) onConfirmOption(confirmation, options[0]);
        return;
      }

      // Escape / N → cancel
      if (event.key === 'Escape' || event.key.toLowerCase() === 'n') {
        const cancelOpt = options.find((opt) => opt.value === 'cancel');
        if (cancelOpt) {
          event.preventDefault();
          onConfirmOption(confirmation, cancelOpt);
        }
        return;
      }

      // Y → proceed_once (Allow)
      if (event.key.toLowerCase() === 'y') {
        const allowOpt = options.find((opt) => opt.value === 'proceed_once');
        if (allowOpt) {
          event.preventDefault();
          onConfirmOption(confirmation, allowOpt);
        }
        return;
      }

      // A → proceed_always (Always Allow)
      if (event.key.toLowerCase() === 'a') {
        const alwaysOpt = options.find((opt) => opt.value === 'proceed_always');
        if (alwaysOpt) {
          event.preventDefault();
          onConfirmOption(confirmation, alwaysOpt);
        }
        return;
      }

      // Number keys 1-9 → select by index
      const num = parseInt(event.key, 10);
      if (num >= 1 && num <= options.length) {
        event.preventDefault();
        onConfirmOption(confirmation, options[num - 1]);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [confirmations, onConfirmOption]);
  const isConfirmationVisible = confirmations.length > 0;
  const confirmation = isConfirmationVisible ? confirmations[0] : null;
  const $t = (key: string, params?: Record<string, string>) => t(key, { ...params, defaultValue: key });

  // Keep children in a stable tree position to prevent unmount/remount when confirmation state changes.
  // Previously, switching between <>{children}</> and <div>...<div className='hidden'>{children}</div></div>
  // caused React to unmount and remount children (e.g., AcpSendBox), which triggered duplicate message sends.
  return (
    <>
      {loadError && !isConfirmationVisible && (
        <section className={styles.panel} role='alert'>
          <div className='text-danger text-sm font-medium mb-2'>{t('conversation.chat.confirmationLoadError', 'Failed to load confirmation dialog')}</div>
          <div className='text-secondary text-sm mb-3'>{loadError}</div>
          <Button
            type='primary'
            size='small'
            onClick={() => {
              setLoadError(null);
              void ipcBridge.conversation.confirmation.list
                .invoke({ conversation_id })
                .then((data) => setConfirmations(data))
                .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load'));
            }}
          >
            {t('common.retry', 'Retry')}
          </Button>
        </section>
      )}
      {isConfirmationVisible && confirmation && (
        <section className={styles.panel} aria-label={$t(confirmation.title || 'messages.permissionRequest')}>
          <div className='flex-1 overflow-y-auto min-h-0'>
            <Typography.Ellipsis className={styles.title} rows={2} expandable>
              {$t(confirmation.title || 'messages.permissionRequest')}
            </Typography.Ellipsis>
            <Divider className='!my-2.5' />
            <Typography.Ellipsis className={styles.description} rows={5} expandable>
              {$t(confirmation.description)}
            </Typography.Ellipsis>
          </div>
          <div className='shrink-0 flex flex-col gap-2.5 mt-2.5'>
            {confirmation.options.map((option, index) => {
              const label = $t(option.label, option.params);
              const shortcut = index === 0 ? 'Enter' : option.value === 'cancel' ? 'Esc' : option.value === 'proceed_always' ? 'A' : option.value === 'proceed_once' ? 'Y' : String(index + 1);
              return (
                <Button key={String(option.value) + index} type='secondary' className={styles.option} onClick={() => onConfirmOption(confirmation, option)}>
                  <kbd className={styles.shortcut}>{shortcut}</kbd>
                  <span className={styles.label}>{label}</span>
                </Button>
              );
            })}
          </div>
        </section>
      )}
      <div className={isConfirmationVisible ? 'hidden' : ''} style={isConfirmationVisible ? { visibility: 'hidden', height: 0, overflow: 'hidden' } : {}}>
        {children}
      </div>
    </>
  );
}

interface IConversationChatConfirmProps {
  conversation_id: string;
}

export default ConversationChatConfirm;
