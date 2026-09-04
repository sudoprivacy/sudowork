/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Message, Tooltip } from '@arco-design/web-react';
import { Copy, FileWord, ShareOne } from '@icon-park/react';
import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TurnTokenUsage } from '@sudowork/common/chatLib';
import { costToUsagePoints, formatUsagePoints, resolveUsagePoints } from '@sudowork/common/tokenUsage';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { copyText } from '@renderer/utils/clipboard';
import { emitter } from '@renderer/utils/emitter';
import { showShareLoading, updateShareSuccess, updateShareError } from '@renderer/utils/shareNotify';

const formatTokenCount = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return new Intl.NumberFormat().format(value);
};

type TurnActionsProps = {
  turnTexts: string[];
  turnTextsRaw: string[];
  conversationId?: string;
  tokenUsage?: TurnTokenUsage;
  showTokenUsageBadge?: boolean;
};

const TurnActions: React.FC<TurnActionsProps> = ({ turnTexts, turnTextsRaw, conversationId, tokenUsage, showTokenUsageBadge = false }) => {
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
  }, [turnTextsRaw, shareoneInstalled, sharing, t]);

  const totalTokens = formatTokenCount(tokenUsage?.totalTokens);
  const points = formatUsagePoints(resolveUsagePoints(tokenUsage));
  const hasExactUsagePoints = tokenUsage?.costCurrency === 'sudo_point' && costToUsagePoints(tokenUsage.costUnits) !== null;
  const pointsTooltipLabel = points
    ? t(hasExactUsagePoints ? 'messages.tokenUsagePointsExact' : 'messages.tokenUsagePointsEstimated', {
        defaultValue: hasExactUsagePoints ? 'Points: {{value}} (exact)' : 'Points: {{value}} (estimated)',
        value: points,
      })
    : null;
  const inputTokens = formatTokenCount(tokenUsage?.inputTokens);
  const outputTokens = formatTokenCount(tokenUsage?.outputTokens);
  const cachedReadTokens = tokenUsage?.cachedReadTokens ? formatTokenCount(tokenUsage.cachedReadTokens) : null;
  const cachedWriteTokens = tokenUsage?.cachedWriteTokens ? formatTokenCount(tokenUsage.cachedWriteTokens) : null;
  const thoughtTokens = tokenUsage?.thoughtTokens ? formatTokenCount(tokenUsage.thoughtTokens) : null;
  const usageTooltip = tokenUsage ? (
    <div className='text-12px leading-18px'>
      <div>{t('messages.tokenUsageTotal', { defaultValue: 'Total: {{value}} tokens', value: new Intl.NumberFormat().format(tokenUsage.totalTokens) })}</div>
      {pointsTooltipLabel && <div>{pointsTooltipLabel}</div>}
      {typeof tokenUsage.inputTokens === 'number' && <div>{t('messages.tokenUsageInput', { defaultValue: 'Input: {{value}}', value: new Intl.NumberFormat().format(tokenUsage.inputTokens) })}</div>}
      {typeof tokenUsage.outputTokens === 'number' && <div>{t('messages.tokenUsageOutput', { defaultValue: 'Output: {{value}}', value: new Intl.NumberFormat().format(tokenUsage.outputTokens) })}</div>}
      {typeof tokenUsage.thoughtTokens === 'number' && <div>{t('messages.tokenUsageThought', { defaultValue: 'Reasoning: {{value}}', value: new Intl.NumberFormat().format(tokenUsage.thoughtTokens) })}</div>}
      {typeof tokenUsage.cachedReadTokens === 'number' && tokenUsage.cachedReadTokens > 0 && <div>{t('messages.tokenUsageCachedRead', { defaultValue: 'Cache read: {{value}}', value: new Intl.NumberFormat().format(tokenUsage.cachedReadTokens) })}</div>}
      {typeof tokenUsage.cachedWriteTokens === 'number' && tokenUsage.cachedWriteTokens > 0 && <div>{t('messages.tokenUsageCachedWrite', { defaultValue: 'Cache write: {{value}}', value: new Intl.NumberFormat().format(tokenUsage.cachedWriteTokens) })}</div>}
    </div>
  ) : null;

  return (
    <>
      <div className='flex items-center min-h-28px gap-4px flex-wrap'>
        <Tooltip content={t('common.copy', { defaultValue: 'Copy' })}>
          <div className='p-4px rd-4px cursor-pointer hover:bg-3 transition-colors' onClick={handleCopy} style={{ lineHeight: 0 }}>
            <Copy theme='outline' size='16' fill={'var(--text-secondary)'} />
          </div>
        </Tooltip>
        <Tooltip content={t('messages.convertToWord', { defaultValue: 'Convert to Word' })}>
          <div className='p-4px rd-4px cursor-pointer hover:bg-3 transition-colors' onClick={handleConvertToWord} style={{ lineHeight: 0 }}>
            <FileWord theme='outline' size='16' fill={converting ? 'var(--text-disabled)' : 'var(--text-secondary)'} />
          </div>
        </Tooltip>
        <Tooltip content={shareoneInstalled ? t('messages.shareone') : t('messages.shareCliNotInstalled')}>
          <div className='p-4px rd-4px cursor-pointer hover:bg-3 transition-colors' onClick={shareoneInstalled && !sharing ? handleShare : undefined} style={{ lineHeight: 0, opacity: shareoneInstalled ? 1 : 0.4 }}>
            <ShareOne theme='outline' size='16' fill={sharing ? 'var(--text-disabled)' : 'var(--text-secondary)'} />
          </div>
        </Tooltip>
        {showTokenUsageBadge && totalTokens && (
          <Tooltip content={usageTooltip}>
            <div className='ml-4px max-w-full truncate text-11px leading-18px px-6px py-1px rd-4px border border-light text-secondary bg-fill-1'>
              {t('messages.tokenUsageSummary', { defaultValue: '{{total}} tokens', total: totalTokens })}
              {points ? ` · ${t('messages.tokenUsagePointsShort', { defaultValue: '{{value}} points', value: points })}` : ''}
              {inputTokens && outputTokens ? ` · ${t('messages.tokenUsageInOut', { defaultValue: 'in {{input}} / out {{output}}', input: inputTokens, output: outputTokens })}` : ''}
              {thoughtTokens ? ` · ${t('messages.tokenUsageReasoningShort', { defaultValue: 'reasoning {{value}}', value: thoughtTokens })}` : ''}
              {cachedReadTokens ? ` · ${t('messages.tokenUsageCacheReadShort', { defaultValue: 'cache {{value}}', value: cachedReadTokens })}` : ''}
              {cachedWriteTokens ? ` · ${t('messages.tokenUsageCacheWriteShort', { defaultValue: 'write {{value}}', value: cachedWriteTokens })}` : ''}
            </div>
          </Tooltip>
        )}
      </div>
      {showCopyAlert && <Alert type='success' content={t('messages.copySuccess')} showIcon className='fixed top-20px left-50% transform -translate-x-50% z-9999 w-max max-w-[80%]' style={{ boxShadow: 'var(--shadow-md)' }} closable={false} />}
    </>
  );
};

export default TurnActions;
