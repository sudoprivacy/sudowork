/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { usePreviewToolbarExtras } from '../../context/PreviewToolbarExtrasContext';
import { Button, Message } from '@arco-design/web-react';
import { IconRefresh } from '@arco-design/web-react/icon';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PDFViewer from './PDFViewer';
import CodeViewer from './CodeViewer';

interface PPTPreviewProps {
  /**
   * PPT 文件路径（磁盘上的绝对路径）
   * PPT file path (absolute path on disk)
   */
  filePath?: string;
  content?: string; // ArrayBuffer as base64 (for fallback when LibreOffice not installed)
  hideToolbar?: boolean;
}

// 缓存 Map / Cache Map
const pdfCache = new Map<string, { pdfPath: string; timestamp: number }>();
const CACHE_TIMEOUT = 5 * 60 * 1000; // 5 分钟

/**
 * PPT 演示文稿预览组件（LibreOffice PDF 方案）
 *
 * 功能：
 * 1. 使用 LibreOffice 将 PPT/PPTX 转换为 PDF
 * 2. 使用 PDFViewer 统一渲染
 * 3. 支持在系统应用中打开
 * 4. 缓存转换结果，避免重复转换
 * 5. 支持手动刷新
 */
const PPTPreview: React.FC<PPTPreviewProps> = ({ filePath, hideToolbar = false }) => {
  const { t } = useTranslation();
  const [messageApi, messageContextHolder] = Message.useMessage();
  const messageApiRef = useRef(messageApi);
  useEffect(() => {
    messageApiRef.current = messageApi;
  }, [messageApi]);
  const toolbarExtrasContext = usePreviewToolbarExtras();
  const usePortalToolbar = Boolean(toolbarExtrasContext) && !hideToolbar;

  const [pdfPath, setPdfPath] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false); // 刷新状态

  // LibreOffice availability state
  const [libreOfficeAvailable, setLibreOfficeAvailable] = useState<boolean | null>(null);

  const handleOpenExternal = useCallback(async () => {
    if (!filePath) {
      messageApi.error(t('preview.errors.openWithoutPath'));
      return;
    }
    try {
      await ipcBridge.shell.openFile.invoke(filePath);
      messageApi.info(t('preview.openInSystemSuccess'));
    } catch (err) {
      messageApi.error(t('preview.openInSystemFailed'));
    }
  }, [filePath, messageApi, t]);

  const handleShowInFolder = useCallback(async () => {
    if (!filePath) {
      return;
    }
    try {
      await ipcBridge.shell.showItemInFolder.invoke(filePath);
    } catch (err) {
      // 静默处理错误 / Silently handle error
    }
  }, [filePath]);

  /**
   * Check LibreOffice availability on mount
   */
  useEffect(() => {
    const checkLibreOffice = async () => {
      try {
        const available = await ipcBridge.document.libreOffice.isAvailable.invoke();
        setLibreOfficeAvailable(available);
      } catch (err) {
        console.error('[PPTPreview] Failed to check LibreOffice availability:', err);
        setLibreOfficeAvailable(false);
      }
    };
    void checkLibreOffice();
  }, []);

  // 转换函数 / Convert function
  const convertToPdf = useCallback(
    async (forceRefresh = false) => {
      // Skip conversion if LibreOffice is not available
      if (libreOfficeAvailable === false) {
        setLoading(false);
        return;
      }

      if (!filePath) {
        setError(t('preview.errors.missingFilePath'));
        setLoading(false);
        return;
      }

      // 检查缓存 / Check cache
      if (!forceRefresh) {
        const cached = pdfCache.get(filePath);
        if (cached && Date.now() - cached.timestamp < CACHE_TIMEOUT) {
          console.log('[PPTPreview] Cache hit:', filePath);
          setPdfPath(cached.pdfPath);
          setLoading(false);
          return;
        }
        if (cached) {
          pdfCache.delete(filePath);
        }
      }

      setLoading(true);
      setError(null);
      setRefreshing(forceRefresh);

      try {
        const response = await ipcBridge.document.convert.invoke({ filePath, to: 'libreoffice-pdf' });

        if (response.to !== 'libreoffice-pdf') {
          throw new Error(t('preview.errors.conversionFailed'));
        }

        if (response.result.success && response.result.data) {
          const newPdfPath = response.result.data;
          setPdfPath(newPdfPath);
          // 保存到缓存 / Save to cache
          pdfCache.set(filePath, { pdfPath: newPdfPath, timestamp: Date.now() });
          console.log('[PPTPreview] Converted and cached:', filePath);
        } else {
          throw new Error(response.result.error || t('preview.errors.conversionFailed'));
        }
      } catch (err) {
        const defaultMessage = t('preview.ppt.loadFailed');
        const errorMessage = err instanceof Error ? err.message : defaultMessage;
        setError(`${errorMessage}\n${t('preview.pathLabel')}: ${filePath}`);
        messageApiRef.current?.error?.(errorMessage);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filePath, t, libreOfficeAvailable]
  );

  // 初始加载 / Initial load
  useEffect(() => {
    void convertToPdf(false);
  }, [filePath]);

  // 刷新处理 / Refresh handler
  const handleRefresh = useCallback(async () => {
    if (filePath && libreOfficeAvailable !== false) {
      pdfCache.delete(filePath); // 清除缓存
      await convertToPdf(true);
    }
  }, [filePath, convertToPdf, libreOfficeAvailable]);

  // 设置工具栏扩展
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
          <div className='flex items-center gap-4px px-8px py-4px rd-4px cursor-pointer hover:bg-bg-3 transition-colors text-12px text-t-secondary' onClick={handleOpenExternal} title={t('preview.openWithApp', { app: 'PowerPoint' })}>
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
  }, [usePortalToolbar, toolbarExtrasContext, t, loading, error, handleOpenExternal, handleRefresh, refreshing]);

  // LibreOffice not installed - fallback to CodeViewer with raw content
  if (libreOfficeAvailable === false) {
    return (
      <div className='h-full w-full flex flex-col bg-bg-1'>
        {messageContextHolder}
        {!usePortalToolbar && !hideToolbar && (
          <div className='flex items-center justify-between h-40px px-12px bg-bg-2 flex-shrink-0 border-b border-border-1'>
            <div className='flex items-center gap-8px'>
              <span className='text-13px text-t-secondary'>📊 {t('preview.pptTitle')}</span>
              <span className='text-11px text-t-tertiary'>{t('preview.readOnlyLabel')}</span>
            </div>
          </div>
        )}
        <div className='flex-1 overflow-hidden'>
          <CodeViewer content={content || ''} language='plaintext' hideToolbar />
        </div>
      </div>
    );
  }

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

  return (
    <div className='h-full w-full flex flex-col bg-bg-1'>
      {messageContextHolder}

      {/* 工具栏 */}
      {!usePortalToolbar && !hideToolbar && (
        <div className='flex items-center justify-between h-40px px-12px bg-bg-2 flex-shrink-0 border-b border-border-1'>
          <div className='flex items-center gap-8px'>
            <span className='text-13px text-t-secondary'>📊 {t('preview.pptTitle')}</span>
            <span className='text-11px text-t-tertiary'>{t('preview.readOnlyLabel')}</span>
          </div>

          <div className='flex items-center gap-8px'>
            <div className='flex items-center gap-4px px-8px py-4px rd-4px cursor-pointer hover:bg-bg-3 transition-colors text-12px text-t-secondary' onClick={handleOpenExternal} title={t('preview.openWithApp', { app: 'PowerPoint' })}>
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

      {/* PDF 渲染区域 */}
      <div className='flex-1 overflow-hidden'>{pdfPath && <PDFViewer filePath={pdfPath} hideToolbar />}</div>
    </div>
  );
};

export default PPTPreview;
