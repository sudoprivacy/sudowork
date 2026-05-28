/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { iconColors } from '@/renderer/theme/colors';
import { copyText } from '@/renderer/utils/clipboard';
import { ipcBridge } from '@/common';
import { emitter } from '@/renderer/utils/emitter';
import { showShareLoading, updateShareSuccess, updateShareError } from '@/renderer/utils/shareNotify';
import { Alert, Message, Tooltip } from '@arco-design/web-react';
import { Copy, FileWord, ShareOne } from '@icon-park/react';
import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const TurnActions: React.FC<{ turnTexts: string[]; turnTextsRaw: string[]; conversationId?: string }> = ({ turnTexts, turnTextsRaw, conversationId }) => {
  const { t } = useTranslation();
  const [showCopyAlert, setShowCopyAlert] = useState(false);
  const [converting, setConverting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareoneInstalled, setShareoneInstalled] = useState(false);

  useEffect(() => {
    void ipcBridge.shareoneCli.checkInstalled.invoke().then((res) => {
      if (res?.success && res.data?.installed) {
        setShareoneInstalled(true);
      }
    });
  }, []);

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

  const handleShare = useCallback(async () => {
    if (!shareoneInstalled || sharing) return;
    setSharing(true);
    const notifyId = showShareLoading();
    try {
      const markdown = turnTextsRaw.join('\n\n');
      const firstUserText = turnTextsRaw[0] || '';
      const title = firstUserText.slice(0, 50) || 'SudoWork Share';
      const res = await ipcBridge.shareoneCli.publishTurn.invoke({ markdown, title });
      if (res?.success && res.data) {
        updateShareSuccess(notifyId, res.data.url);
      } else if (res?.code === 'AUTH_FAILED') {
        updateShareError(notifyId, res.msg || t('messages.shareAuthRequired'));
      } else {
        updateShareError(notifyId, res?.msg || t('messages.shareFailed', { msg: '' }));
      }
    } catch (error) {
      console.error('Failed to share via ShareOne:', error);
      updateShareError(notifyId, String(error));
    } finally {
      setSharing(false);
    }
  }, [turnTexts, shareoneInstalled, sharing, t]);

  return (
    <>
      <div className='flex items-center h-28px gap-4px pl-48px'>
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
        <Tooltip content={shareoneInstalled ? t('messages.shareone') : t('messages.shareCliNotInstalled')}>
          <div className='p-4px rd-4px cursor-pointer hover:bg-3 transition-colors' onClick={shareoneInstalled && !sharing ? handleShare : undefined} style={{ lineHeight: 0, opacity: shareoneInstalled ? 1 : 0.4 }}>
            <ShareOne theme='outline' size='16' fill={sharing ? iconColors.disabled : iconColors.secondary} />
          </div>
        </Tooltip>
      </div>
      {showCopyAlert && <Alert type='success' content={t('messages.copySuccess')} showIcon className='fixed top-20px left-50% transform -translate-x-50% z-9999 w-max max-w-[80%]' style={{ boxShadow: 'var(--shadow-md)' }} closable={false} />}
    </>
  );
};

export default TurnActions;