/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { iconColors } from '@/renderer/theme/colors';
import { copyText } from '@/renderer/utils/clipboard';
import { ipcBridge } from '@/common';
import { emitter } from '@/renderer/utils/emitter';
import { Alert, Message, Popover, Tooltip } from '@arco-design/web-react';
import { Check, Copy, FileWord, ShareOne } from '@icon-park/react';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const TurnActions: React.FC<{ turnTexts: string[]; turnTextsRaw: string[]; conversationId?: string }> = ({ turnTexts, turnTextsRaw, conversationId }) => {
  const { t } = useTranslation();
  const [showCopyAlert, setShowCopyAlert] = useState(false);
  const [converting, setConverting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareoneInstalled, setShareoneInstalled] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharePopoverVisible, setSharePopoverVisible] = useState(false);
  const shareTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    try {
      const markdown = turnTextsRaw.join('\n\n');
      const firstUserText = turnTextsRaw[0] || '';
      const title = firstUserText.slice(0, 50) || 'SudoWork Share';
      const res = await ipcBridge.shareoneCli.publishTurn.invoke({ markdown, title });
      if (res?.success && res.data) {
        await copyText(res.data.url);
        setShareUrl(res.data.url);
        setSharePopoverVisible(true);
        if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
        shareTimerRef.current = setTimeout(() => {
          setSharePopoverVisible(false);
          setShareUrl(null);
        }, 5000);
      } else if (res?.code === 'AUTH_REQUIRED') {
        Message.warning(t('messages.shareAuthRequired'));
      } else {
        Message.error(res?.msg || t('messages.shareFailed', { msg: '' }));
      }
    } catch (error) {
      console.error('Failed to share via ShareOne:', error);
      Message.error(t('messages.shareFailed', { msg: String(error) }));
    } finally {
      setSharing(false);
    }
  }, [turnTexts, shareoneInstalled, sharing, t]);

  const handleCopyShareUrl = useCallback(() => {
    if (!shareUrl) return;
    copyText(shareUrl);
  }, [shareUrl]);

  const sharePopoverContent = shareUrl ? (
    <div className='flex items-center gap-8px py-4px'>
      <span className='text-13px color-success font-500'>{t('messages.shareSuccessShort')}</span>
      <a href={shareUrl} target='_blank' rel='noopener noreferrer' className='text-12px color-primary underline break-all max-w-180px inline-block truncate hover:opacity-80'>{shareUrl}</a>
      <span className='cursor-pointer color-primary opacity-70 hover:opacity-100 transition-opacity' onClick={handleCopyShareUrl} style={{ lineHeight: 0 }}>
        <Copy theme='outline' size='14' />
      </span>
    </div>
  ) : null;

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
        <Popover
          content={sharePopoverContent}
          position='top'
          trigger='click'
          popupVisible={sharePopoverVisible}
          onVisibleChange={(visible) => {
            if (!visible) {
              setSharePopoverVisible(false);
              setShareUrl(null);
              if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
            }
          }}
          unmountOnExit
        >
          <Tooltip content={shareoneInstalled ? t('messages.shareone') : t('messages.shareCliNotInstalled')}>
            <div className='p-4px rd-4px cursor-pointer hover:bg-3 transition-colors' onClick={shareoneInstalled && !sharing ? handleShare : undefined} style={{ lineHeight: 0, opacity: shareoneInstalled ? 1 : 0.4 }}>
              {sharePopoverVisible ? <Check theme='outline' size='16' fill={iconColors.success} /> : <ShareOne theme='outline' size='16' fill={sharing ? iconColors.disabled : iconColors.secondary} />}
            </div>
          </Tooltip>
        </Popover>
      </div>
      {showCopyAlert && <Alert type='success' content={t('messages.copySuccess')} showIcon className='fixed top-20px left-50% transform -translate-x-50% z-9999 w-max max-w-[80%]' style={{ boxShadow: 'var(--shadow-md)' }} closable={false} />}
    </>
  );
};

export default TurnActions;