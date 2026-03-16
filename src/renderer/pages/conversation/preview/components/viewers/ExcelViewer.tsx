/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { usePreviewToolbarExtras } from '../../context/PreviewToolbarExtrasContext';
import { Button, Message } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PDFViewer from './PDFViewer';

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
  const [messageApi, messageContextHolder] = Message.useMessage();
  const toolbarExtrasContext = usePreviewToolbarExtras();
  const usePortalToolbar = Boolean(toolbarExtrasContext) && !hideToolbar;

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
   * 加载 Excel 文件并转换为 PDF
   */
  useEffect(() => {
    const convertToPdf = async () => {
      if (!filePath) {
        setError(t('preview.errors.missingFilePath'));
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // 通过 IPC 调用 LibreOffice PDF 转换
        const response = await ipcBridge.document.convert.invoke({ filePath, to: 'libreoffice-pdf' });

        if (response.to !== 'libreoffice-pdf') {
          throw new Error(t('preview.errors.conversionFailed'));
        }

        if (response.result.success && response.result.data) {
          setPdfPath(response.result.data);
        } else {
          throw new Error(response.result.error || t('preview.excel.convertFailed'));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('preview.excel.loadFailed'));
      } finally {
        setLoading(false);
      }
    };

    void convertToPdf();
  }, [filePath]); // 移除 t 依赖，避免不必要的重渲染

  // 设置工具栏扩展
  useEffect(() => {
    if (!usePortalToolbar || !toolbarExtrasContext || loading || error) return;
    toolbarExtrasContext.setExtras({
      left: (
        <div className='flex items-center gap-8px'>
          <span className='text-11px text-t-tertiary'>{t('preview.readOnlyLabel')}</span>
        </div>
      ),
      right: null,
    });
    return () => toolbarExtrasContext.setExtras(null);
  }, [usePortalToolbar, toolbarExtrasContext, t, loading, error]);

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
          </div>
        </div>
      )}

      {/* 内容区域 - PDF 渲染 */}
      <div className='flex-1 overflow-hidden'>{pdfPath && <PDFViewer filePath={pdfPath} hideToolbar />}</div>
    </div>
  );
};

export default ExcelPreview;
