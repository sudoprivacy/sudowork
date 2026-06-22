/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Message } from '@arco-design/web-react';
import { IconRefresh } from '@arco-design/web-react/icon';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { libreOffice as libreOfficeIpc } from '@/common/ipcBridge';
import { ipcBridge } from '@/common';
import { usePreviewToolbarExtras } from '../../context/PreviewToolbarExtrasContext';
import LibreOfficeInstallPrompt from '../LibreOfficeInstallPrompt';
import PDFViewer from './PDFViewer';

interface PPTPreviewProps {
  filePath?: string;
  content?: string;
  hideToolbar?: boolean;
}

// 缓存 Map / Cache Map
// 添加 mtime 字段以检测文件修改 / Added mtime field to detect file modifications
const pdfCache = new Map<string, { pdfPath: string; timestamp: number; mtime: number }>();
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
  const [needsLibreOfficeInstall, setNeedsLibreOfficeInstall] = useState(false);
  const [installingLibreOffice, setInstallingLibreOffice] = useState(false);
  const [installPercent, setInstallPercent] = useState<number | undefined>(undefined);
  const [installPhase, setInstallPhase] = useState<string | undefined>(undefined);
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const messageApiRef = useRef(messageApi);
  const filePathRef = useRef(filePath);

  useEffect(() => {
    filePathRef.current = filePath;
  }, [filePath]);

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

  const handleInstallLibreOffice = useCallback(async () => {
    setInstallingLibreOffice(true);
    setInstallPercent(undefined);
    setInstallPhase(undefined);
    try {
      const res = await libreOfficeIpc.install.invoke();
      if (!res?.success) {
        messageApiRef.current?.error?.(res?.msg || t('settings.runtimeSettings.installFailed', { name: 'LibreOffice' }));
      }
    } catch (e) {
      messageApiRef.current?.error?.(e instanceof Error ? e.message : t('settings.runtimeSettings.installFailed', { name: 'LibreOffice' }));
    }
    // Don't reset installingLibreOffice here — the installResult event will handle it
  }, [t]);

  // Listen for LibreOffice install progress and result
  useEffect(() => {
    const unsubProgress = libreOfficeIpc.installProgress.on(({ phase, percent }) => {
      setInstallingLibreOffice(true);
      setInstallPhase(phase);
      if (percent != null) setInstallPercent((prev) => (prev != null ? Math.max(prev, percent) : percent));
    });
    const unsubResult = libreOfficeIpc.installResult.on(() => {
      setInstallingLibreOffice(false);
      setInstallPercent(undefined);
      setInstallPhase(undefined);
      if (needsLibreOfficeInstall) {
        setNeedsLibreOfficeInstall(false);
        setReloadTrigger((n) => n + 1);
      }
    });
    return () => {
      unsubProgress();
      unsubResult();
    };
  }, [needsLibreOfficeInstall]);

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
            // 获取文件 mtime 并保存到缓存 / Get file mtime and save to cache
            const mtime = await ipcBridge.document.getFileMtime.invoke({ filePath });
            pdfCache.set(filePath, { pdfPath: response.result.data as string, timestamp: Date.now(), mtime });
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

      // 检查缓存（同时检查文件修改时间）/ Check cache (also check file modification time)
      const cached = pdfCache.get(filePath);
      if (cached) {
        // 获取当前文件的 mtime / Get current file mtime
        const currentMtime = await ipcBridge.document.getFileMtime.invoke({ filePath });
        // 缓存有效条件：mtime 未变化且未超时 / Cache valid if: mtime unchanged and not expired
        if (cached.mtime === currentMtime && Date.now() - cached.timestamp < CACHE_TIMEOUT) {
          console.log('[PPTViewer] Cache hit:', filePath, 'mtime:', currentMtime);
          setUseLibreOffice(true); // 设置 LibreOffice 状态，因为缓存的是 PDF
          setPdfPath(cached.pdfPath);
          setLoading(false);
          return;
        }
        // mtime 变化或超时，清除缓存 / mtime changed or expired, clear cache
        console.log('[PPTViewer] Cache invalidated:', filePath, 'cached mtime:', cached.mtime, 'current mtime:', currentMtime);
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
            // 获取文件 mtime 并保存到缓存 / Get file mtime and save to cache
            const mtime = await ipcBridge.document.getFileMtime.invoke({ filePath });
            pdfCache.set(filePath, { pdfPath: response.result.data, timestamp: Date.now(), mtime });
            console.log('[PPTViewer] Converted and cached:', filePath, 'mtime:', mtime);
          } else {
            throw new Error(response.result.error || t('preview.ppt.loadFailed'));
          }
        } else {
          setPdfPath(undefined);
          setNeedsLibreOfficeInstall(true);
          setLoading(false);
          return;
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
  }, [filePath, t, reloadTrigger]);

  useEffect(() => {
    if (!usePortalToolbar || !toolbarExtrasContext || loading || error) return;

    toolbarExtrasContext.setExtras({
      left: (
        <div className='flex items-center gap-8px'>
          <span className='text-13px text-secondary'>📊 {t('preview.pptTitle')}</span>
          <span className='text-11px text-tertiary'>{t('preview.readOnlyLabel')}</span>
        </div>
      ),
      right: (
        <div className='flex items-center gap-8px'>
          <div className='flex items-center gap-4px px-8px py-4px rd-4px cursor-pointer transition-colors text-12px text-secondary' onClick={handleOpenInSystem} title={t('preview.openWithApp', { app: 'PowerPoint' })}>
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
        <div className='text-14px text-secondary'>{t('preview.ppt.loading')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex items-center justify-center h-full'>
        {messageContextHolder}
        <div className='text-center'>
          <div className='text-16px text-danger mb-8px'>❌ {error}</div>
          <div className='text-12px text-secondary'>{t('preview.ppt.invalid')}</div>
        </div>
      </div>
    );
  }

  if (!useLibreOffice) {
    return (
      <div className='h-full w-full'>
        <LibreOfficeInstallPrompt fileType='ppt' installing={installingLibreOffice} percent={installPercent} phase={installPhase} onInstall={handleInstallLibreOffice} />
      </div>
    );
  }

  if (useLibreOffice && pdfPath) {
    return (
      <div className='h-full w-full flex flex-col'>
        {messageContextHolder}

        {!usePortalToolbar && !hideToolbar && (
          <div className='flex items-center justify-between h-40px px-12px flex-shrink-0'>
            <div className='flex items-center gap-8px'>
              <span className='text-13px text-secondary'>📊 {t('preview.pptTitle')}</span>
              <span className='text-11px text-tertiary'>{t('preview.readOnlyLabel')}</span>
            </div>

            <div className='flex items-center gap-8px'>
              <div className='flex items-center gap-4px px-8px py-4px rd-4px cursor-pointer transition-colors text-12px text-secondary' onClick={handleOpenInSystem} title={t('preview.openWithApp', { app: 'PowerPoint' })}>
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
