/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { Message } from '@arco-design/web-react';
import { Group, Panel } from 'react-resizable-panels';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import ResizableSeparator from '@/renderer/components/ResizableSeparator';
import { useStoredPanelLayout } from '@/renderer/hooks/useStoredPanelLayout';
import { PreviewToolbarExtrasProvider, type PreviewToolbarExtras } from '../../context/PreviewToolbarExtrasContext';
import { usePreviewContext } from '../../context/PreviewContext';
import AudioPreview from '../viewers/AudioViewer';
import CodePreview from '../viewers/CodeViewer';
import DiffPreview from '../viewers/DiffViewer';
import ExcelPreview from '../viewers/ExcelViewer';
import HTMLEditor from '../editors/HTMLEditor';
import HTMLRenderer from '../renderers/HTMLRenderer';
import ImagePreview from '../viewers/ImageViewer';
import MarkdownEditor from '../editors/MarkdownEditor';
import MarkdownPreview from '../viewers/MarkdownViewer';
import PDFPreview from '../viewers/PDFViewer';
import PPTPreview from '../viewers/PPTViewer';
import TextEditor from '../editors/TextEditor';
import VideoPreview from '../viewers/VideoViewer';
import WordPreview from '../viewers/WordViewer';
import URLViewer from '../viewers/URLViewer';
import { DEFAULT_SPLIT_RATIO, MAX_SPLIT_WIDTH, MIN_SPLIT_WIDTH } from '../../constants';
import { usePreviewHistory, usePreviewKeyboardShortcuts, useScrollSync, useTabOverflow, useThemeDetection } from '../../hooks';
import { PreviewTabs, PreviewToolbar, PreviewContextMenu, PreviewConfirmModals, PreviewHistoryDropdown, type ContextMenuState, type CloseTabConfirmState, type PreviewTab } from '.';

/**
 * 预览面板主组件
 * Main preview panel component
 *
 * 支持多 Tab 切换，每个 Tab 可以显示不同类型的内容
 * Supports multiple tabs, each tab can display different types of content
 */
