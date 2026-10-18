/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Attention, CheckOne } from '@icon-park/react';
import { theme } from '@office-ai/platform';
import classNames from 'classnames';
import React, { useMemo, useRef, useState } from 'react';
import type { IMessageTips } from '@sudowork/common/chatLib';
import { Button, Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import MarkdownView from '../components/Markdown';
import CollapsibleContent from '../components/CollapsibleContent';
import RuntimeErrorBanner from './RuntimeErrorBanner';

const icon = {
  success: <CheckOne theme='filled' size='16' fill={theme.Color.FunctionalColor.success} className='m-t-2px' />,
  warning: <Attention theme='filled' size='16' strokeLinejoin='bevel' className='m-t-2px' fill={theme.Color.FunctionalColor.warn} />,
  error: <Attention theme='filled' size='16' strokeLinejoin='bevel' className='m-t-2px' fill={theme.Color.FunctionalColor.error} />,
};

const useFormatContent = (content: string) => {
  return useMemo(() => {
    try {
      const json = JSON.parse(content);
      return {
        json: true,
        data: json,
      };
    } catch {
      return { data: content };
    }
  }, [content]);
};

const MessageTips: React.FC<{ message: IMessageTips }> = ({ message }) => {
  const { content, type, errorClass, errorBytes } = message.content;
  // Hooks must run unconditionally — call before any early return.
  const { json, data } = useFormatContent(content);

  // Classified runtime error → render the differentiated banner.
  // Falls back to the legacy text tip if the renderer doesn't recognise
  // the errorClass (RuntimeErrorBanner handles that defensively).
  if (type === 'error' && errorClass) {
    if (errorClass === 'runtime_update_required') return <RuntimeUpdateTip message={message} />;
    return <RuntimeErrorBanner errorClass={errorClass} errorBytes={errorBytes} fallbackContent={content} />;
  }

  const displayContent = json ? '' : content;

  if (json)
    return (
      <div className='w-full'>
        <div className={classNames('bg-message-tips rd-8px p-x-12px p-y-8px flex items-start gap-4px')}>
          {icon[type] || icon.warning}
          <MarkdownView>{`\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``}</MarkdownView>
        </div>
      </div>
    );
  return (
    <div className='w-full'>
      <div className={classNames('bg-message-tips rd-8px  p-x-12px p-y-8px flex items-start gap-4px')}>
        {icon[type] || icon.warning}
        <CollapsibleContent maxHeight={48} defaultCollapsed={true} className='flex-1' useMask={true}>
          <span
            className='whitespace-break-spaces text-foreground [word-break:break-word]'
            dangerouslySetInnerHTML={{
              __html: displayContent,
            }}
          ></span>
        </CollapsibleContent>
      </div>
    </div>
  );
};

export default MessageTips;

function RuntimeUpdateTip({ message }: IRuntimeUpdateTipProps) {
  const { t } = useTranslation();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isUpdated, setIsUpdated] = useState(false);
  const isPending = useRef(false);
  const onUpdate = async () => {
    if (isPending.current || isUpdated) return;
    isPending.current = true;
    setIsUpdating(true);
    try {
      const result = await ipcBridge.moss.upgradeRuntime.invoke({ conversationId: message.conversation_id });
      if (!result.success) throw new Error('Runtime update was not confirmed');
      setIsUpdated(true);
    } catch {
      Message.error(t('runtimeError.runtime_update_required.failed'));
    } finally {
      isPending.current = false;
      setIsUpdating(false);
    }
  };
  return (
    <div className='w-full'>
      <RuntimeErrorBanner errorClass='runtime_update_required' fallbackContent={message.content.content} />
      {isUpdated ? (
        <div role='status' className='text-foreground mt-2'>
          {t('runtimeError.runtime_update_required.updated')}
        </div>
      ) : (
        <Button className='mt-2' loading={isUpdating} disabled={isUpdating} onClick={() => void onUpdate()}>
          {t('runtimeError.runtime_update_required.cta')}
        </Button>
      )}
    </div>
  );
}

interface IRuntimeUpdateTipProps {
  message: IMessageTips;
}
