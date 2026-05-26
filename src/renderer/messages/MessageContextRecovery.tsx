/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { conversation } from '@/common/ipcBridge';
import type { IMessageContextRecovery } from '@/common/chatLib';
import { Button, Card, Message, Typography } from '@arco-design/web-react';
import { IconExclamationCircle, IconRefresh } from '@arco-design/web-react/icon';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

const MessageContextRecovery: React.FC<{ message: IMessageContextRecovery }> = React.memo(({ message }) => {
  const { t } = useTranslation();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const { reason, actions, error } = message.content;

  if (dismissed) return null;

  const isOverflowed = reason === 'overflowed' || reason === 'failed';
  const title = isOverflowed ? t('messages.contextRecovery.overflowTitle', { defaultValue: '当前模型会话已超过上下文限制' }) : t('messages.contextRecovery.nearLimitTitle', { defaultValue: '当前对话上下文接近模型上限' });
  const description = isOverflowed ? t('messages.contextRecovery.overflowDescription', { defaultValue: '无法继续向原会话发送消息。你可以压缩历史后继续，或开启一个空白模型上下文继续。' }) : t('messages.contextRecovery.nearLimitDescription', { defaultValue: '继续发送可能失败。你可以现在压缩上下文，或稍后继续。' });
  const actionLabels: Record<string, string> = {
    compress: isOverflowed ? t('messages.contextRecovery.compressAndContinue', { defaultValue: '压缩并继续' }) : t('messages.contextRecovery.compressLater', { defaultValue: '压缩后继续' }),
    fresh: isOverflowed ? t('messages.contextRecovery.freshSession', { defaultValue: '开启空白新会话' }) : t('messages.contextRecovery.freshContinue', { defaultValue: '新会话继续' }),
    dismiss: t('messages.contextRecovery.dismiss', { defaultValue: '继续当前会话' }),
  };

  const handleAction = async (actionId: string) => {
    if (actionId === 'dismiss') {
      setDismissed(true);
      return;
    }
    if (actionId !== 'compress' && actionId !== 'fresh') return;

    setBusyAction(actionId);
    try {
      const result = await conversation.recoverContext.invoke({
        conversation_id: message.conversation_id,
        strategy: actionId,
      });
      if (!result.success) {
        Message.error(result.msg || t('messages.contextRecovery.recoverFailed', { defaultValue: '恢复上下文失败' }));
        return;
      }
      Message.success(actionId === 'compress' ? t('messages.contextRecovery.compressSuccess', { defaultValue: '已压缩此前上下文，可以继续对话' }) : t('messages.contextRecovery.freshSuccess', { defaultValue: '已开启新的模型上下文' }));
      setDismissed(true);
    } catch (err) {
      Message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <Card className='w-full mb-2' bordered={false} style={{ background: 'var(--bg-1)' }}>
      <div className='flex items-start gap-10px'>
        <div className='mt-2px color-warning'>{isOverflowed ? <IconExclamationCircle fontSize={18} /> : <IconRefresh fontSize={18} />}</div>
        <div className='flex-1 min-w-0'>
          <div className='font-500 text-t-primary mb-4px'>{title}</div>
          <Text type='secondary' className='block [word-break:break-word]'>
            {description}
          </Text>
          {error && (
            <div className='mt-8px text-12px color-#86909c [word-break:break-word]'>
              {t('messages.contextRecovery.errorPrefix', { defaultValue: '错误信息：' })}
              {error}
            </div>
          )}
          <div className='mt-12px flex flex-wrap gap-8px'>
            {actions.map((action) => (
              <Button key={action.id} size='small' type={action.id === 'compress' ? 'primary' : 'secondary'} loading={busyAction === action.id} disabled={busyAction !== null && busyAction !== action.id} onClick={() => void handleAction(action.id)}>
                {actionLabels[action.id] || action.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
});

export default MessageContextRecovery;