const PreviewPanel: React.FC = () => {
  const { t } = useTranslation();
  const { isOpen, tabs, activeTabId, activeTab, closeTab, switchTab, closePreview, updateContent, saveContent, addDomSnippet } = usePreviewContext();

  // 视图状态 / View states
  const [viewMode, setViewMode] = useState<'source' | 'preview'>('preview');
  const [isSplitScreenEnabled, setIsSplitScreenEnabled] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [inspectMode, setInspectMode] = useState(false);
  const [toolbarExtras, setToolbarExtras] = useState<PreviewToolbarExtras | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // 确认对话框状态 / Confirmation dialog states
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [closeTabConfirm, setCloseTabConfirm] = useState<CloseTabConfirmState>({ show: false, tabId: null });

  // 右键菜单状态 / Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ show: false, x: 0, y: 0, tabId: null });

  // 容器引用 / Container refs
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  // 使用自定义 Hooks / Use custom hooks
  const currentTheme = useThemeDetection();
  const { tabsContainerRef, tabFadeState } = useTabOverflow([tabs, activeTabId]);
  const { handleEditorScroll, handlePreviewScroll } = useScrollSync({
    enabled: isSplitScreenEnabled,
    editorContainerRef,
    previewContainerRef,
  });

  const { historyVersions, historyLoading, snapshotSaving, historyError, historyTarget, refreshHistory, handleSaveSnapshot, handleSnapshotSelect } = usePreviewHistory({
    activeTab,
    updateContent,
  });

  const activeTabIsRemoteWorkspaceFile = activeTab?.metadata?.remote === true;

  useEffect(() => {
    if (!activeTabIsRemoteWorkspaceFile) return;
    setViewMode('preview');
    setIsSplitScreenEnabled(false);
    setIsEditMode(false);
  }, [activeTab?.id, activeTabIsRemoteWorkspaceFile]);

  usePreviewKeyboardShortcuts({
    isDirty: activeTab?.isDirty,
    onSave: () => void saveContent(),
    isOpen,
    onClose: closePreview,
  });

  const setToolbarExtrasCallback = useCallback((extras: PreviewToolbarExtras | null) => {
    setToolbarExtras(extras);
  }, []);

  // 处理 HTML 审核模式元素选中 / Handle HTML inspect mode element selection
  const handleElementSelected = useCallback(
    (element: { html: string; tag: string }) => {
      addDomSnippet(element.tag, element.html);
    },
    [addDomSnippet]
  );

  const toolbarExtrasContextValue = useMemo(
    () => ({
      setExtras: setToolbarExtrasCallback,
    }),
    [setToolbarExtrasCallback]
  );

  const { defaultLayout: splitDefaultLayout, onLayoutChanged: onSplitLayoutChanged } = useStoredPanelLayout({
    storageKey: 'preview-panel-split-ratio',
    primaryPanelId: 'editor',
    secondaryPanelId: 'preview',
    defaultRatio: DEFAULT_SPLIT_RATIO,
    minRatio: MIN_SPLIT_WIDTH,
    maxRatio: MAX_SPLIT_WIDTH,
  });

  // 使用 useCallback 包装 updateContent，确保引用稳定 / Wrap updateContent with useCallback for stable reference
  const handleContentChange = useCallback(
    (newContent: string) => {
      // 严格的类型检查，防止 Event 对象被错误传递 / Strict type checking to prevent Event object from being passed incorrectly
      if (typeof newContent !== 'string') {
        return;
      }
      try {
        updateContent(newContent);
      } catch {
        // Silently ignore errors
      }
    },
    [updateContent]
  );

  // 处理退出编辑模式 / Handle exit edit mode
  const handleExitEdit = useCallback(() => {
    // 如果有未保存的修改，弹出确认对话框 / If there are unsaved changes, show confirmation dialog
    if (activeTab?.isDirty) {
      setShowExitConfirm(true);
    } else {
      // 没有未保存的修改，直接退出 / No unsaved changes, exit directly
      setIsEditMode(false);
    }
  }, [activeTab?.isDirty]);

  // 处理保存 / Handle save
  const handleSave = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const success = await saveContent();
      if (!success) {
        Message.error(t('common.saveFailed'));
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : t('common.unknownError');
      Message.error(`${t('common.saveFailed')}: ${errorMsg}`);
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, saveContent, t]);

  // 确认退出编辑 / Confirm exit edit
  const handleConfirmExit = useCallback(() => {
    setIsEditMode(false);
    setShowExitConfirm(false);
  }, []);

  // 取消退出编辑 / Cancel exit edit
  const handleCancelExit = useCallback(() => {
    setShowExitConfirm(false);
  }, []);

  // 处理关闭tab / Handle close tab
  const handleCloseTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      // 如果tab有未保存的修改，显示确认对话框 / If tab has unsaved changes, show confirmation dialog
      if (tab?.isDirty) {
        setCloseTabConfirm({ show: true, tabId });
      } else {
        // 没有未保存的修改，直接关闭 / No unsaved changes, close directly
        closeTab(tabId);
      }
    },
    [tabs, closeTab]
  );

  // 保存并关闭tab / Save and close tab
  const handleSaveAndCloseTab = useCallback(async () => {
    if (!closeTabConfirm.tabId) return;

    try {
      const success = await saveContent(closeTabConfirm.tabId);
      if (!success) {
        throw new Error(t('common.saveFailed'));
      }
      closeTab(closeTabConfirm.tabId);
      setCloseTabConfirm({ show: false, tabId: null });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : t('common.unknownError');
      Message.error(`${t('common.saveFailed')}: ${errorMsg}`);
    }
  }, [closeTabConfirm.tabId, saveContent, closeTab, t]);

  // 不保存直接关闭tab / Close tab without saving
  const handleCloseWithoutSave = useCallback(() => {
    if (!closeTabConfirm.tabId) return;
    closeTab(closeTabConfirm.tabId);
    setCloseTabConfirm({ show: false, tabId: null });
  }, [closeTabConfirm.tabId, closeTab]);

  // 取消关闭tab / Cancel close tab
  const handleCancelCloseTab = useCallback(() => {
    setCloseTabConfirm({ show: false, tabId: null });
  }, []);

  // 处理 tab 右键菜单 / Handle tab context menu
  const handleTabContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      show: true,
      x: e.clientX,
      y: e.clientY,
      tabId,
    });
  }, []);

  // 关闭左侧 tabs / Close tabs to the left
  const handleCloseLeft = useCallback(
    (tabId: string) => {
      const currentIndex = tabs.findIndex((t) => t.id === tabId);
      if (currentIndex <= 0) return;

      const tabsToClose = tabs.slice(0, currentIndex);
      tabsToClose.forEach((tab) => closeTab(tab.id));
      setContextMenu({ show: false, x: 0, y: 0, tabId: null });
    },
    [tabs, closeTab]
  );

  // 关闭右侧 tabs / Close tabs to the right
  const handleCloseRight = useCallback(
    (tabId: string) => {
      const currentIndex = tabs.findIndex((t) => t.id === tabId);
      if (currentIndex < 0 || currentIndex >= tabs.length - 1) return;

      const tabsToClose = tabs.slice(currentIndex + 1);
      tabsToClose.forEach((tab) => closeTab(tab.id));
      setContextMenu({ show: false, x: 0, y: 0, tabId: null });
    },
    [tabs, closeTab]
  );

  // 关闭其他 tabs / Close other tabs
  const handleCloseOthers = useCallback(
    (tabId: string) => {
      const tabsToClose = tabs.filter((t) => t.id !== tabId);
      tabsToClose.forEach((tab) => closeTab(tab.id));
      setContextMenu({ show: false, x: 0, y: 0, tabId: null });
    },
    [tabs, closeTab]
  );

  // 关闭全部 tabs / Close all tabs
  const handleCloseAll = useCallback(() => {
    tabs.forEach((tab) => closeTab(tab.id));
    setContextMenu({ show: false, x: 0, y: 0, tabId: null });
  }, [tabs, closeTab]);

  // 如果预览面板未打开，不渲染 / Don't render if preview panel is not open
  if (!isOpen || !activeTab) return null;

  const { content, contentType, metadata } = activeTab;
  const isMarkdown = contentType === 'markdown';
  const isHTML = contentType === 'html';
  const isRemoteWorkspaceFile = metadata?.remote === true;
  const sourceViewEnabled = !isRemoteWorkspaceFile;
  const isEditable = metadata?.editable !== false && sourceViewEnabled; // 默认可编辑，远程临时空间只读 / Default editable, remote workspace is read-only

  // 对所有有 filePath 的文件显示"在系统中打开"按钮（统一在工具栏显示）
  // Show "Open in System" button for all files with filePath (unified in toolbar)
  const previewFilePath = metadata?.localPreviewFilePath || metadata?.filePath;
  const showOpenInSystemButton = Boolean(metadata?.filePath) && !isRemoteWorkspaceFile;
  const showHistoryControls = !isRemoteWorkspaceFile;

  // 下载文件到本地 / Download file to local system
  const handleDownload = useCallback(async () => {
    try {
      let blob: Blob | null = null;
      let ext = 'txt';
      const nameExt = metadata?.fileName?.split('.').pop();

      if (metadata?.downloadBase64) {
        const binaryString = atob(metadata.downloadBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        blob = new Blob([bytes], { type: metadata.downloadMime || 'application/octet-stream' });
        ext = nameExt || contentType;
      }

      // 二进制文件类型：从原始文件路径读取 Base64 数据
      // Binary file types: read Base64 data from the original file path
      // 注意：不能使用 readFileBuffer，因为 IPC 桥接层通过 JSON.stringify 序列化数据，
      // ArrayBuffer 在 JSON 序列化时会丢失（变为 {}），导致下载得到空文件。
      // Note: Cannot use readFileBuffer because the IPC bridge serializes data via JSON.stringify,
      // and ArrayBuffer is lost during JSON serialization (becomes {}), resulting in empty downloads.
      const binaryContentTypes = ['word', 'ppt', 'excel', 'pdf', 'video', 'audio'];
      if (!blob && binaryContentTypes.includes(contentType) && metadata?.filePath) {
        const base64 = await ipcBridge.fs.readFileBase64.invoke({ path: metadata.filePath });
        // 将 Base64 字符串解码为二进制数据 / Decode Base64 string to binary data
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        // 根据文件类型设置 MIME 类型 / Set MIME type based on file type
        const mimeTypes: Record<string, string> = {
          word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          ppt: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          pdf: 'application/pdf',
          video: nameExt ? `video/${nameExt === 'ogv' ? 'ogg' : nameExt}` : 'video/mp4',
          audio: nameExt ? `audio/${nameExt === 'm4a' ? 'mp4' : nameExt}` : 'audio/mpeg',
        };
        blob = new Blob([bytes], { type: mimeTypes[contentType] || 'application/octet-stream' });
        ext = nameExt || contentType;
      } else if (!blob && contentType === 'image') {
        // 图片文件：从 Base64 数据或文件路径读取 / Image files: read from Base64 data or file path
        let dataUrl = content;
        // 如果没有 Base64 数据，从文件路径读取 / If no Base64 data, read from file path
        if (!dataUrl && metadata?.filePath) {
          dataUrl = await ipcBridge.fs.getImageBase64.invoke({ path: metadata.filePath });
        }

        if (!dataUrl) {
          Message.error(t('messages.downloadFailed', { defaultValue: 'Failed to download' }));
          return;
        }

        // 将 Base64 数据转换为 Blob / Convert Base64 data to Blob
        blob = await fetch(dataUrl).then((res) => res.blob());

        // 优先使用文件名扩展名，其次使用 MIME 类型扩展名，最后默认为 png
        // Prefer filename extension, then MIME type extension, finally default to png
        const mimeExt = blob.type && blob.type.includes('/') ? blob.type.split('/').pop() : undefined;
        ext = nameExt || mimeExt || 'png';
      } else if (!blob) {
        // 文本文件：创建文本 Blob / Text files: create text Blob
        let mimeType = 'text/plain;charset=utf-8';
        if (contentType === 'markdown') mimeType = 'text/markdown;charset=utf-8';
        else if (contentType === 'html') mimeType = 'text/html;charset=utf-8';
        blob = new Blob([content], { type: mimeType });

        // 根据内容类型设置文件扩展名 / Set file extension based on content type
        if (nameExt) ext = nameExt;
        else if (contentType === 'markdown') ext = 'md';
        else if (contentType === 'diff') ext = 'diff';
        else if (contentType === 'code') {
          // 代码文件：根据语言设置扩展名 / Code files: set extension based on language
          const lang = metadata?.language;
          if (lang === 'javascript' || lang === 'js') ext = 'js';
          else if (lang === 'typescript' || lang === 'ts') ext = 'ts';
          else if (lang === 'python' || lang === 'py') ext = 'py';
          else if (lang === 'java') ext = 'java';
          else if (lang === 'cpp' || lang === 'c++') ext = 'cpp';
          else if (lang === 'c') ext = 'c';
          else if (lang === 'html') ext = 'html';
          else if (lang === 'css') ext = 'css';
          else if (lang === 'json') ext = 'json';
        } else if (contentType === 'html') {
          ext = 'html';
        }
      }

      if (!blob) {
        Message.error(t('messages.downloadFailed', { defaultValue: 'Failed to download' }));
        return;
      }

      // 创建下载链接并触发下载 / Create download link and trigger download
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const rawFileName = metadata?.fileName || `${contentType}-${Date.now()}`;
      if (metadata?.fileName && nameExt) {
        link.download = rawFileName;
      } else {
        const normalizedExt = ext.toLowerCase();
        const hasSameExt = rawFileName.toLowerCase().endsWith(`.${normalizedExt}`);
        link.download = hasSameExt ? rawFileName : `${rawFileName}.${ext}`;
      }
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url); // 释放 URL 对象 / Release URL object
    } catch (error) {
      console.error('[PreviewPanel] Failed to download file:', error);
      Message.error(t('messages.downloadFailed', { defaultValue: 'Failed to download' }));
    }
  }, [content, contentType, metadata?.downloadBase64, metadata?.downloadMime, metadata?.fileName, metadata?.filePath, metadata?.language, t]);

  // 在系统默认应用中打开文件 / Open file in system default application
  const handleOpenInSystem = useCallback(async () => {
    if (!metadata?.filePath) {
      Message.error(t('preview.openInSystemFailed'));
      return;
    }

    try {
      // 使用系统默认应用打开文件 / Open file with system default application
      await ipcBridge.shell.openFile.invoke(metadata.filePath);
      Message.success(t('preview.openInSystemSuccess'));
    } catch {
      Message.error(t('preview.openInSystemFailed'));
    }
  }, [metadata?.filePath, t]);

  // 渲染历史下拉菜单 / Render history dropdown
  const renderHistoryDropdown = () => {
    // eslint-disable-next-line max-len
    return <PreviewHistoryDropdown historyVersions={historyVersions} historyLoading={historyLoading} historyError={historyError} historyTarget={historyTarget} currentTheme={currentTheme} onSnapshotSelect={handleSnapshotSelect} />;
  };

  const renderSplitContent = (editor: React.ReactNode, preview: React.ReactNode) => (
    <Group className='flex-1' defaultLayout={splitDefaultLayout} onLayoutChanged={onSplitLayoutChanged}>
      <Panel id='editor' defaultSize={`${DEFAULT_SPLIT_RATIO}%`} minSize={`${MIN_SPLIT_WIDTH}%`} maxSize={`${MAX_SPLIT_WIDTH}%`} className='flex flex-col min-w-0'>
        {editor}
      </Panel>
      <ResizableSeparator />
      <Panel id='preview' defaultSize={`${100 - DEFAULT_SPLIT_RATIO}%`} minSize={`${100 - MAX_SPLIT_WIDTH}%`} maxSize={`${100 - MIN_SPLIT_WIDTH}%`} className='flex flex-col min-w-0'>
        {preview}
      </Panel>
    </Group>
  );

  // 渲染预览内容 / Render preview content
  const renderContent = () => {
    // Markdown 模式 / Markdown mode
    if (isMarkdown) {
      // 分屏模式：左右分割（编辑器 + 预览）/ Split-screen mode: Editor + Preview
      if (isSplitScreenEnabled && sourceViewEnabled) {
        return renderSplitContent(
          <>
            <div className='h-40px flex items-center px-12px'>
              <span className='text-12px text-secondary'>{t('preview.editor')}</span>
            </div>
            <div className='flex-1 overflow-hidden'>
              <MarkdownEditor value={content} onChange={updateContent} containerRef={editorContainerRef} onScroll={handleEditorScroll} />
            </div>
          </>,
          <>
            <div className='h-40px flex items-center px-12px'>
              <span className='text-12px text-secondary'>{t('preview.preview')}</span>
            </div>
            <div className='flex flex-col flex-1 overflow-hidden'>
              <MarkdownPreview content={content} hideToolbar containerRef={previewContainerRef} onScroll={handlePreviewScroll} filePath={metadata?.filePath} />
            </div>
          </>
        );
      }

      // 非分屏模式：单栏（原文或预览）/ Non-split mode: Single panel (source or preview)
      return <MarkdownPreview content={content} hideToolbar viewMode={sourceViewEnabled ? viewMode : 'preview'} onViewModeChange={sourceViewEnabled ? setViewMode : undefined} onContentChange={sourceViewEnabled ? updateContent : undefined} filePath={metadata?.filePath} />;
    }

    // HTML 模式 / HTML mode
    if (isHTML) {
      // 分屏模式：左右分割（编辑器 + 预览）/ Split-screen mode: Editor + Preview
      if (isSplitScreenEnabled && sourceViewEnabled) {
        return renderSplitContent(
          <>
            <div className='h-40px flex items-center px-12px'>
              <span className='text-12px text-secondary'>{t('preview.editor')}</span>
            </div>
            <div className='flex-1 overflow-hidden'>
              <HTMLEditor value={content} onChange={updateContent} containerRef={editorContainerRef} onScroll={handleEditorScroll} filePath={metadata?.filePath} />
            </div>
          </>,
          <>
            <div className='h-40px flex items-center justify-between px-12px'>
              <span className='text-12px text-secondary'>{t('preview.preview')}</span>
            </div>
            <div className='flex flex-col flex-1 overflow-hidden'>
              {/* prettier-ignore */}
              {/* eslint-disable-next-line max-len */}
              <HTMLRenderer content={content} filePath={previewFilePath} containerRef={previewContainerRef} onScroll={handlePreviewScroll} inspectMode={inspectMode} copySuccessMessage={t('preview.html.copySuccess')} onElementSelected={handleElementSelected} />
            </div>
          </>
        );
      }

      // 非分屏模式：单栏（原文或预览）/ Non-split mode: Single panel (source or preview)
      if (sourceViewEnabled && viewMode === 'source') {
        return (
          <div className='flex-1 overflow-hidden'>
            <HTMLEditor value={content} onChange={handleContentChange} filePath={metadata?.filePath} />
          </div>
        );
      } else {
        // 预览模式 / Preview mode
        return (
          <div className='flex-1 overflow-hidden'>
            <HTMLRenderer content={content} filePath={previewFilePath} inspectMode={inspectMode} copySuccessMessage={t('preview.html.copySuccess')} onElementSelected={handleElementSelected} />
          </div>
        );
      }
    }

    // 其他类型：全屏预览 / Other types: Full-screen preview
    if (contentType === 'diff') {
      return <DiffPreview content={content} metadata={metadata} hideToolbar viewMode={sourceViewEnabled ? viewMode : 'preview'} onViewModeChange={sourceViewEnabled ? setViewMode : undefined} />;
    } else if (contentType === 'code') {
      // 分屏模式：左右分割（编辑器 + 预览）/ Split-screen mode: Editor + Preview
      if (isSplitScreenEnabled && isEditMode && isEditable && sourceViewEnabled) {
        return renderSplitContent(
          <>
            <div className='h-40px flex items-center px-12px'>
              <span className='text-12px text-secondary'>{t('preview.editor')}</span>
            </div>
            <div className='flex-1 overflow-hidden'>
              <TextEditor value={content} onChange={updateContent} containerRef={editorContainerRef} onScroll={handleEditorScroll} />
            </div>
          </>,
          <>
            <div className='h-40px flex items-center px-12px'>
              <span className='text-12px text-secondary'>{t('preview.preview')}</span>
            </div>
            <div className='flex flex-col flex-1 overflow-hidden'>
              <CodePreview content={content} language={metadata?.language} hideToolbar containerRef={previewContainerRef} onScroll={handlePreviewScroll} />
            </div>
          </>
        );
      }

      // 非分屏模式：如果处于编辑模式且可编辑，显示文本编辑器 / Non-split mode: If in edit mode and editable, show text editor
      if (isEditMode && isEditable) {
        return (
          <div className='flex-1 overflow-hidden'>
            <TextEditor value={content} onChange={handleContentChange} />
          </div>
        );
      }
      // 否则显示代码预览 / Otherwise show code preview
      return <CodePreview content={content} language={metadata?.language} hideToolbar viewMode={sourceViewEnabled ? viewMode : 'preview'} onViewModeChange={sourceViewEnabled ? setViewMode : undefined} />;
    } else if (contentType === 'pdf') {
      return <PDFPreview filePath={previewFilePath} content={content} hideToolbar={isRemoteWorkspaceFile} />;
    } else if (contentType === 'ppt') {
      return <PPTPreview filePath={previewFilePath} content={content} hideToolbar={isRemoteWorkspaceFile} />;
    } else if (contentType === 'word') {
      return <WordPreview filePath={previewFilePath} content={content} hideToolbar={isRemoteWorkspaceFile} />;
    } else if (contentType === 'excel') {
      return <ExcelPreview filePath={previewFilePath} content={content} hideToolbar={isRemoteWorkspaceFile} />;
    } else if (contentType === 'image') {
      return <ImagePreview filePath={previewFilePath} content={content} fileName={metadata?.fileName || metadata?.title} />;
    } else if (contentType === 'video') {
      return <VideoPreview filePath={previewFilePath} content={content} fileName={metadata?.fileName || metadata?.title} />;
    } else if (contentType === 'audio') {
      return <AudioPreview filePath={previewFilePath} content={content} fileName={metadata?.fileName || metadata?.title} />;
    } else if (contentType === 'url') {
      // URL 预览模式 / URL preview mode
      return <URLViewer url={content} title={metadata?.title} />;
    }

    return null;
  };

  // 将 tabs 转换为 PreviewTab 类型 / Convert tabs to PreviewTab type
  const previewTabs: PreviewTab[] = tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    isDirty: tab.isDirty,
  }));

  return (
    <PreviewToolbarExtrasProvider value={toolbarExtrasContextValue}>
      <div className='h-full flex flex-col bg-1 rounded-[16px]'>
        {/* 确认对话框 / Confirmation modals */}
        {/* eslint-disable-next-line max-len */}
        <PreviewConfirmModals showExitConfirm={showExitConfirm} closeTabConfirm={closeTabConfirm} onConfirmExit={handleConfirmExit} onCancelExit={handleCancelExit} onSaveAndCloseTab={handleSaveAndCloseTab} onCloseWithoutSave={handleCloseWithoutSave} onCancelCloseTab={handleCancelCloseTab} />

        {/* Tab 栏 / Tab bar */}
        {/* eslint-disable-next-line max-len */}
        <PreviewTabs tabs={previewTabs} activeTabId={activeTabId} tabFadeState={tabFadeState} tabsContainerRef={tabsContainerRef} onSwitchTab={switchTab} onCloseTab={handleCloseTab} onContextMenu={handleTabContextMenu} />

        {/* 工具栏（URL 类型不显示工具栏，因为不需要下载/编辑等功能）/ Toolbar (hidden for URL type as it doesn't need download/edit features) */}
        {contentType !== 'url' && (
          <PreviewToolbar
            contentType={contentType}
            isMarkdown={isMarkdown}
            isHTML={isHTML}
            isEditable={isEditable}
            isEditMode={isEditMode}
            viewMode={viewMode}
            isSplitScreenEnabled={isSplitScreenEnabled}
            fileName={metadata?.fileName || activeTab.title}
            showOpenInSystemButton={showOpenInSystemButton}
            historyTarget={historyTarget}
            snapshotSaving={snapshotSaving}
            showHistoryControls={showHistoryControls}
            sourceViewEnabled={sourceViewEnabled}
            isDirty={activeTab?.isDirty}
            onSave={handleSave}
            isSaving={isSaving}
            onViewModeChange={(mode) => {
              setViewMode(mode);
              setIsSplitScreenEnabled(false); // 切换视图模式时关闭分屏 / Disable split when switching view mode
            }}
            onSplitScreenToggle={() => setIsSplitScreenEnabled(!isSplitScreenEnabled)}
            onEditClick={() => {
              if (!sourceViewEnabled) return;
              setIsEditMode(true);
              // Code/TXT 类型进入编辑模式时自动开启分屏 / Auto enable split screen for Code/TXT when entering edit mode
              if (contentType === 'code') {
                setIsSplitScreenEnabled(true);
              }
            }}
            onExitEdit={handleExitEdit}
            onSaveSnapshot={handleSaveSnapshot}
            onRefreshHistory={refreshHistory}
            renderHistoryDropdown={renderHistoryDropdown}
            onOpenInSystem={handleOpenInSystem}
            onDownload={handleDownload}
            onClose={closePreview}
            inspectMode={inspectMode}
            onInspectModeToggle={() => setInspectMode(!inspectMode)}
            leftExtra={toolbarExtras?.left}
            rightExtra={toolbarExtras?.right}
          />
        )}

        {/* 预览内容 / Preview content */}
        {renderContent()}

        {/* Tab 右键菜单 / Tab context menu */}
        {/* eslint-disable-next-line max-len */}
        <PreviewContextMenu contextMenu={contextMenu} tabs={previewTabs} currentTheme={currentTheme} onClose={() => setContextMenu({ show: false, x: 0, y: 0, tabId: null })} onCloseLeft={handleCloseLeft} onCloseRight={handleCloseRight} onCloseOthers={handleCloseOthers} onCloseAll={handleCloseAll} />
      </div>
    </PreviewToolbarExtrasProvider>
  );
};

export default PreviewPanel;
