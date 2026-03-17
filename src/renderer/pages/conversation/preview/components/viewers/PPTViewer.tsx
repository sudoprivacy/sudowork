/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { usePreviewToolbarExtras } from '../../context/PreviewToolbarExtrasContext';
import { Button, Message } from '@arco-design/web-react';
import { IconRefresh } from '@arco-design/web-react/icon';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PDFViewer from './PDFViewer';

interface PPTPreviewProps {
  filePath?: string;
  content?: string;
  hideToolbar?: boolean;
}

// 缓存 Map / Cache Map
const pdfCache = new Map<string, { pdfPath: string; timestamp: number }>();
const CACHE_TIMEOUT = 5 * 60 * 1000; // 5 分钟

/**
 * PPT 演示文稿预览组件
 *
 * 优先使用 LibreOffice 转 PDF 预览，如果 LibreOffice 不可用则引导用户使用系统应用打开
 */
const PPTPreview: React.FC<PPTPreviewProps> = ({ filePath, content, hideToolbar = false }) => {
  void content;
  const { t } = useTranslation();
  const [messageApi, messageContextHolder] = Message.useMessage();
  const toolbarExtrasContext = usePreviewToolbarExtras();
  const usePortalToolbar = Boolean(toolbarExtrasContext) && !hideToolbar;

  const [pdfPath, setPdfPath] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [useLibreOffice, setUseLibreOffice] = useState<boolean>(false);
  const messageApiRef = useRef(messageApi);

  useEffect(() => {
    messageApiRef.current = messageApi;
  }, [messageApi]);

  const handleOpenInSystem = useCallback(async () => {
    if (!filePath) {
      messageApiRef.current.error(t('preview.errors.openWithoutPath'));
      return;
    }

    try {
      await ipcBridge.shell.openFile.invoke(filePath);
      messageApiRef.current.info(t('preview.openInSystemSuccess'));
    } catch (err) {
      messageApiRef.current.error(t('preview.openInSystemFailed'));
    }
  }, [filePath, t]);

  const handleShowInFolder = useCallback(async () => {
    if (!filePath) {
      messageApiRef.current.error(t('preview.errors.openWithoutPath'));
      return;
    }

    try {
      await ipcBridge.shell.showItemInFolder.invoke(filePath);
    } catch (err) {
      messageApiRef.current.error(t('preview.openInSystemFailed'));
    }
  }, [filePath, t]);

  const handleRefresh = useCallback(async () => {
    if (filePath) {
      pdfCache.delete(filePath); // 清除缓存
      setLoading(true);
      setError(null);
      setPdfPath(undefined);
      setRefreshing(true);

      try {
        if (useLibreOffice) {
          const response = await ipcBridge.document.convert.invoke({ filePath, to: 'libreoffice-pdf' });
          if (response.result.success && response.result.data) {
            setPdfPath(response.result.data as string);
            // 保存到缓存 / Save to cache
            pdfCache.set(filePath, { pdfPath: response.result.data as string, timestamp: Date.now() });
          }
        }
      } catch (err) {
        try {
          messageApiRef.current.error(t('preview.ppt.loadFailed'));
        } catch (e) {
          // Ignore if messageApi is not initialized
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [filePath, useLibreOffice, t]);

  useEffect(() => {
    const loadDocument = async () => {
      if (!filePath) {
        setError(t('preview.errors.missingFilePath'));
        setLoading(false);
        return;
      }

      // 检查缓存 / Check cache
      const cached = pdfCache.get(filePath);
      if (cached && Date.now() - cached.timestamp < CACHE_TIMEOUT) {
        console.log('[PPTViewer] Cache hit:', filePath);
        setUseLibreOffice(true); // 设置 LibreOffice 状态，因为缓存的是 PDF
        setPdfPath(cached.pdfPath);
        setLoading(false);
        return;
      }
      if (cached) {
        pdfCache.delete(filePath);
      }

      setLoading(true);
      setError(null);

      try {
        const available = await ipcBridge.document.libreOffice.isAvailable.invoke();
        setUseLibreOffice(available);

        if (available) {
          const response = await ipcBridge.document.convert.invoke({ filePath, to: 'libreoffice-pdf' });

          if (response.to !== 'libreoffice-pdf') {
            throw new Error(t('preview.errors.conversionFailed'));
          }

          if (response.result.success && response.result.data) {
            setPdfPath(response.result.data);
            // 保存到缓存 / Save to cache
            pdfCache.set(filePath, { pdfPath: response.result.data, timestamp: Date.now() });
            console.log('[PPTViewer] Converted and cached:', filePath);
          } else {
            throw new Error(response.result.error || t('preview.ppt.loadFailed'));
          }
        } else {
          setPdfPath(undefined);
        }
      } catch (err) {
        const defaultMessage = t('preview.ppt.loadFailed');
        const errorMessage = err instanceof Error ? err.message : defaultMessage;
        setError(`${errorMessage}\n${t('preview.pathLabel')}: ${filePath}`);
        try {
          messageApiRef.current.error(errorMessage);
        } catch (e) {
          // Ignore if messageApi is not initialized
        }
      } finally {
        setLoading(false);
      }
    };

    void loadDocument();
  }, [filePath, t]);

  useEffect(() => {
    if (!usePortalToolbar || !toolbarExtrasContext || loading || error) return;

    toolbarExtrasContext.setExtras({
      left: (
        <div className='flex items-center gap-8px'>
          <span className='text-13px text-t-secondary'>📊 {t('preview.pptTitle')}</span>
          <span className='text-11px text-t-tertiary'>{t('preview.readOnlyLabel')}</span>
        </div>
      ),
      right: (
        <div className='flex items-center gap-8px'>
          <div className='flex items-center gap-4px px-8px py-4px rd-4px cursor-pointer hover:bg-bg-3 transition-colors text-12px text-t-secondary' onClick={handleOpenInSystem} title={t('preview.openWithApp', { app: 'PowerPoint' })}>
            <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
              <path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' />
              <polyline points='15 3 21 3 21 9' />
              <line x1='10' y1='14' x2='21' y2='3' />
            </svg>
            <span>{t('preview.openWithApp', { app: 'PowerPoint' })}</span>
          </div>
          <Button size='mini' type='text' onClick={handleRefresh} loading={refreshing} title={t('preview.refresh')} style={{ padding: '4px' }}>
            <IconRefresh />
          </Button>
        </div>
      ),
    });
    return () => toolbarExtrasContext.setExtras(null);
  }, [usePortalToolbar, toolbarExtrasContext, loading, error, handleOpenInSystem, handleRefresh, refreshing, t]);

  if (loading) {
    return (
      <div className='flex items-center justify-center h-full'>
        {messageContextHolder}
        <div className='text-14px text-t-secondary'>{t('preview.ppt.loading')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex items-center justify-center h-full'>
        {messageContextHolder}
        <div className='text-center'>
          <div className='text-16px text-t-error mb-8px'>❌ {error}</div>
          <div className='text-12px text-t-secondary'>{t('preview.ppt.invalid')}</div>
        </div>
      </div>
    );
  }

  if (!useLibreOffice) {
    return (
      <div className='h-full w-full bg-bg-1 flex items-center justify-center'>
        {messageContextHolder}
        <div className='text-center max-w-400px px-24px'>
          <div className='text-48px mb-16px'>📊</div>
          <div className='text-16px text-t-primary font-medium mb-8px'>{t('preview.pptTitle')}</div>
          <div className='text-13px text-t-secondary mb-24px'>{t('preview.pptOpenHint')}</div>

          {filePath && (
            <div className='flex items-center justify-center gap-12px'>
              <Button size='small' onClick={handleOpenInSystem}>
                <span>{t('preview.pptOpenFile')}</span>
              </Button>
              <Button size='small' onClick={handleShowInFolder}>
                {t('preview.pptShowLocation')}
              </Button>
            </div>
          )}

          <div className='text-11px text-t-tertiary mt-16px'>{t('preview.pptSystemAppHint')}</div>
        </div>
      </div>
    );
  }

  if (useLibreOffice && pdfPath) {
    return (
      <div className='h-full w-full flex flex-col bg-bg-1'>
        {messageContextHolder}

        {!usePortalToolbar && !hideToolbar && (
          <div className='flex items-center justify-between h-40px px-12px bg-bg-2 flex-shrink-0'>
            <div className='flex items-center gap-8px'>
              <span className='text-13px text-t-secondary'>📊 {t('preview.pptTitle')}</span>
              <span className='text-11px text-t-tertiary'>{t('preview.readOnlyLabel')}</span>
            </div>

            <div className='flex items-center gap-8px'>
              <div className='flex items-center gap-4px px-8px py-4px rd-4px cursor-pointer hover:bg-bg-3 transition-colors text-12px text-t-secondary' onClick={handleOpenInSystem} title={t('preview.openWithApp', { app: 'PowerPoint' })}>
                <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                  <path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' />
                  <polyline points='15 3 21 3 21 9' />
                  <line x1='10' y1='14' x2='21' y2='3' />
                </svg>
                <span>{t('preview.openWithApp', { app: 'PowerPoint' })}</span>
              </div>
              <Button size='mini' type='text' onClick={handleRefresh} loading={refreshing} title={t('preview.refresh')} style={{ padding: '4px' }}>
                <IconRefresh />
              </Button>
            </div>
          </div>
        )}

        <div className='flex-1 overflow-hidden'>
          <PDFViewer filePath={pdfPath} hideToolbar />
        </div>
      </div>
    );
  }

  return null;
};

export default PPTPreview;
