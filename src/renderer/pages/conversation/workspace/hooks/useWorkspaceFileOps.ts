/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IDirOrFile, MossWorkspaceFilePreview } from '@/common/ipcBridge';
import type { PreviewContentType } from '@/common/types/preview';
import { emitter } from '@/renderer/utils/emitter';
import { LARGE_TEXT_PREVIEW_MAX_LENGTH, LARGE_TEXT_PREVIEW_THRESHOLD } from '@/renderer/pages/conversation/preview/constants';
import { removeWorkspaceEntry, renameWorkspaceEntry } from '@/renderer/utils/workspaceFs';
import { useCallback } from 'react';
import type { MessageApi, RenameModalState, DeleteModalState } from '../types';
import type { FileOrFolderItem } from '@/renderer/types/files';
import { getPathSeparator, replacePathInList, updateTreeForRename } from '../utils/treeHelpers';

// Module-level cache for LibreOffice availability
// 模块级别的 LibreOffice 可用性缓存
let libreOfficeAvailableCache: boolean | null = null;
let libreOfficeCheckPromise: Promise<boolean> | null = null;

/**
 * Check if LibreOffice is available (with caching)
 * 检查 LibreOffice 是否可用（带缓存）
 */
async function checkLibreOfficeAvailable(): Promise<boolean> {
  // Return cached value if available
  if (libreOfficeAvailableCache !== null) {
    return libreOfficeAvailableCache;
  }

  // If a check is already in progress, wait for it
  if (libreOfficeCheckPromise) {
    return libreOfficeCheckPromise;
  }

  libreOfficeCheckPromise = (async () => {
    try {
      const result = await ipcBridge.document.libreOffice.isAvailable.invoke();
      libreOfficeAvailableCache = result;
      return result;
    } catch (error) {
      console.error('[useWorkspaceFileOps] Failed to check LibreOffice availability:', error);
      libreOfficeAvailableCache = false;
      return false;
    } finally {
      libreOfficeCheckPromise = null;
    }
  })();

  return libreOfficeCheckPromise;
}

interface UseWorkspaceFileOpsOptions {
  workspace: string;
  eventPrefix: 'acp' | 'remote-agent';
  /** Required when eventPrefix is 'remote-agent' for scoped events */
  conversation_id?: string;
  dataSource?: 'local' | 'moss-session';
  readonly?: boolean;
  messageApi: MessageApi;
  t: (key: string) => string;

  // Dependencies from useWorkspaceTree
  setFiles: React.Dispatch<React.SetStateAction<IDirOrFile[]>>;
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
  setExpandedKeys: React.Dispatch<React.SetStateAction<string[]>>;
  selectedKeysRef: React.MutableRefObject<string[]>;
  selectedNodeRef: React.MutableRefObject<{ relativePath: string; fullPath: string } | null>;
  ensureNodeSelected: (nodeData: IDirOrFile, options?: { emit?: boolean }) => void;
  refreshWorkspace: () => void;

  // Dependencies from useWorkspaceModals (will be created next)
  renameModal: RenameModalState;
  deleteModal: DeleteModalState;
  renameLoading: boolean;
  setRenameLoading: React.Dispatch<React.SetStateAction<boolean>>;
  closeRenameModal: () => void;
  closeDeleteModal: () => void;
  closeContextMenu: () => void;
  setRenameModal: React.Dispatch<React.SetStateAction<RenameModalState>>;
  setDeleteModal: React.Dispatch<React.SetStateAction<DeleteModalState>>;

  // Dependencies from preview context
  openPreview: (content: string, type: PreviewContentType, metadata?: any) => void;
}

function toDataUrl(mime: string | undefined, base64: string): string {
  if (!base64) return '';
  if (base64.startsWith('data:')) return base64;
  return `data:${mime || 'application/octet-stream'};base64,${base64}`;
}

function textToDataUrl(mime: string | undefined, content: string): string {
  if (!content) return '';
  return `data:${mime || 'text/plain'};charset=utf-8,${encodeURIComponent(content)}`;
}

function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function isLikelyTextContent(content: string): boolean {
  if (!content.trim()) return false;
  let controlCount = 0;
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      controlCount += 1;
    }
  }
  return controlCount / content.length < 0.02;
}

function decodeBase64TextIfLikely(base64: string): string | undefined {
  const bytes = base64ToBytes(base64);
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return undefined;

  try {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return isLikelyTextContent(content) ? content : undefined;
  } catch {
    return undefined;
  }
}

