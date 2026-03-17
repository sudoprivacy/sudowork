/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { usePreviewToolbarExtras } from '../../context/PreviewToolbarExtrasContext';
import { Button, Message } from '@arco-design/web-react';
import { IconRefresh } from '@arco-design/web-react/icon';
import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import PDFViewer from './PDFViewer';
import MarkdownPreview from './MarkdownViewer';

interface WordPreviewProps {
  filePath?: string;
  content?: string; // Base64 或 ArrayBuffer
  hideToolbar?: boolean;
}

// 缓存 Map / Cache Map
const pdfCache = new Map<string, { pdfPath: string; timestamp: number }>();
const CACHE_TIMEOUT = 5 * 60 * 1000; // 5 分钟

/**
 * Word 文档预览组件
 *
 * 优先使用 LibreOffice 转 PDF 预览（最佳保真度），
 * 如果 LibreOffice 不可用则回退到 Markdown 转换
 */
const WordPreview: React.FC<WordPreviewProps> = ({ filePath, content, hideToolbar = false }) => {
  const { t } = useTranslation();
  const [pdfPath, setPdfPath] = useState<string | undefined>(undefined);
  const [markdown, setMarkdown] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [messageApi, messageContextHolder] = Message.useMessage();
  const toolbarExtrasContext = usePreviewToolbarExtras();
  const usePortalToolbar = Boolean(toolbarExtrasContext) && !hideToolbar;

  const [useLibreOffice, setUseLibreOffice] = useState<boolean>(false);

  // Use refs to avoid recreating callbacks on every render
  const filePathRef = useRef(filePath);
  const useLibreOfficeRef = useRef(useLibreOffice);
  const messageApiRef = useRef(messageApi);

  useEffect(() => {
    filePathRef.current = filePath;
  }, [filePath]);

  useEffect(() => {
    useLibreOfficeRef.current = useLibreOffice;
  }, [useLibreOffice]);

  useEffect(() => {
    messageApiRef.current = messageApi;
  }, [messageApi]);

  const handleOpenInSystem = useCallback(async () => {
    const currentFilePath = filePathRef.current;
    if (!currentFilePath) {
      messageApiRef.current.error(t('preview.errors.openWithoutPath'));
      return;
    }

    try {
      await ipcBridge.shell.openFile.invoke(currentFilePath);
      messageApiRef.current.info(t('preview.openInSystemSuccess'));
    } catch (err) {
      messageApiRef.current.error(t('preview.openInSystemFailed'));
    }
  }, [t]);

  const handleRefresh = useCallback(async () => {
    const currentFilePath = filePathRef.current;
    const currentUseLibreOffice = useLibreOfficeRef.current;

    if (!currentFilePath) return;

    pdfCache.delete(currentFilePath); // 清除缓存
    setLoading(true);
    setError(null);
    setPdfPath(undefined);
    setMarkdown('');
    setRefreshing(true);

    try {
      if (currentUseLibreOffice) {
        const response = await ipcBridge.document.convert.invoke({ filePath: currentFilePath, to: 'libreoffice-pdf' });
        if (response.result.success && response.result.data) {
          setPdfPath(response.result.data as string);
          // 保存到缓存 / Save to cache
          pdfCache.set(currentFilePath, { pdfPath: response.result.data, timestamp: Date.now() });
        }
      } else {
        const response = await ipcBridge.document.convert.invoke({ filePath: currentFilePath, to: 'markdown' });
        if (response.result.success && response.result.data) {
          setMarkdown(response.result.data as string);
        }
      }
    } catch (err) {
      try {
        messageApiRef.current.error(t('preview.word.loadFailed'));
      } catch (e) {
        // Ignore
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  /**
   * Check LibreOffice availability and load document
   */
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
        console.log('[WordViewer] Cache hit:', filePath);
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
        // Check for legacy .doc format
        const fileExtension = filePath.toLowerCase().split('.').pop();
        const isLegacyDoc = fileExtension === 'doc';

        // 先检查 LibreOffice 是否可用 / Check LibreOffice availability first
        const available = await ipcBridge.document.libreOffice.isAvailable.invoke();
        setUseLibreOffice(available);

        console.log('[WordViewer] LibreOffice available:', available, 'filePath:', filePath, 'isLegacyDoc:', isLegacyDoc);

        // If file is legacy .doc format and LibreOffice is not available, show helpful error
        if (isLegacyDoc && !available) {
          throw new Error(t('preview.word.legacyDocFormat'));
        }

        if (available) {
          // LibreOffice 可用：转换为 PDF / Convert to PDF via LibreOffice
          const response = await ipcBridge.document.convert.invoke({ filePath, to: 'libreoffice-pdf' });

          console.log('[WordViewer] LibreOffice conversion response:', response);

          if (response.to !== 'libreoffice-pdf') {
            throw new Error(t('preview.errors.conversionFailed'));
          }

          if (response.result.success && response.result.data) {
            setPdfPath(response.result.data);
            // 保存到缓存 / Save to cache
            pdfCache.set(filePath, { pdfPath: response.result.data, timestamp: Date.now() });
            console.log('[WordViewer] Converted and cached:', filePath);
          } else {
            throw new Error(response.result.error || t('preview.word.loadFailed'));
          }
        } else {
          // LibreOffice 不可用：回退到 Markdown 转换 / Fallback to Markdown conversion
          const response = await ipcBridge.document.convert.invoke({ filePath, to: 'markdown' });

          console.log('[WordViewer] Markdown conversion response:', response);

          if (response.to !== 'markdown') {
            throw new Error(t('preview.errors.conversionFailed'));
          }

          if (response.result.success && response.result.data) {
            const markdownContent = response.result.data as string;
            console.log('[WordViewer] Markdown content length:', markdownContent?.length);

            // Check if content is actually empty or whitespace only
            if (!markdownContent || markdownContent.trim().length === 0) {
              throw new Error(t('preview.word.emptyContent'));
            }

            setMarkdown(markdownContent);
          } else {
            throw new Error(response.result.error || t('preview.word.loadFailed'));
          }
        }
      } catch (err) {
        const defaultMessage = t('preview.word.loadFailed');
        const errorMessage = err instanceof Error ? err.message : defaultMessage;
        setError(`${errorMessage}\n${t('preview.pathLabel')}: ${filePath}`);
        try {
          messageApiRef.current?.error?.(errorMessage);
        } catch (e) {
          // Ignore
        }
      } finally {
        setLoading(false);
      }
    };

    void loadDocument();
  }, [filePath, t]);

  // 设置工具栏扩展
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
  }, [usePortalToolbar, toolbarExtrasContext, loading, error, t, handleOpenInSystem, handleRefresh, refreshing]);

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

  // LibreOffice 可用且已生成 PDF：显示 PDF 预览
  if (useLibreOffice && pdfPath) {
    return (
      <div className='h-full w-full flex flex-col bg-bg-1'>
        {messageContextHolder}

        {!usePortalToolbar && !hideToolbar && (
          <div className='flex items-center justify-between h-40px px-12px bg-bg-2 flex-shrink-0'>
            <div className='flex items-center gap-8px'>
              <span className='text-13px text-t-secondary'>📄 {t('preview.word.title')}</span>
              <span className='text-11px text-t-tertiary'>{t('preview.readOnlyLabel')}</span>
            </div>

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

        <div className='flex-1 overflow-hidden'>
          <PDFViewer filePath={pdfPath} hideToolbar />
        </div>
      </div>
    );
  }

  // LibreOffice 不可用：显示 Markdown 预览
  if (!useLibreOffice) {
    // 如果 Markdown 内容为空，显示提示信息
    // If markdown content is empty, show a helpful message
    if (!markdown || markdown.trim().length === 0) {
      return (
        <div className='h-full w-full flex flex-col bg-bg-1'>
          {messageContextHolder}
          {!usePortalToolbar && !hideToolbar && (
            <div className='flex items-center justify-between h-40px px-12px bg-bg-2 flex-shrink-0'>
              <div className='flex items-center gap-8px'>
                <span className='text-13px text-t-secondary'>📄 {t('preview.word.title')}</span>
                <span className='text-11px text-t-tertiary'>{t('preview.readOnlyLabel')}</span>
              </div>
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
          <div className='flex-1 flex items-center justify-center'>
            <div className='text-center'>
              <div className='text-14px text-t-secondary mb-8px'>{t('preview.word.emptyContent')}</div>
              <div className='text-12px text-t-tertiary'>{filePath}</div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className='h-full w-full flex flex-col bg-bg-1'>
        {messageContextHolder}

        {!usePortalToolbar && !hideToolbar && (
          <div className='flex items-center justify-between h-40px px-12px bg-bg-2 flex-shrink-0'>
            <div className='flex items-center gap-8px'>
              <span className='text-13px text-t-secondary'>📄 {t('preview.word.title')}</span>
              <span className='text-11px text-t-tertiary'>{t('preview.readOnlyLabel')}</span>
            </div>

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

        <div className='flex-1 overflow-hidden'>
          <MarkdownPreview content={markdown} hideToolbar />
        </div>
      </div>
    );
  }

  // 理论上不应该走到这里，但为了类型安全保留
  // Should not reach here, but keep for type safety
  return (
    <div className='flex items-center justify-center h-full'>
      <div className='text-14px text-t-secondary'>{t('preview.word.loading')}</div>
    </div>
  );
};

export default WordPreview;
