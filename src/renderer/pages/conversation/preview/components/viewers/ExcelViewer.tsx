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
import CodeViewer from './CodeViewer';

// 缓存 Map / Cache Map
const pdfCache = new Map<string, { pdfPath: string; timestamp: number }>();
const CACHE_TIMEOUT = 5 * 60 * 1000; // 5 分钟

interface ExcelPreviewProps {
  filePath?: string;
  content?: string; // 预留，暂不使用
  hideToolbar?: boolean;
}

/**
 * Excel 表格预览组件（LibreOffice PDF 方案 - 只读模式）
 *
 * 功能：
 * 1. 通过 LibreOffice 将 Excel 文件转换为 PDF
 * 2. 使用 PDFViewer 统一渲染
 * 3. 保留表格格式、公式结果、图表等
 * 4. 点击"在 Excel 中打开"可以用系统默认应用编辑
 */
const ExcelPreview: React.FC<ExcelPreviewProps> = ({ filePath, hideToolbar = false }) => {
  const { t } = useTranslation();
  const [pdfPath, setPdfPath] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [messageApi, messageContextHolder] = Message.useMessage();
  const messageApiRef = useRef(messageApi);
  useEffect(() => {
    messageApiRef.current = messageApi;
  }, [messageApi]);
  const toolbarExtrasContext = usePreviewToolbarExtras();
  const usePortalToolbar = Boolean(toolbarExtrasContext) && !hideToolbar;

  // LibreOffice availability state
  const [libreOfficeAvailable, setLibreOfficeAvailable] = useState<boolean | null>(null);

  const handleOpenInSystem = useCallback(async () => {
    if (!filePath) {
      messageApi.error(t('preview.errors.openWithoutPath'));
      return;
    }

    try {
      await ipcBridge.shell.openFile.invoke(filePath);
      messageApi.success(t('preview.openInSystemSuccess'));
    } catch (err) {
      messageApi.error(t('preview.openInSystemFailed'));
    }
  }, [filePath, messageApi, t]);

  /**
   * Check LibreOffice availability on mount
   */
  useEffect(() => {
    const checkLibreOffice = async () => {
      try {
        const available = await ipcBridge.document.libreOffice.isAvailable.invoke();
        setLibreOfficeAvailable(available);
      } catch (err) {
        console.error('[ExcelPreview] Failed to check LibreOffice availability:', err);
        setLibreOfficeAvailable(false);
      }
    };
    void checkLibreOffice();
  }, []);

  /**
   * 加载 Excel 文件并转换为 PDF
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
          console.log('[ExcelPreview] Cache hit:', filePath);
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

      if (!filePath) {
        setError(t('preview.errors.missingFilePath'));
        setLoading(false);
        return;
      }

      try {
        // 通过 IPC 调用 LibreOffice PDF 转换
        const response = await ipcBridge.document.convert.invoke({ filePath, to: 'libreoffice-pdf' });

        if (response.to !== 'libreoffice-pdf') {
          throw new Error(t('preview.errors.conversionFailed'));
        }

        if (response.result.success && response.result.data) {
          setPdfPath(response.result.data);
          // 保存到缓存 / Save to cache
          pdfCache.set(filePath, { pdfPath: response.result.data, timestamp: Date.now() });
          console.log('[ExcelPreview] Converted and cached:', filePath);
        } else {
          throw new Error(response.result.error || t('preview.excel.convertFailed'));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('preview.excel.loadFailed'));
        messageApiRef.current?.error?.(err instanceof Error ? err.message : t('preview.excel.loadFailed'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    };

    void convertToPdf(false);
  }, [filePath, libreOfficeAvailable]);

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
          messageApiRef.current?.error?.(t('preview.excel.loadFailed'));
        } finally {
          setLoading(false);
          setRefreshing(false);
        }
      };
      await convertToPdf();
    }
  }, [filePath, libreOfficeAvailable]);

  // 设置工具栏扩展
  useEffect(() => {
    if (!usePortalToolbar || !toolbarExtrasContext || loading || error) return;

    toolbarExtrasContext.setExtras({
      left: (
        <div className='flex items-center gap-8px'>
          <span className='text-13px text-t-secondary'>📊 {t('preview.excel.title')}</span>
          <span className='text-11px text-t-tertiary'>{t('preview.readOnlyLabel')}</span>
        </div>
      ),
      right: (
        <div className='flex items-center gap-8px'>
          {filePath && (
            <div className='flex items-center gap-4px px-8px py-4px rd-4px cursor-pointer hover:bg-bg-3 transition-colors text-12px text-t-secondary' onClick={handleOpenInSystem} title={t('preview.openWithApp', { app: 'Excel' })}>
              <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                <path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' />
                <polyline points='15 3 21 3 21 9' />
                <line x1='10' y1='14' x2='21' y2='3' />
              </svg>
              <span>{t('preview.openWithApp', { app: 'Excel' })}</span>
            </div>
          )}
          <Button size='mini' type='text' onClick={handleRefresh} loading={refreshing} title={t('preview.refresh')} style={{ padding: '4px' }}>
            <IconRefresh />
          </Button>
        </div>
      ),
    });
    return () => toolbarExtrasContext.setExtras(null);
  }, [usePortalToolbar, toolbarExtrasContext, t, loading, error, filePath, handleOpenInSystem, handleRefresh, refreshing]);

  // LibreOffice not installed - fallback to raw content preview
  if (libreOfficeAvailable === false) {
    return (
      <div className='h-full w-full flex flex-col bg-bg-1'>
        {messageContextHolder}
        {!usePortalToolbar && !hideToolbar && (
          <div className='flex items-center justify-between h-40px px-12px bg-bg-2 border-b border-border-base flex-shrink-0'>
            <div className='flex items-center gap-8px'>
              <span className='text-13px text-t-secondary'>📊 {t('preview.excel.title')}</span>
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
        <div className='text-14px text-t-secondary'>{t('preview.excel.loading')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex items-center justify-center h-full'>
        <div className='text-center'>
          <div className='text-16px text-t-error mb-8px'>❌ {error}</div>
          <div className='text-12px text-t-secondary'>{t('preview.excel.invalid')}</div>
        </div>
      </div>
    );
  }

  if (!pdfPath) {
    return (
      <div className='flex items-center justify-center h-full'>
        <div className='text-14px text-t-secondary'>{t('preview.excel.loadFailed')}</div>
      </div>
    );
  }

  return (
    <div className='h-full w-full flex flex-col'>
      {messageContextHolder}

      {/* 工具栏 */}
      {!usePortalToolbar && !hideToolbar && (
        <div className='flex items-center justify-between h-40px px-12px bg-bg-2 border-b border-border-base flex-shrink-0'>
          <div className='flex items-center gap-8px'>
            <span className='text-13px text-t-secondary'>📊 {t('preview.excel.title')}</span>
            <span className='text-11px text-t-tertiary'>{t('preview.readOnlyLabel')}</span>
          </div>

          <div className='flex items-center gap-8px'>
            {filePath && (
              <Button size='mini' type='text' onClick={handleOpenInSystem} title={t('preview.openWithApp', { app: 'Excel' })}>
                <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                  <path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' />
                  <polyline points='15 3 21 3 21 9' />
                  <line x1='10' y1='14' x2='21' y2='3' />
                </svg>
                <span>{t('preview.openWithApp', { app: 'Excel' })}</span>
              </Button>
            )}
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

export default ExcelPreview;
