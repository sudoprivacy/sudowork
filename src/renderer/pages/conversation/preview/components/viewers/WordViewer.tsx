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

// 缓存 Map / Cache Map
const pdfCache = new Map<string, { pdfPath: string; timestamp: number }>();
const CACHE_TIMEOUT = 5 * 60 * 1000; // 5 分钟

interface WordPreviewProps {
  filePath?: string;
  content?: string; // Base64 或 ArrayBuffer
  hideToolbar?: boolean;
}

/**
 * Word 文档预览组件（LibreOffice PDF 方案）
 *
 * 功能：
 * 1. 使用 LibreOffice 将 Word 文档转换为 PDF
 * 2. 使用 PDFViewer 统一渲染
 * 3. 保留更多格式（表格、图片、样式等）
 * 4. 点击"在 Word 中打开"可以用系统默认应用编辑
 */
const WordPreview: React.FC<WordPreviewProps> = ({ filePath, hideToolbar = false }) => {
  const { t } = useTranslation();
  const [pdfPath, setPdfPath] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [messageApi, messageContextHolder] = Message.useMessage();
  const toolbarExtrasContext = usePreviewToolbarExtras();
  const usePortalToolbar = Boolean(toolbarExtrasContext) && !hideToolbar;

  // LibreOffice availability state
  const [libreOfficeAvailable, setLibreOfficeAvailable] = useState<boolean | null>(null);

  const messageApiRef = useRef(messageApi);
  useEffect(() => {
    messageApiRef.current = messageApi;
  }, [messageApi]);

  /**
   * Check LibreOffice availability on mount
   */
  useEffect(() => {
    const checkLibreOffice = async () => {
      try {
        const available = await ipcBridge.document.libreOffice.isAvailable.invoke();
        setLibreOfficeAvailable(available);
      } catch (err) {
        console.error('[WordPreview] Failed to check LibreOffice availability:', err);
        setLibreOfficeAvailable(false);
      }
    };
    void checkLibreOffice();
  }, []);

  /**
   * 使用 LibreOffice 将 Word 文档转换为 PDF
   */
  useEffect(() => {
    const convertToPdf = async (forceRefresh = false) => {
      // Skip conversion if LibreOffice is not available
      if (libreOfficeAvailable === false) {
        setLoading(false);
        return;
      }

      // 检查缓存 / Check cache
      if (!forceRefresh && filePath) {
        const cached = pdfCache.get(filePath);
        if (cached && Date.now() - cached.timestamp < CACHE_TIMEOUT) {
          console.log('[WordPreview] Cache hit:', filePath);
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
        if (!filePath) {
          throw new Error(t('preview.errors.missingFilePath'));
        }

        const response = await ipcBridge.document.convert.invoke({ filePath, to: 'libreoffice-pdf' });

        if (response.to !== 'libreoffice-pdf') {
          throw new Error(t('preview.errors.conversionFailed'));
        }

        if (response.result.success && response.result.data) {
          setPdfPath(response.result.data);
          // 保存到缓存 / Save to cache
          pdfCache.set(filePath, { pdfPath: response.result.data, timestamp: Date.now() });
          console.log('[WordPreview] Converted and cached:', filePath);
        } else {
          throw new Error(response.result.error || t('preview.errors.conversionFailed'));
        }
      } catch (err) {
        const defaultMessage = t('preview.word.loadFailed');
        const errorMessage = err instanceof Error ? err.message : defaultMessage;
        setError(`${errorMessage}\n${t('preview.pathLabel')}: ${filePath}`);
        messageApiRef.current?.error?.(errorMessage);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    };

    void convertToPdf(false);
  }, [filePath, libreOfficeAvailable]); // 添加 libreOfficeAvailable 依赖

  // 刷新处理 / Refresh handler
  const handleRefresh = useCallback(async () => {
    if (filePath && libreOfficeAvailable !== false) {
      pdfCache.delete(filePath);
      const convertToPdf = async () => {
        setLoading(true);
        setError(null);
        setRefreshing(true);

        try {
          const response = await ipcBridge.document.convert.invoke({ filePath, to: 'libreoffice-pdf' });
          if (response.result.success && response.result.data) {
            setPdfPath(response.result.data as string);
            pdfCache.set(filePath, { pdfPath: response.result.data as string, timestamp: Date.now() });
          }
        } catch (err) {
          messageApiRef.current?.error?.(t('preview.word.loadFailed'));
        } finally {
          setLoading(false);
          setRefreshing(false);
        }
      };
      await convertToPdf();
    }
  }, [filePath, libreOfficeAvailable]);

  /**
   * 在系统默认应用中打开 Word 文档
   * Open Word document in system default application
   */
  const handleOpenInSystem = useCallback(async () => {
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

  // 设置工具栏扩展（必须在所有条件返回之前调用）
  // Set toolbar extras (must be called before any conditional returns)
  useEffect(() => {
    if (!usePortalToolbar || !toolbarExtrasContext || loading || error) return;
    toolbarExtrasContext.setExtras({
      left: (
        <div className='flex items-center gap-8px'>
          <span className='text-13px text-t-secondary'>📄 {t('preview.word.title')}</span>
          <span className='text-11px text-t-tertiary'>{t('preview.readOnlyLabel')}</span>
        </div>
      ),
      right: (
        <div className='flex items-center gap-8px'>
          <div className='flex items-center gap-4px px-8px py-4px rd-4px cursor-pointer hover:bg-bg-3 transition-colors text-12px text-t-secondary' onClick={handleOpenInSystem} title={t('preview.openWithApp', { app: 'Word' })}>
            <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
              <path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' />
              <polyline points='15 3 21 3 21 9' />
              <line x1='10' y1='14' x2='21' y2='3' />
            </svg>
            <span>{t('preview.openWithApp', { app: 'Word' })}</span>
          </div>
          <Button size='mini' type='text' onClick={handleRefresh} loading={refreshing} title={t('preview.refresh')} style={{ padding: '4px' }}>
            <IconRefresh />
          </Button>
        </div>
      ),
    });
    return () => toolbarExtrasContext.setExtras(null);
  }, [usePortalToolbar, toolbarExtrasContext, t, loading, error, handleOpenInSystem, handleRefresh, refreshing]);

  // LibreOffice not installed - fallback to raw content preview
  if (libreOfficeAvailable === false) {
    return (
      <div className='h-full w-full flex flex-col bg-bg-1'>
        {messageContextHolder}
        {!usePortalToolbar && !hideToolbar && (
          <div className='flex items-center justify-between h-40px px-12px bg-bg-2 flex-shrink-0'>
            <div className='flex items-center gap-8px'>
              <span className='text-13px text-t-secondary'>📄 {t('preview.word.title')}</span>
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
        <div className='text-14px text-t-secondary'>{t('preview.word.loading')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex items-center justify-center h-full'>
        <div className='text-center'>
          <div className='text-16px text-t-error mb-8px'>❌ {error}</div>
          <div className='text-12px text-t-secondary'>{t('preview.word.invalid')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className='h-full w-full flex flex-col bg-bg-1'>
      {messageContextHolder}

      {/* 工具栏 / Toolbar */}
      {!usePortalToolbar && !hideToolbar && (
        <div className='flex items-center justify-between h-40px px-12px bg-bg-2 flex-shrink-0'>
          <div className='flex items-center gap-8px'>
            <span className='text-13px text-t-secondary'>📄 {t('preview.word.title')}</span>
            <span className='text-11px text-t-tertiary'>{t('preview.readOnlyLabel')}</span>
          </div>

          {/* 右侧按钮组 / Right button group */}
          <div className='flex items-center gap-8px'>
            <div className='flex items-center gap-4px px-8px py-4px rd-4px cursor-pointer hover:bg-bg-3 transition-colors text-12px text-t-secondary' onClick={handleOpenInSystem} title={t('preview.openWithApp', { app: 'Word' })}>
              <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                <path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' />
                <polyline points='15 3 21 3 21 9' />
                <line x1='10' y1='14' x2='21' y2='3' />
              </svg>
              <span>{t('preview.openWithApp', { app: 'Word' })}</span>
            </div>
            <Button size='mini' type='text' onClick={handleRefresh} loading={refreshing} title={t('preview.refresh')} style={{ padding: '4px' }}>
              <IconRefresh />
            </Button>
          </div>
        </div>
      )}

      {/* 内容区域 - PDF 渲染 */}
      <div className='flex-1 overflow-hidden'>{pdfPath && <PDFViewer filePath={pdfPath} hideToolbar />}</div>
    </div>
  );
};

export default WordPreview;
