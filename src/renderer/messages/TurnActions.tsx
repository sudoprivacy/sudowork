/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { iconColors } from '@/renderer/theme/colors';
import { copyText } from '@/renderer/utils/clipboard';
import { ipcBridge } from '@/common';
import { emitter } from '@/renderer/utils/emitter';
import { Alert, Message, Tooltip } from '@arco-design/web-react';
import { Copy, FileWord } from '@icon-park/react';
import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

const TurnActions: React.FC<{ turnTexts: string[]; conversationId?: string }> = ({ turnTexts, conversationId }) => {
  const { t } = useTranslation();
  const [showCopyAlert, setShowCopyAlert] = useState(false);
  const [converting, setConverting] = useState(false);

  const handleCopy = () => {
    const textToCopy = turnTexts.join('\n\n');
    copyText(textToCopy)
      .then(() => {
        setShowCopyAlert(true);
        setTimeout(() => setShowCopyAlert(false), 2000);
      })
      .catch(() => {
        Message.error(t('common.copyFailed'));
      });
  };

  const handleConvertToWord = useCallback(async () => {
    if (converting || !conversationId) return;
    setConverting(true);
    try {
      const res = await ipcBridge.document.saveAsDocx.invoke({
        markdown: turnTexts.join('\n\n'),
        conversationId,
      });

      if (res?.success && res.data) {
        Message.success(t('messages.convertSuccess', { defaultValue: 'Converted to Word successfully' }));
        emitter.emit('chat.history.refresh');
        emitter.emit('acp.workspace.refresh');
        emitter.emit('openclaw-gateway.workspace.refresh');
        void ipcBridge.shell.showItemInFolder.invoke(res.data);
      } else {
        Message.error(res?.msg || t('messages.convertFailed', { defaultValue: 'Failed to convert to Word' }));
      }
    } catch (error) {
      console.error('Failed to convert to Word:', error);
      Message.error(t('messages.convertFailed', { defaultValue: 'Failed to convert to Word' }));
    } finally {
      setConverting(false);
    }
  }, [turnTexts, conversationId, t, converting]);

  return (
    <>
      <div className='flex items-center h-28px gap-4px'>
        <Tooltip content={t('common.copy', { defaultValue: 'Copy' })}>
          <div className='p-4px rd-4px cursor-pointer hover:bg-3 transition-colors' onClick={handleCopy} style={{ lineHeight: 0 }}>
            <Copy theme='outline' size='16' fill={iconColors.secondary} />
          </div>
        </Tooltip>
        <Tooltip content={t('messages.convertToWord', { defaultValue: 'Convert to Word' })}>
          <div className='p-4px rd-4px cursor-pointer hover:bg-3 transition-colors' onClick={handleConvertToWord} style={{ lineHeight: 0 }}>
            <FileWord theme='outline' size='16' fill={converting ? iconColors.disabled : iconColors.secondary} />
          </div>
        </Tooltip>
      </div>
      {showCopyAlert && <Alert type='success' content={t('messages.copySuccess')} showIcon className='fixed top-20px left-50% transform -translate-x-50% z-9999 w-max max-w-[80%]' style={{ boxShadow: '0px 2px 12px rgba(0,0,0,0.12)' }} closable={false} />}
    </>
  );
};

export default TurnActions;