function getWordTextPreviewType(mime: string | undefined, content: string): PreviewContentType | undefined {
  const trimmed = content.trimStart();
  if (trimmed.startsWith('{\\rtf')) return undefined;
  if (mime?.includes('html') || /^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return 'html';
  if (/^(#{1,6}\s|[-*+]\s|\d+\.\s|```|---\s*$|>\s)/m.test(content)) return 'markdown';
  return 'code';
}

const REMOTE_LOCAL_PREVIEW_TYPES = new Set<PreviewContentType>(['pdf', 'ppt', 'word', 'excel', 'video', 'audio']);

async function createRemoteLocalPreviewFile(fileName: string, contentBase64: string): Promise<string> {
  const localPreviewFilePath = await ipcBridge.fs.createTempFile.invoke({ fileName });
  const written = await ipcBridge.fs.writeFile.invoke({
    path: localPreviewFilePath,
    data: base64ToBytes(contentBase64),
  });
  if (!written) {
    throw new Error(`Failed to prepare remote preview for ${fileName}`);
  }
  return localPreviewFilePath;
}

async function createRemoteTextPreviewFile(fileName: string, content: string): Promise<string> {
  const localPreviewFilePath = await ipcBridge.fs.createTempFile.invoke({ fileName });
  const written = await ipcBridge.fs.writeFile.invoke({
    path: localPreviewFilePath,
    data: content,
  });
  if (!written) {
    throw new Error(`Failed to prepare remote preview for ${fileName}`);
  }
  return localPreviewFilePath;
}

/**
 * useWorkspaceFileOps - 文件操作逻辑（打开、删除、重命名、预览、添加到聊天）
 * File operations logic (open, delete, rename, preview, add to chat)
 */
export function useWorkspaceFileOps(options: UseWorkspaceFileOpsOptions) {
  const { workspace, eventPrefix, conversation_id, dataSource = 'local', readonly = false, messageApi, t, setFiles, setSelected, setExpandedKeys, selectedKeysRef, selectedNodeRef, ensureNodeSelected, refreshWorkspace, renameModal, deleteModal, renameLoading, setRenameLoading, closeRenameModal, closeDeleteModal, closeContextMenu, setRenameModal, setDeleteModal, openPreview } = options;

  /**
   * 打开文件或文件夹（使用系统默认程序）
   * Open file or folder with system default handler
   */
  const handleOpenNode = useCallback(
    async (nodeData: IDirOrFile | null) => {
      if (!nodeData) return;
      try {
        await ipcBridge.shell.openFile.invoke(nodeData.fullPath);
      } catch (error) {
        messageApi.error(t('conversation.workspace.contextMenu.openFailed') || 'Failed to open');
      }
    },
    [messageApi, t]
  );

  /**
   * 在系统文件管理器中定位文件/文件夹
   * Reveal item in system file explorer
   */
  const handleRevealNode = useCallback(
    async (nodeData: IDirOrFile | null) => {
      if (!nodeData) return;
      try {
        await ipcBridge.shell.showItemInFolder.invoke(nodeData.fullPath);
      } catch (error) {
        messageApi.error(t('conversation.workspace.contextMenu.revealFailed') || 'Failed to reveal');
      }
    },
    [messageApi, t]
  );

  /**
   * 显示删除确认弹窗
   * Show delete confirmation modal
   */
  const handleDeleteNode = useCallback(
    (nodeData: IDirOrFile | null, options?: { emit?: boolean }) => {
      if (!nodeData || !nodeData.relativePath) return;
      ensureNodeSelected(nodeData, { emit: Boolean(options?.emit) });
      closeContextMenu();
      setDeleteModal({ visible: true, target: nodeData, loading: false });
    },
    [closeContextMenu, ensureNodeSelected, setDeleteModal]
  );

  /**
   * 确认删除操作
   * Confirm delete operation
   */
  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteModal.target) return;
    try {
      setDeleteModal((prev) => ({ ...prev, loading: true }));
      const res = await removeWorkspaceEntry(deleteModal.target.fullPath);
      if (!res?.success) {
        const errorMsg = res?.msg || t('conversation.workspace.contextMenu.deleteFailed');
        messageApi.error(errorMsg);
        setDeleteModal((prev) => ({ ...prev, loading: false }));
        return;
      }

      messageApi.success(t('conversation.workspace.contextMenu.deleteSuccess'));
      setSelected([]);
      selectedKeysRef.current = [];
      selectedNodeRef.current = null;
      if (eventPrefix === 'acp') {
        emitter.emit('acp.selected.file', []);
      }
      // Notify @file selector to refresh / 通知 @文件 选择器刷新
      emitter.emit(`${eventPrefix}.workspace.refresh` as any);
      closeDeleteModal();
      setTimeout(() => refreshWorkspace(), 200);
    } catch (error) {
      messageApi.error(t('conversation.workspace.contextMenu.deleteFailed'));
      setDeleteModal((prev) => ({ ...prev, loading: false }));
    }
  }, [deleteModal.target, closeDeleteModal, eventPrefix, conversation_id, messageApi, refreshWorkspace, t, setSelected, selectedKeysRef, selectedNodeRef, setDeleteModal]);

  /**
   * 超时包装器
   * Wrap promise with timeout guard
   */
  const waitWithTimeout = useCallback(<T>(promise: Promise<T>, timeoutMs = 8000) => {
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error('timeout'));
      }, timeoutMs);

      promise
        .then((value) => {
          window.clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          window.clearTimeout(timer);
          reject(error);
        });
    });
  }, []);

  /**
   * 确认重命名操作
   * Confirm rename operation
   */
  const handleRenameConfirm = useCallback(async () => {
    const target = renameModal.target;
    if (!target) return;
    if (renameLoading) return;
    const trimmedName = renameModal.value.trim();

    if (!trimmedName) {
      messageApi.warning(t('conversation.workspace.contextMenu.renameEmpty'));
      return;
    }

    if (trimmedName === target.name) {
      closeRenameModal();
      return;
    }

    const sep = getPathSeparator(target.fullPath);
    const parentFull = target.fullPath.slice(0, target.fullPath.lastIndexOf(sep));
    const newFullPath = parentFull ? `${parentFull}${sep}${trimmedName}` : trimmedName;

    const newRelativePath = (() => {
      if (!target.relativePath) {
        return target.isFile ? trimmedName : '';
      }
      const segments = target.relativePath.split('/');
      segments[segments.length - 1] = trimmedName;
      return segments.join('/');
    })();

    try {
      setRenameLoading(true);
      const response = await waitWithTimeout(renameWorkspaceEntry(target.fullPath, trimmedName));
      if (!response?.success) {
        const errorMsg = response?.msg || t('conversation.workspace.contextMenu.renameFailed');
        messageApi.error(errorMsg);
        return;
      }

      closeRenameModal();

      setFiles((prev) => updateTreeForRename(prev, target.relativePath ?? '', trimmedName, newFullPath));

      const oldRelativePath = target.relativePath ?? '';
      setExpandedKeys((prev) => replacePathInList(prev, oldRelativePath, newRelativePath));

      setSelected((prev) => replacePathInList(prev, oldRelativePath, newRelativePath));
      selectedKeysRef.current = replacePathInList(selectedKeysRef.current, oldRelativePath, newRelativePath);

      if (!target.isFile) {
        selectedNodeRef.current = {
          relativePath: newRelativePath,
          fullPath: newFullPath,
        };
        if (eventPrefix === 'acp') {
          emitter.emit('acp.selected.file', []);
        }
      } else {
        selectedNodeRef.current = null;
      }

      messageApi.success(t('conversation.workspace.contextMenu.renameSuccess'));
      // Notify @file selector to refresh / 通知 @文件 选择器刷新
      emitter.emit(`${eventPrefix}.workspace.refresh` as any);
    } catch (error) {
      if (error instanceof Error && error.message === 'timeout') {
        messageApi.error(t('conversation.workspace.contextMenu.renameTimeout'));
      } else {
        messageApi.error(t('conversation.workspace.contextMenu.renameFailed'));
      }
    } finally {
      setRenameLoading(false);
    }
  }, [closeRenameModal, eventPrefix, conversation_id, messageApi, renameLoading, renameModal, t, waitWithTimeout, setFiles, setExpandedKeys, setSelected, selectedKeysRef, selectedNodeRef, setRenameLoading]);

  /**
   * 添加到聊天
   * Add to chat
   */
  const handleAddToChat = useCallback(
    (nodeData: IDirOrFile | null) => {
      if (!nodeData || !nodeData.fullPath) return;
      ensureNodeSelected(nodeData);
      closeContextMenu();

      const payload: FileOrFolderItem = {
        path: nodeData.fullPath,
        name: nodeData.name,
        isFile: Boolean(nodeData.isFile),
        relativePath: nodeData.relativePath || undefined,
      };

      if (eventPrefix === 'acp') {
        emitter.emit('acp.selected.file.append', [payload]);
      }
      messageApi.success(t('conversation.workspace.contextMenu.addedToChat'));
    },
    [closeContextMenu, ensureNodeSelected, eventPrefix, conversation_id, messageApi, t]
  );

  /**
   * 预览文件
   * Preview file
   */
  const handlePreviewFile = useCallback(
    async (nodeData: IDirOrFile | null) => {
      if (!nodeData || !nodeData.fullPath || !nodeData.isFile) return;

      try {
        closeContextMenu();

        // 根据文件扩展名确定内容类型 / Determine content type based on file extension
        const ext = nodeData.name.toLowerCase().split('.').pop() || '';

        // 支持的图片格式列表 / List of supported image formats
        const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tif', 'tiff', 'avif'];
        const videoExtensions = ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'avi', 'mkv', 'wmv', 'flv'];
        const audioExtensions = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'amr', 'wma'];

        // Office 文件扩展名 / Office file extensions
        const pptExtensions = ['ppt', 'pptx', 'odp'];
        const wordExtensions = ['doc', 'docx', 'odt'];
        const excelExtensions = ['xls', 'xlsx', 'ods'];
        const officeExtensions = [...pptExtensions, ...wordExtensions, ...excelExtensions];

        let contentType: PreviewContentType = 'code';
        let content = '';
        let isLargeTextTruncated = false;
        let localPreviewFilePath: string | undefined;

        // 根据扩展名判断文件类型 / Determine file type based on extension
        if (ext === 'md' || ext === 'markdown') {
          contentType = 'markdown';
        } else if (ext === 'diff' || ext === 'patch') {
          contentType = 'diff';
        } else if (ext === 'pdf') {
          contentType = 'pdf';
        } else if (pptExtensions.includes(ext)) {
          contentType = 'ppt';
        } else if (wordExtensions.includes(ext)) {
          contentType = 'word';
        } else if (excelExtensions.includes(ext)) {
          contentType = 'excel';
        } else if (ext === 'csv') {
          // CSV files are text files, read as text (don't use excel viewer)
          contentType = 'code';
        } else if (['html', 'htm'].includes(ext)) {
          contentType = 'html';
        } else if (imageExtensions.includes(ext)) {
          contentType = 'image';
        } else if (videoExtensions.includes(ext)) {
          contentType = 'video';
        } else if (audioExtensions.includes(ext)) {
          contentType = 'audio';
        } else if (['js', 'ts', 'tsx', 'jsx', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'hpp', 'css', 'scss', 'json', 'xml', 'yaml', 'yml', 'txt', 'log', 'sh', 'bash', 'zsh', 'fish', 'sql', 'rb', 'php', 'swift', 'kt', 'scala', 'r', 'lua', 'vim', 'toml', 'ini', 'cfg', 'conf', 'env', 'gitignore', 'dockerignore', 'editorconfig'].includes(ext)) {
          contentType = 'code';
        } else {
          // 未知扩展名也默认为 code 类型，尝试作为文本读取 / Unknown extensions also default to code type, try to read as text
          contentType = 'code';
        }

        // Warm LibreOffice availability cache for Office viewers.
        // 为 Office 预览组件预热 LibreOffice 可用性缓存。
        if (officeExtensions.includes(ext)) {
          await checkLibreOfficeAvailable();
        }

        let remotePreview: MossWorkspaceFilePreview | undefined;
        if (dataSource === 'moss-session') {
          if (!conversation_id) {
            throw new Error('conversation_id is required for remote preview');
          }
          const res = await ipcBridge.conversation.previewRemoteWorkspaceFile.invoke({
            conversation_id,
            path: nodeData.relativePath || nodeData.fullPath,
          });
          if (!res?.success || !res.data) {
            throw new Error(res?.msg || 'Failed to preview remote workspace file');
          }
          remotePreview = res.data;
        }

        // 根据文件类型读取内容 / Read content based on file type
        if (remotePreview) {
          if (remotePreview.kind === 'text') {
            if (contentType === 'word') {
              contentType = getWordTextPreviewType(remotePreview.mime, remotePreview.content) || 'code';
              content = remotePreview.content;
            } else {
              content = contentType === 'image' ? textToDataUrl(remotePreview.mime, remotePreview.content) : remotePreview.content;
            }
            if (contentType === 'html') {
              localPreviewFilePath = await createRemoteTextPreviewFile(nodeData.name, content);
            }
            isLargeTextTruncated = Boolean(remotePreview.truncated);
          } else if (contentType === 'image') {
            content = toDataUrl(remotePreview.mime, remotePreview.contentBase64);
          } else if (contentType === 'word') {
            const textContent = decodeBase64TextIfLikely(remotePreview.contentBase64);
            const textPreviewType = textContent ? getWordTextPreviewType(remotePreview.mime, textContent) : undefined;
            if (textContent && textPreviewType) {
              contentType = textPreviewType;
              content = textContent;
              if (contentType === 'html') {
                localPreviewFilePath = await createRemoteTextPreviewFile(nodeData.name, content);
              }
            } else {
              content = remotePreview.contentBase64;
              localPreviewFilePath = await createRemoteLocalPreviewFile(nodeData.name, remotePreview.contentBase64);
            }
          } else if (REMOTE_LOCAL_PREVIEW_TYPES.has(contentType)) {
            content = remotePreview.contentBase64;
            localPreviewFilePath = await createRemoteLocalPreviewFile(nodeData.name, remotePreview.contentBase64);
            if (contentType === 'pdf' || contentType === 'video' || contentType === 'audio') {
              content = '';
            }
          } else {
            content = remotePreview.contentBase64;
          }
        } else if (contentType === 'pdf') {
          content = '';
        } else if (contentType === 'video' || contentType === 'audio') {
          content = '';
        } else if (contentType === 'word' || contentType === 'excel' || contentType === 'ppt') {
          // Office 文件：读取原始二进制内容
          // Office files: read raw binary content for both LibreOffice available and unavailable cases
          // Viewer 组件会根据 LibreOffice 可用性决定显示 PDF 还是 CodeViewer
          // Viewer component will decide to show PDF or CodeViewer based on LibreOffice availability
          try {
            const arrayBuffer = await ipcBridge.fs.readFileBuffer.invoke({ path: nodeData.fullPath });
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            content = btoa(binary);
          } catch (readError) {
            console.error('[handlePreviewFile] Failed to read Office file buffer:', readError);
            content = '';
          }
        } else if (contentType === 'image') {
          // 图片: 读取为 Base64 格式 / Image: Read as Base64 format
          content = await ipcBridge.fs.getImageBase64.invoke({ path: nodeData.fullPath });
        } else {
          // 文本文件：使用 UTF-8 编码读取 / Text files: Read using UTF-8 encoding
          content = await ipcBridge.fs.readFile.invoke({ path: nodeData.fullPath });

          // 大文本仅保留前一段预览内容，避免切换/关闭 tab 时卡顿
          // Keep only first chunk for large text preview to reduce tab switch/close jank
          if (contentType === 'code' && content.length > LARGE_TEXT_PREVIEW_THRESHOLD) {
            content = content.slice(0, LARGE_TEXT_PREVIEW_MAX_LENGTH);
            isLargeTextTruncated = true;
          }
        }

        // 打开预览面板并传入文件元数据 / Open preview panel with file metadata
        openPreview(content, contentType, {
          title: nodeData.name,
          fileName: nodeData.name,
          filePath: dataSource === 'moss-session' ? undefined : nodeData.fullPath,
          workspace: workspace,
          language: ext,
          remote: dataSource === 'moss-session' ? true : undefined,
          relativePath: dataSource === 'moss-session' ? nodeData.relativePath : undefined,
          localPreviewFilePath,
          downloadBase64: remotePreview?.kind === 'base64' ? remotePreview.contentBase64 : undefined,
          downloadMime: remotePreview?.kind === 'base64' ? remotePreview.mime : undefined,
          // Markdown and media files default to read-only mode
          editable: readonly || dataSource === 'moss-session' || contentType === 'markdown' || contentType === 'image' || contentType === 'video' || contentType === 'audio' || isLargeTextTruncated ? false : undefined,
        });
      } catch (error) {
        messageApi.error(t('conversation.workspace.contextMenu.previewFailed'));
      }
    },
    [closeContextMenu, dataSource, conversation_id, openPreview, readonly, workspace, messageApi, t]
  );

  /**
   * 打开重命名弹窗
   * Open rename modal
   */
  const openRenameModal = useCallback(
    (nodeData: IDirOrFile | null) => {
      if (!nodeData) return;
      ensureNodeSelected(nodeData);
      closeContextMenu();
      setRenameModal({ visible: true, value: nodeData.name, target: nodeData });
    },
    [closeContextMenu, ensureNodeSelected, setRenameModal]
  );

  return {
    handleOpenNode,
    handleRevealNode,
    handleDeleteNode,
    handleDeleteConfirm,
    handleRenameConfirm,
    handleAddToChat,
    handlePreviewFile,
    openRenameModal,
  };
}
