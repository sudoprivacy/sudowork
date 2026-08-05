/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Checkbox, Input, Message, Modal, Tooltip, Tree } from '@arco-design/web-react';
import type { RefInputType } from '@arco-design/web-react/es/Input/interface';
import { Cloudy, DownSmall, FileText, FolderOpen, Magic, Refresh, Search } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import type { IDirOrFile } from '@/common/ipcBridge';
import { DRAFTS_DIR_NAME, isReservedDraftsDirName } from '@/common/constants';
import { STORAGE_KEYS } from '@/common/storageKeys';
import { showShareLoading, updateShareSuccess, updateShareError } from '@/renderer/utils/shareNotify';
import FlexFullContainer from '@/renderer/components/FlexFullContainer';
import EmptyState from '@/renderer/components/base/EmptyState';
import useDebounce from '@/renderer/hooks/useDebounce';
import { usePreviewContext } from '@/renderer/pages/conversation/preview';
import { emitter } from '@/renderer/utils/emitter';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { getLastDirectoryName, isTemporaryWorkspace as checkIsTemporaryWorkspace, isChannelWorkspace as checkIsChannelWorkspace, getWorkspaceDisplayName as getDisplayName } from '@/renderer/utils/workspace';
import { resolveFileIcon } from '@/renderer/utils/fileIcon';
import DirectorySelectionModal from '@/renderer/components/DirectorySelectionModal';
import BdpanUploadDirPicker from '@/renderer/components/base/BdpanUploadDirPicker';
import { uuid } from '@/common/utils';
import { extractNodeData, extractNodeKey, findNodeByKey, getTargetFolderPath, sortTreeNodes, updateTreeNodeChildren } from './utils/treeHelpers';
import type { WorkspaceProps } from './types';
import { resolveWorkspaceSkillRoot } from './skillRoots';
import WorkspaceSkills, { type WorkspaceSkillsHandle } from './WorkspaceSkills';
import { useWorkspaceDragImport } from './hooks/useWorkspaceDragImport';
import { useWorkspaceTree } from './hooks/useWorkspaceTree';
import { useWorkspacePaste } from './hooks/useWorkspacePaste';
import { useWorkspaceModals } from './hooks/useWorkspaceModals';
import { useWorkspaceFileOps } from './hooks/useWorkspaceFileOps';
import { useWorkspaceEvents } from './hooks/useWorkspaceEvents';
// TaskPanel temporarily hidden per product feedback — see commit 9420ab13.
// import TaskPanel from './TaskPanel';
import './workspace-card.css';

const WORKSPACE_FOLDER_ICON_COLOR = '#f59e0b';

function isHiddenWorkspaceEntry(name: string): boolean {
  if (name === DRAFTS_DIR_NAME) {
    return false;
  }
  return name.startsWith('.');
}

function resolveWorkspaceFileIcon(fileName: string): React.ReactNode | null {
  return resolveFileIcon(fileName, { size: 16, theme: 'outline' });
}

const ChatWorkspace: React.FC<WorkspaceProps> = ({ conversation_id, workspace, eventPrefix = 'acp', backend, dataSource = 'local', readonly = false, workspaceDisplayName: storedDisplayName }) => {
  const { t } = useTranslation();
  const { openPreview } = usePreviewContext();
  const navigate = useNavigate();

  // Remote Moss-session workspaces are rendered readonly (no local FS to
  // edit/rename/delete), but file UPLOAD is supported via the remote upload
  // endpoint. allowUpload re-enables the upload affordances (drag-drop, paste)
  // for that mode while leaving the other readonly restrictions intact.
  const allowUpload = !readonly || dataSource === 'moss-session';

  // Search state
  const [searchText, setSearchText] = useState('');
  const [showSearch, setShowSearch] = useState(true);
  const searchInputRef = useRef<RefInputType | null>(null);

  // Active tab (mockup #293 splits the right panel into 临时空间 / 可用技能)
  // Persist per-workspace choice so agents that rely heavily on one tab don't
  // keep reverting on conversation switch.
  const [activeTab, setActiveTab] = useState<'files' | 'skills'>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.WORKSPACE_ACTIVE_TAB);
      if (stored === 'skills' || stored === 'files') return stored;
    } catch {
      // ignore
    }
    return 'files';
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.WORKSPACE_ACTIVE_TAB, activeTab);
    } catch {
      // ignore
    }
  }, [activeTab]);

  // Skill count for the skills tab pill — scanned from the workspace skill
  // root that belongs to the current conversation backend.
  //
  // IMPORTANT: We filter dirChanged events by the workspace watchId to avoid a
  // feedback loop where scanForSkills file-system reads trigger further
  // dirChanged events, which trigger more scanForSkills calls, causing
  // infinite flickering in non-fullscreen windows.
  //
  // Additionally, we enforce a minimum interval between dirChanged-triggered
  // scans to prevent feedback loops on Windows where file-system reads (stat,
  // readdir) during scanForSkills can spuriously trigger further fs.watch
  // events on the same directory tree.
  //
  // NOTE: `watchIdRef` is defined later (from useWorkspaceEvents) but this is
  // safe because useEffect callbacks run after the entire component body, so
  // watchIdRef is always initialized before the listener fires.
  const [skillCount, setSkillCount] = useState(0);
  const lastSkillScanAtRef = useRef(0);
  useEffect(() => {
    if (!workspace) {
      setSkillCount(0);
      return undefined;
    }
    let cancelled = false;
    const SKILL_SCAN_COOLDOWN_MS = 2000;
    const refreshCount = async () => {
      lastSkillScanAtRef.current = Date.now();
      try {
        if (dataSource === 'moss-session') {
          const result = await ipcBridge.conversation.getRemoteAvailableSkills.invoke({ conversation_id }).catch((): undefined => undefined);
          if (cancelled) return;
          setSkillCount(result?.success ? (result.data?.skills.length ?? 0) : 0);
          return;
        }

        const skillRoot = resolveWorkspaceSkillRoot(workspace, backend);
        const result = await ipcBridge.fs.scanForSkills.invoke({ folderPath: skillRoot.path }).catch((): undefined => undefined);
        if (cancelled) return;
        setSkillCount(result?.success ? result.data.length : 0);
      } catch {
        if (!cancelled) setSkillCount(0);
      }
    };
    void refreshCount();
    if (dataSource === 'moss-session') {
      let refreshTimer: ReturnType<typeof setTimeout> | null = null;
      const scheduleRefresh = (delay = 300) => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          refreshTimer = null;
          void refreshCount();
        }, delay);
      };

      const unsubscribeStream = ipcBridge.conversation.responseStream.on((message) => {
        if (message.conversation_id !== conversation_id) return;

        if (message.type === 'agent_status') {
          const status = (message.data as { status?: string } | undefined)?.status;
          if (status === 'session_active') {
            scheduleRefresh();
          }
          return;
        }

        if (message.type === 'finish') {
          scheduleRefresh(800);
        }
      });

      const unsubscribeConversation = ipcBridge.database.conversationChanged.on((event) => {
        if (event.conversationId === conversation_id && event.action === 'updated') {
          scheduleRefresh();
        }
      });

      const handleWorkspaceRefresh = () => {
        scheduleRefresh();
      };
      emitter.on('remote-agent.workspace.refresh', handleWorkspaceRefresh);

      return () => {
        cancelled = true;
        if (refreshTimer) {
          clearTimeout(refreshTimer);
          refreshTimer = null;
        }
        unsubscribeStream();
        unsubscribeConversation();
        emitter.off('remote-agent.workspace.refresh', handleWorkspaceRefresh);
      };
    }

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = ipcBridge.fileWatch.dirChanged.on((payload) => {
      // Only react to events from our workspace watcher — not all watchers
      // globally. This prevents the scanForSkills → file read → dirChanged
      // feedback loop that caused infinite re-renders.
      if (!watchIdRef.current || payload.watchId !== watchIdRef.current) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        // Skip if a scan ran recently — prevents the scan → dirChanged → scan loop
        if (Date.now() - lastSkillScanAtRef.current < SKILL_SCAN_COOLDOWN_MS) return;
        void refreshCount();
      }, 250);
    });
    return () => {
      cancelled = true;
      if (debounce) clearTimeout(debounce);
      unsubscribe();
    };
  }, [workspace, eventPrefix, backend, conversation_id, dataSource]);

  // Workspace rename modal state (for root directory rename)
  const [wsRenameModal, setWsRenameModal] = useState<{ visible: boolean; name: string }>({ visible: false, name: '' });
  const [wsRenameLoading, setWsRenameLoading] = useState(false);

  // New folder modal state
  const [newFolderModal, setNewFolderModal] = useState<{ visible: boolean; name: string; parentPath: string }>({ visible: false, name: '', parentPath: '' });
  const [newFolderLoading, setNewFolderLoading] = useState(false);

  const handleWorkspaceRenameConfirm = useCallback(async () => {
    const newName = wsRenameModal.name.trim();
    if (!newName) return;
    setWsRenameLoading(true);
    try {
      const result = await ipcBridge.workspaceManage.updateDisplayName.invoke({ workspace, displayName: newName });
      if (result?.success) {
        Message.success(t('conversation.workspace.renameWorkspace.success'));
        setWsRenameModal({ visible: false, name: '' });
        emitter.emit('chat.history.refresh');
      } else {
        Message.error(result?.msg || t('conversation.workspace.renameWorkspace.failed'));
      }
    } catch {
      Message.error(t('conversation.workspace.renameWorkspace.failed'));
    } finally {
      setWsRenameLoading(false);
    }
  }, [wsRenameModal, workspace, t]);

  // Workspace migration modal state
  const [showMigrationModal, setShowMigrationModal] = useState(false);
  const [showDirectorySelector, setShowDirectorySelector] = useState(false);
  const [selectedTargetPath, setSelectedTargetPath] = useState('');
  const [migrationLoading, setMigrationLoading] = useState(false);

  // Bdpan upload state
  const [bdpanUploadPickerVisible, setBdpanUploadPickerVisible] = useState(false);
  const [bdpanUploadLocalPath, setBdpanUploadLocalPath] = useState('');

  // Skills tab refresh handle — lets the shared refresh button in the card
  // header trigger a scan even when the file tree inotify watcher is quiet.
  const skillsHandleRef = useRef<WorkspaceSkillsHandle | null>(null);
  // Skills tab loading state, reported back from WorkspaceSkills so the sync
  // footer can show a blue "正在同步…" ping while scanning.
  const [skillsLoading, setSkillsLoading] = useState(false);
  // Timestamp of the last successful sync (either tree refresh or skills scan).
  // The sync footer renders "上次同步: 刚刚 / X 分钟前 / X 小时前" from this.
  const [lastSyncAt, setLastSyncAt] = useState<number>(() => Date.now());
  // Tick the "last synced" label every 30 seconds so the relative string stays fresh.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Previous loading state — used below (after treeHook is initialised) to
  // bump `lastSyncAt` whenever the tree finishes a refresh cycle.
  const prevTreeLoadingRef = useRef(false);

  // Initialize all hooks
  const treeHook = useWorkspaceTree({ workspace, conversation_id, eventPrefix, backend, dataSource });
  const modalsHook = useWorkspaceModals();

  // Bump `lastSyncAt` whenever the file tree just finished loading
  // (transitions from loading=true → false). This drives the sync footer.
  useEffect(() => {
    if (prevTreeLoadingRef.current && !treeHook.loading) {
      setLastSyncAt(Date.now());
    }
    prevTreeLoadingRef.current = treeHook.loading;
  }, [treeHook.loading]);
  const pasteHook = useWorkspacePaste({
    workspace,
    t,
    conversation_id,
    dataSource,
    files: treeHook.files,
    selected: treeHook.selected,
    selectedNodeRef: treeHook.selectedNodeRef,
    refreshWorkspace: treeHook.refreshWorkspace,
    pasteConfirm: modalsHook.pasteConfirm,
    setPasteConfirm: modalsHook.setPasteConfirm,
    closePasteConfirm: modalsHook.closePasteConfirm,
  });

  const dragImportHook = useWorkspaceDragImport({
    t,
    onFilesDropped: pasteHook.handleFilesToAdd,
  });

  // New folder creation handler
  const handleNewFolderConfirm = useCallback(async () => {
    const folderName = newFolderModal.name.trim();
    if (!folderName) return;

    // Validate folder name characters
    // eslint-disable-next-line no-control-regex
    const invalidCharsRegex = /[<>:"/\\|?*\x00-\x1f]/;
    if (invalidCharsRegex.test(folderName)) {
      Message.error(t('conversation.workspace.newFolder.invalidName'));
      return;
    }
    if (folderName === '.' || folderName === '..') {
      Message.error(t('conversation.workspace.newFolder.invalidName'));
      return;
    }
    // Prevent creating folders that conflict with the reserved drafts directory.
    if (isReservedDraftsDirName(folderName)) {
      Message.error(t('conversation.workspace.newFolder.reservedName'));
      return;
    }

    setNewFolderLoading(true);
    try {
      const targetPath = newFolderModal.parentPath ? `${newFolderModal.parentPath}/${folderName}` : `${workspace}/${folderName}`;
      const result = await ipcBridge.fs.createDir.invoke({ path: targetPath });
      if (result) {
        Message.success(t('conversation.workspace.newFolder.success'));
        setNewFolderModal({ visible: false, name: '', parentPath: '' });
        void treeHook.refreshWorkspace();
      } else {
        Message.error(t('conversation.workspace.newFolder.failed'));
      }
    } catch {
      Message.error(t('conversation.workspace.newFolder.failed'));
    } finally {
      setNewFolderLoading(false);
    }
  }, [newFolderModal, workspace, t, treeHook.refreshWorkspace]);

  // Open new folder modal for a given parent directory
  const openNewFolderModal = useCallback(
    (parentNode?: IDirOrFile) => {
      const parentPath = parentNode?.fullPath ?? workspace;
      setNewFolderModal({ visible: true, name: '', parentPath });
      modalsHook.closeContextMenu();
    },
    [workspace, modalsHook.closeContextMenu]
  );

  // 只在用户主动打开搜索时聚焦，不在会话切换时自动聚焦
  // Only focus search input when user actively opens search, not on conversation switch
  const previousShowSearchRef = useRef<boolean | null>(null);
  useEffect(() => {
    // 首次渲染或会话切换时不聚焦
    if (previousShowSearchRef.current === null) {
      previousShowSearchRef.current = showSearch;
      return;
    }

    // 只在从 false 变为 true 时聚焦（用户主动打开搜索）
    if (showSearch && !previousShowSearchRef.current) {
      const timer = window.setTimeout(() => {
        searchInputRef.current?.focus?.();
      }, 0);
      previousShowSearchRef.current = showSearch;
      return () => {
        window.clearTimeout(timer);
      };
    }

    previousShowSearchRef.current = showSearch;
  }, [showSearch]);

  const fileOpsHook = useWorkspaceFileOps({
    workspace,
    eventPrefix,
    conversation_id: eventPrefix === 'remote-agent' ? conversation_id : undefined,
    dataSource,
    readonly,
    t,
    setFiles: treeHook.setFiles,
    setSelected: treeHook.setSelected,
    setExpandedKeys: treeHook.setExpandedKeys,
    selectedKeysRef: treeHook.selectedKeysRef,
    selectedNodeRef: treeHook.selectedNodeRef,
    ensureNodeSelected: treeHook.ensureNodeSelected,
    refreshWorkspace: treeHook.refreshWorkspace,
    renameModal: modalsHook.renameModal,
    deleteModal: modalsHook.deleteModal,
    renameLoading: modalsHook.renameLoading,
    setRenameLoading: modalsHook.setRenameLoading,
    closeRenameModal: modalsHook.closeRenameModal,
    closeDeleteModal: modalsHook.closeDeleteModal,
    closeContextMenu: modalsHook.closeContextMenu,
    setRenameModal: modalsHook.setRenameModal,
    setDeleteModal: modalsHook.setDeleteModal,
    openPreview,
  });

  // Setup events — capture the watchIdRef so the skillCount effect below can
  // filter dirChanged events to only the workspace watcher, preventing a
  // global feedback loop (scanForSkills → file reads → dirChanged → repeat).
  const { watchIdRef } = useWorkspaceEvents({
    conversation_id,
    eventPrefix,
    workspace,
    refreshWorkspace: treeHook.refreshWorkspace,
    clearSelection: treeHook.clearSelection,
    setFiles: treeHook.setFiles,
    setSelected: treeHook.setSelected,
    setExpandedKeys: treeHook.setExpandedKeys,
    setTreeKey: treeHook.setTreeKey,
    selectedNodeRef: treeHook.selectedNodeRef,
    selectedKeysRef: treeHook.selectedKeysRef,
    closeContextMenu: modalsHook.closeContextMenu,
    setContextMenu: modalsHook.setContextMenu,
    closeRenameModal: modalsHook.closeRenameModal,
    closeDeleteModal: modalsHook.closeDeleteModal,
    readonly,
    dataSource,
  });

  // Debounced search handler
  const onSearch = useDebounce(
    (value: string) => {
      void treeHook.loadWorkspace(workspace, value).then((files) => {
        setShowSearch(files.length > 0 && files[0]?.children?.length > 0);
      });
    },
    200,
    [workspace, treeHook.loadWorkspace]
  );

  // Context menu calculations
  const hasOriginalFiles = treeHook.files.length > 0 && treeHook.files[0]?.children?.length > 0;
  const rootName = treeHook.files[0]?.name ?? '';
  // Check if this is a temporary workspace (check both path and root folder name)
  const isTemporaryWorkspace = checkIsTemporaryWorkspace(workspace) || checkIsTemporaryWorkspace(rootName);
  const isChannelWorkspace = checkIsChannelWorkspace(workspace) || checkIsChannelWorkspace(rootName);

  // 当只有一个根目录且有子文件时，隐藏根目录直接展示子文件，因为 Toolbar 已经作为一级目录
  // Hide root directory when there's a single root with children, as Toolbar serves as the first-level directory
  const rawTreeData = treeHook.files.length === 1 && (treeHook.files[0]?.children?.length ?? 0) > 0 ? (treeHook.files[0]?.children ?? []) : treeHook.files;
  const visibleTreeData = useMemo(() => {
    let data = rawTreeData;

    if (isTemporaryWorkspace || isChannelWorkspace || dataSource === 'moss-session') {
      const filterNodes = (nodes: IDirOrFile[]): IDirOrFile[] =>
        nodes
          .filter((node) => !isHiddenWorkspaceEntry(node.name))
          .map((node) => ({
            ...node,
            children: node.children ? filterNodes(node.children) : node.children,
          }));

      data = filterNodes(data);
    }

    // 按文件名正序排列（文件夹优先）/ Sort by filename ascending (directories first)
    return sortTreeNodes(data);
  }, [isTemporaryWorkspace, isChannelWorkspace, rawTreeData, dataSource]);

  const treeData = useMemo(() => {
    const decorateNodes = (nodes: IDirOrFile[]): IDirOrFile[] =>
      nodes.map((node) => {
        if (node.isFile) {
          const fileIcon = resolveWorkspaceFileIcon(node.name);
          return {
            ...node,
            icon: fileIcon,
            icons: {
              switcherIcon: <span className='workspace-tree__switcher-spacer' aria-hidden='true' />,
            },
            children: node.children ? decorateNodes(node.children) : node.children,
          };
        }

        return {
          ...node,
          icon: <FolderOpen theme='outline' size='16' fill={WORKSPACE_FOLDER_ICON_COLOR} />,
          icons: {
            switcherIcon: <DownSmall theme='outline' size='14' fill='var(--color-text-3)' />,
          },
          children: node.children ? decorateNodes(node.children) : node.children,
        };
      });

    const result = decorateNodes(visibleTreeData);
    return result;
  }, [visibleTreeData]);

  // Get workspace display name - prefer stored display name, fallback to path-derived name
  const workspaceDisplayName = useMemo(() => {
    if (storedDisplayName) {
      return storedDisplayName;
    }
    if (isTemporaryWorkspace || dataSource === 'moss-session') {
      return t('conversation.workspace.temporarySpace');
    }
    return getDisplayName(workspace);
  }, [storedDisplayName, workspace, isTemporaryWorkspace, dataSource, t]);

  // Workspace migration handlers
  // const handleOpenMigrationModal = useCallback(() => {
  //   setShowMigrationModal(true);
  // }, []);

  // Handle directory selection from DirectorySelectionModal (webui)
  const handleSelectDirectoryFromModal = useCallback((paths: string[] | undefined) => {
    setShowDirectorySelector(false);
    if (paths && paths.length > 0) {
      setSelectedTargetPath(paths[0]);
    }
  }, []);

  // Handle folder selection - use native dialog on Electron, modal on webui
  const handleSelectFolder = useCallback(async () => {
    if (isElectronDesktop()) {
      // Electron: use native file dialog
      try {
        const res = await ipcBridge.dialog.showOpen.invoke({ properties: ['openDirectory'] });
        if (res?.success && res.data && !res.data.canceled && res.data.filePaths.length > 0) {
          setSelectedTargetPath(res.data.filePaths[0]);
        }
      } catch (error) {
        console.error('Failed to open directory dialog:', error);
        Message.error(t('conversation.workspace.migration.selectFolderError'));
      }
    } else {
      // WebUI: show directory selection modal
      setShowDirectorySelector(true);
    }
  }, [t]);

  const handleMigrationConfirm = useCallback(async () => {
    if (!isTemporaryWorkspace) {
      Message.error(t('conversation.workspace.migration.error'));
      return;
    }

    const targetWorkspace = selectedTargetPath.trim();
    if (!targetWorkspace) {
      Message.error(t('conversation.workspace.migration.noTargetPath'));
      return;
    }

    if (targetWorkspace === workspace) {
      Message.warning(t('conversation.workspace.migration.selectFolderError'));
      return;
    }

    setMigrationLoading(true);

    try {
      // Get current conversation data
      const conversations = await ipcBridge.database.getUserConversations.invoke({ page: 0, pageSize: 10000 });
      const currentConversation = conversations?.find((conv) => conv.id === conversation_id);

      if (!currentConversation) {
        throw new Error('Current conversation not found');
      }

      // Get all files from the workspace
      const workspaceFiles = await ipcBridge.conversation.getWorkspace.invoke({
        conversation_id,
        workspace,
        path: workspace,
      });

      // Recursively collect all file paths
      const collectFilePaths = (items: IDirOrFile[]): string[] => {
        const paths: string[] = [];
        for (const item of items) {
          if (item.isFile && item.fullPath) {
            paths.push(item.fullPath);
          }
          if (item.children && item.children.length > 0) {
            paths.push(...collectFilePaths(item.children));
          }
        }
        return paths;
      };

      const filePaths = collectFilePaths(workspaceFiles);

      // Copy all files to the target workspace / 复制所有文件到目标工作区
      if (filePaths.length > 0) {
        const copyResult = await ipcBridge.fs.copyFilesToWorkspace.invoke({
          filePaths,
          workspace: targetWorkspace,
          sourceRoot: workspace,
        });
        if (!copyResult?.success) {
          throw new Error(copyResult?.msg || 'Failed to copy workspace files');
        }
      }

      // Create new conversation with the new workspace / 使用新工作区创建会话
      const newId = uuid();
      const newConversation = {
        ...currentConversation,
        id: newId,
        name: currentConversation.name,
        createTime: Date.now(),
        modifyTime: Date.now(),
      };

      // Update the workspace in extra field / 更新 extra 中的 workspace 信息
      newConversation.extra = {
        ...(currentConversation.extra ?? {}),
        workspace: targetWorkspace,
        customWorkspace: true,
      };

      await ipcBridge.conversation.createWithConversation.invoke({
        conversation: newConversation,
        sourceConversationId: conversation_id, // Pass source ID to migrate chat history / 传递源会话 ID 以迁移聊天记录
      });

      // Close modal and reset state / 关闭弹窗并重置状态
      setShowMigrationModal(false);
      setSelectedTargetPath('');
      setMigrationLoading(false);

      // Navigate to new conversation / 跳转到新的会话
      void navigate(`/conversation/${newId}`);
      emitter.emit('chat.history.refresh');
      Message.success(t('conversation.workspace.migration.success'));
    } catch (error) {
      console.error('Failed to migrate workspace:', error);
      Message.error(t('conversation.workspace.migration.error'));
      setMigrationLoading(false);
    }
  }, [selectedTargetPath, conversation_id, workspace, t, navigate]);

  const handleCloseMigrationModal = useCallback(() => {
    if (!migrationLoading) {
      setShowMigrationModal(false);
      setSelectedTargetPath('');
    }
  }, [migrationLoading]);

  const showBdpanUploadPicker = useCallback(
    (node: IDirOrFile) => {
      const localPath = node.fullPath ?? '';
      if (!localPath) return;
      setBdpanUploadLocalPath(localPath);
      setBdpanUploadPickerVisible(true);
      modalsHook.closeContextMenu();
    },
    [modalsHook.closeContextMenu]
  );

  const handleBdpanUploadConfirm = useCallback(
    async (bdpanDirPath: string) => {
      setBdpanUploadPickerVisible(false);
      const localPath = bdpanUploadLocalPath;
      try {
        const localName = localPath.split('/').filter(Boolean).pop() ?? '';
        const remotePath = bdpanDirPath.endsWith('/') ? `${bdpanDirPath}${localName}` : `${bdpanDirPath}/${localName}`;
        const res = await ipcBridge.bdpan.upload.invoke({ localPath, remotePath });
        if (res?.success) {
          Message.success(t('conversation.bdpan.upload.success'));
        } else {
          Message.error(res?.data?.error ?? t('conversation.bdpan.upload.failed'));
        }
      } catch (err) {
        Message.error(String(err));
      }
    },
    [bdpanUploadLocalPath, t]
  );

  let contextMenuStyle: React.CSSProperties | undefined;
  if (modalsHook.contextMenu.visible) {
    let x = modalsHook.contextMenu.x;
    let y = modalsHook.contextMenu.y;
    if (typeof window !== 'undefined') {
      x = Math.min(x, window.innerWidth - 220);
      y = Math.min(y, window.innerHeight - 220);
    }
    contextMenuStyle = { top: y, left: x };
  }

  const contextMenuNode = modalsHook.contextMenu.node;
  const isContextMenuNodeFile = !!contextMenuNode?.isFile;
  const isContextMenuNodeRoot = !!contextMenuNode && (!contextMenuNode.relativePath || contextMenuNode.relativePath === '');
  // Drafts directory (.drafts/) should not be renameable or deleteable
  // 草稿箱目录不支持重命名和删除
  const isContextMenuNodeDrafts = !!contextMenuNode && contextMenuNode.name === DRAFTS_DIR_NAME && !contextMenuNode.isFile;

  // ShareOne CLI installation state
  const [shareoneInstalled, setShareoneInstalled] = useState(false);

  useEffect(() => {
    void ipcBridge.shareoneCli.checkInstalled.invoke().then((res) => {
      if (res?.success && res.data?.installed) {
        setShareoneInstalled(true);
      }
    });
    const unsub = ipcBridge.shareoneCli.installResult.on(() => {
      void ipcBridge.shareoneCli.checkInstalled.invoke().then((res) => {
        setShareoneInstalled(res?.success === true && res.data?.installed === true);
      });
    });
    return unsub;
  }, []);

  const handleShareFile = useCallback(
    async (node: IDirOrFile) => {
      if (!node.fullPath || !node.isFile) return;
      const notifyId = showShareLoading();
      try {
        const res = await ipcBridge.shareoneCli.publishFile.invoke({ filePath: node.fullPath });
        if (res?.success && res.data) {
          updateShareSuccess(notifyId, res.data.url);
        } else if (res?.code === 'AUTH_FAILED') {
          updateShareError(notifyId, res.msg || t('messages.shareAuthRequired'));
        } else {
          updateShareError(notifyId, res?.msg || t('messages.shareFailed', { msg: '' }));
        }
      } catch (err) {
        updateShareError(notifyId, String(err));
      }
    },
    [t]
  );

  // Check if file supports preview
  const isPreviewSupported = (() => {
    if (!contextMenuNode?.isFile || !contextMenuNode.name) return false;
    const ext = contextMenuNode.name.toLowerCase().split('.').pop() || '';
    const supportedExts = [
      // Markdown formats
      'md',
      'markdown',
      // Diff formats
      'diff',
      'patch',
      // PDF format
      'pdf',
      // PPT formats
      'ppt',
      'pptx',
      'odp',
      // Word formats
      'doc',
      'docx',
      'odt',
      // Excel formats
      'xls',
      'xlsx',
      'ods',
      'csv',
      // HTML formats
      'html',
      'htm',
      // Code formats
      'js',
      'ts',
      'tsx',
      'jsx',
      'py',
      'java',
      'go',
      'rs',
      'c',
      'cpp',
      'h',
      'hpp',
      'css',
      'scss',
      'json',
      'xml',
      'yaml',
      'yml',
      // Image formats
      'png',
      'jpg',
      'jpeg',
      'gif',
      'bmp',
      'webp',
      'svg',
      'ico',
      'tif',
      'tiff',
      'avif',
      // Video formats
      'mp4',
      'webm',
      'mov',
      'm4v',
      'ogv',
      'ogg',
      'avi',
      'mkv',
      'wmv',
      'flv',
    ];
    return supportedExts.includes(ext);
  })();

  // Check if file supports ShareOne sharing
  const isShareoneSupported = (() => {
    if (!contextMenuNode?.isFile || !contextMenuNode.name) return false;
    const ext = contextMenuNode.name.toLowerCase().split('.').pop() || '';
    const shareoneSupportedExts = [
      // HTML formats
      'html',
      'htm',
      // Markdown formats
      'md',
      'markdown',
      // PDF format
      'pdf',
      // Word formats
      'doc',
      'docx',
      'odt',
      // PPT formats
      'ppt',
      'pptx',
      'odp',
    ];
    return shareoneSupportedExts.includes(ext);
  })();

  const menuButtonBase = 'w-full flex items-center gap-8px px-14px py-6px text-13px text-left text-foreground rounded-md transition-colors duration-150 hover:bg-2 border-none bg-transparent appearance-none focus:outline-none focus-visible:outline-none';
  const openNodeContextMenu = useCallback(
    (node: IDirOrFile, x: number, y: number) => {
      treeHook.ensureNodeSelected(node);
      modalsHook.setContextMenu({
        visible: true,
        x,
        y,
        node,
      });
    },
    [treeHook.ensureNodeSelected, modalsHook.setContextMenu]
  );

  // NOTE: Capture-phase listener removed - Arco Design Tree doesn't use data-key attribute.
  // The onContextMenu handler on the renderTitle div handles context menu correctly.

  // Get target folder path for paste confirm modal
  const targetFolderPathForModal = getTargetFolderPath(treeHook.selectedNodeRef.current, treeHook.selected, treeHook.files, workspace);

  return (
    <>
      <div
        className='chat-workspace workspace-card size-full flex flex-col relative'
        tabIndex={0}
        onFocus={!allowUpload ? undefined : pasteHook.onFocusPaste}
        onClick={!allowUpload ? undefined : pasteHook.onFocusPaste}
        {...(!allowUpload ? {} : dragImportHook.dragHandlers)}
        style={
          allowUpload && dragImportHook.isDragging
            ? {
                border: '1px dashed rgb(var(--primary-6))',
                borderRadius: '18px',
                backgroundColor: 'rgba(var(--primary-1), 0.25)',
                transition: 'all 0.2s ease',
              }
            : undefined
        }
      >
        {allowUpload && dragImportHook.isDragging && (
          <div className='absolute inset-0 pointer-events-none z-30 flex items-center justify-center px-32px'>
            <div
              className='w-full max-w-480px text-center text-white rounded-16px px-32px py-28px'
              style={{
                background: 'rgba(6, 11, 25, 0.85)',
                border: '1px dashed rgb(var(--primary-6))',
                boxShadow: '0 20px 60px rgba(15, 23, 42, 0.45)',
              }}
            >
              <div className='text-18px font-semibold mb-8px'>
                {t('conversation.workspace.dragOverlayTitle', {
                  defaultValue: 'Drop to import',
                })}
              </div>
              <div className='text-14px opacity-90 mb-4px'>
                {t('conversation.workspace.dragOverlayDesc', {
                  defaultValue: 'Drag files or folders here to copy them into this workspace.',
                })}
              </div>
              <div className='text-12px opacity-70'>
                {t('conversation.workspace.dragOverlayHint', {
                  defaultValue: 'Tip: drop anywhere to import into the selected folder.',
                })}
              </div>
            </div>
          </div>
        )}
        {/* Paste Confirm Modal */}
        {allowUpload && (
          <Modal
            visible={modalsHook.pasteConfirm.visible}
            title={null}
            onCancel={() => {
              modalsHook.closePasteConfirm();
            }}
            footer={null}
            style={{ borderRadius: '12px' }}
            className='paste-confirm-modal'
            alignCenter
            getPopupContainer={() => document.body}
          >
            <div className='px-24px py-20px'>
              {/* Title area */}
              <div className='flex items-center gap-12px mb-20px'>
                <div className='flex items-center justify-center w-48px h-48px rounded-full' style={{ backgroundColor: 'rgb(var(--primary-1))' }}>
                  <FileText theme='outline' size='24' fill='rgb(var(--primary-6))' />
                </div>
                <div>
                  <div className='text-16px font-semibold mb-4px'>{t('conversation.workspace.pasteConfirm_title')}</div>
                  <div className='text-13px' style={{ color: 'var(--color-text-3)' }}>
                    {modalsHook.pasteConfirm.filesToPaste.length > 1 ? t('conversation.workspace.pasteConfirm_multipleFiles', { count: modalsHook.pasteConfirm.filesToPaste.length }) : t('conversation.workspace.pasteConfirm_title')}
                  </div>
                </div>
              </div>

              {/* Content area */}
              <div className='mb-20px px-12px py-16px rounded-8px' style={{ backgroundColor: 'var(--color-fill-2)' }}>
                <div className='flex items-start gap-12px mb-12px'>
                  <FileText theme='outline' size='18' fill='var(--color-text-2)' style={{ marginTop: '2px' }} />
                  <div className='flex-1'>
                    <div className='text-13px mb-4px' style={{ color: 'var(--color-text-3)' }}>
                      {t('conversation.workspace.pasteConfirm_fileName')}
                    </div>
                    <div className='text-14px font-medium break-all' style={{ color: 'var(--color-text-1)' }}>
                      {modalsHook.pasteConfirm.fileName}
                    </div>
                  </div>
                </div>
                <div className='flex items-start gap-12px'>
                  <FolderOpen theme='outline' size='18' fill='var(--color-text-2)' style={{ marginTop: '2px' }} />
                  <div className='flex-1'>
                    <div className='text-13px mb-4px' style={{ color: 'var(--color-text-3)' }}>
                      {t('conversation.workspace.pasteConfirm_targetFolder')}
                    </div>
                    <div className='text-14px font-medium font-mono break-all' style={{ color: 'rgb(var(--primary-6))' }}>
                      {targetFolderPathForModal.fullPath}
                    </div>
                  </div>
                </div>
              </div>

              {/* Checkbox area */}
              <div className='mb-20px'>
                <Checkbox checked={modalsHook.pasteConfirm.doNotAsk} onChange={(v) => modalsHook.setPasteConfirm((prev) => ({ ...prev, doNotAsk: v }))}>
                  <span className='text-13px' style={{ color: 'var(--color-text-2)' }}>
                    {t('conversation.workspace.pasteConfirm_noAsk')}
                  </span>
                </Checkbox>
              </div>

              {/* Button area */}
              <div className='flex gap-12px justify-end'>
                <button
                  className='px-16px py-8px rounded-6px text-14px font-medium transition-all'
                  style={{
                    border: '1px solid var(--color-border-2)',
                    backgroundColor: 'transparent',
                    color: 'var(--color-text-1)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--color-fill-2)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                  onClick={() => {
                    modalsHook.closePasteConfirm();
                  }}
                >
                  {t('conversation.workspace.pasteConfirm_cancel')}
                </button>
                <button
                  className='px-16px py-8px rounded-6px text-14px font-medium transition-all'
                  style={{
                    border: 'none',
                    backgroundColor: 'rgb(var(--primary-6))',
                    color: 'white',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgb(var(--primary-5))';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgb(var(--primary-6))';
                  }}
                  onClick={async () => {
                    await pasteHook.handlePasteConfirm();
                  }}
                >
                  {t('conversation.workspace.pasteConfirm_paste')}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* Rename Modal */}
        {!readonly && (
          <Modal
            visible={modalsHook.renameModal.visible}
            title={t('conversation.workspace.contextMenu.renameTitle')}
            onCancel={modalsHook.closeRenameModal}
            onOk={fileOpsHook.handleRenameConfirm}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
            confirmLoading={modalsHook.renameLoading}
            style={{ borderRadius: '12px' }}
            alignCenter
            getPopupContainer={() => document.body}
          >
            <Input autoFocus value={modalsHook.renameModal.value} onChange={(value) => modalsHook.setRenameModal((prev) => ({ ...prev, value }))} onPressEnter={fileOpsHook.handleRenameConfirm} placeholder={t('conversation.workspace.contextMenu.renamePlaceholder')} />
          </Modal>
        )}

        {/* Workspace Rename Modal (root directory) */}
        {!readonly && (
          <Modal
            title={t('conversation.workspace.renameWorkspace.title')}
            visible={wsRenameModal.visible}
            onOk={handleWorkspaceRenameConfirm}
            onCancel={() => setWsRenameModal({ visible: false, name: '' })}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
            confirmLoading={wsRenameLoading}
            okButtonProps={{ disabled: !wsRenameModal.name.trim() }}
            style={{ borderRadius: '12px' }}
            alignCenter
            getPopupContainer={() => document.body}
          >
            <div className='text-13px text-secondary mb-8px'>{t('conversation.workspace.renameWorkspace.hint')}</div>
            <Input autoFocus value={wsRenameModal.name} onChange={(v) => setWsRenameModal((prev) => ({ ...prev, name: v }))} onPressEnter={handleWorkspaceRenameConfirm} placeholder={t('conversation.workspace.renameWorkspace.placeholder')} />
          </Modal>
        )}

        {/* New Folder Modal */}
        {!readonly && (
          <Modal
            title={t('conversation.workspace.newFolder.title')}
            visible={newFolderModal.visible}
            onOk={handleNewFolderConfirm}
            onCancel={() => setNewFolderModal({ visible: false, name: '', parentPath: '' })}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
            confirmLoading={newFolderLoading}
            okButtonProps={{ disabled: !newFolderModal.name.trim() }}
            style={{ borderRadius: '12px' }}
            alignCenter
            getPopupContainer={() => document.body}
          >
            <div className='text-13px text-secondary mb-8px'>{t('conversation.workspace.newFolder.hint')}</div>
            <Input autoFocus value={newFolderModal.name} onChange={(v) => setNewFolderModal((prev) => ({ ...prev, name: v }))} onPressEnter={handleNewFolderConfirm} placeholder={t('conversation.workspace.newFolder.placeholder')} />
          </Modal>
        )}

        {/* Delete Modal */}
        {!readonly && (
          <Modal
            visible={modalsHook.deleteModal.visible}
            title={t('conversation.workspace.contextMenu.deleteTitle')}
            onCancel={modalsHook.closeDeleteModal}
            onOk={fileOpsHook.handleDeleteConfirm}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
            confirmLoading={modalsHook.deleteModal.loading}
            style={{ borderRadius: '12px' }}
            alignCenter
            getPopupContainer={() => document.body}
          >
            <div className='text-14px text-secondary'>{t('conversation.workspace.contextMenu.deleteConfirm')}</div>
          </Modal>
        )}

        {/* Workspace Migration Modal */}
        {!readonly && (
          <Modal visible={showMigrationModal} title={t('conversation.workspace.migration.title')} onCancel={handleCloseMigrationModal} footer={null} style={{ borderRadius: '12px' }} className='workspace-migration-modal' alignCenter getPopupContainer={() => document.body}>
            <div className='py-8px'>
              {/* Current workspace info */}
              <div className='text-14px mb-16px' style={{ color: 'var(--color-text-3)' }}>
                {t('conversation.workspace.migration.currentWorkspaceLabel')}
                <span className='font-mono'>/{getLastDirectoryName(workspace)}</span>
              </div>

              {/* Target folder selection card */}
              <div className='mb-16px p-16px rounded-12px' style={{ backgroundColor: 'var(--color-fill-1)' }}>
                <div className='text-14px mb-8px' style={{ color: 'var(--color-text-1)' }}>
                  {t('conversation.workspace.migration.moveToNewFolder')}
                </div>
                <div
                  className='flex items-center justify-between px-12px py-10px rounded-8px cursor-pointer transition-colors hover:bg-fill-2'
                  style={{
                    backgroundColor: 'var(--color-bg-1)',
                    border: '1px solid var(--color-border-2)',
                  }}
                  onClick={handleSelectFolder}
                >
                  <span className='text-14px' style={{ color: selectedTargetPath ? 'var(--color-text-1)' : 'var(--color-text-3)' }}>
                    {selectedTargetPath || t('conversation.workspace.migration.selectFolder')}
                  </span>
                  <FolderOpen theme='outline' size='18' fill='var(--color-text-3)' />
                </div>
              </div>

              {/* Hint */}
              <div className='flex items-center gap-8px mb-20px text-14px' style={{ color: 'var(--color-text-3)' }}>
                <span>💡</span>
                <span>{t('conversation.workspace.migration.hint')}</span>
              </div>

              {/* Button area */}
              <div className='flex gap-12px justify-end'>
                <button
                  className='px-24px py-8px rounded-20px text-14px font-medium transition-all'
                  style={{
                    border: '1px solid var(--color-border-2)',
                    backgroundColor: 'var(--color-fill-2)',
                    color: 'var(--color-text-1)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--color-fill-3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--color-fill-2)';
                  }}
                  onClick={handleCloseMigrationModal}
                  disabled={migrationLoading}
                >
                  {t('common.cancel')}
                </button>
                <button
                  className='px-24px py-8px rounded-20px text-14px font-medium transition-all'
                  style={{
                    border: 'none',
                    backgroundColor: migrationLoading ? 'var(--color-fill-3)' : 'var(--color-text-1)',
                    color: 'var(--color-bg-1)',
                    cursor: migrationLoading ? 'not-allowed' : 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    if (!migrationLoading) {
                      e.currentTarget.style.opacity = '0.85';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!migrationLoading) {
                      e.currentTarget.style.opacity = '1';
                    }
                  }}
                  onClick={handleMigrationConfirm}
                  disabled={migrationLoading || !selectedTargetPath}
                >
                  {migrationLoading ? t('conversation.workspace.migration.migrating') : t('common.confirm')}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* Directory Selection Modal (for WebUI only) */}
        {!readonly && <DirectorySelectionModal visible={showDirectorySelector} onConfirm={handleSelectDirectoryFromModal} onCancel={() => setShowDirectorySelector(false)} />}

        {/* Bdpan Upload Dir Picker */}
        {!readonly && <BdpanUploadDirPicker visible={bdpanUploadPickerVisible} localPath={bdpanUploadLocalPath} onCancel={() => setBdpanUploadPickerVisible(false)} onConfirm={handleBdpanUploadConfirm} />}

        {/* Tabs header — mirrors ui.zip `components/task-panel.tsx` layout:
            two equal tabs sit at the very top of the card (no separate status-
            dot header anymore). Active tab gets a 2px primary underline and
            a light primary tint, matching the reference. */}
        <div
          className='workspace-card__tabs'
          role='tablist'
          aria-label={t('conversation.workspace.tabsAria', { defaultValue: '工作空间视图切换' })}
          onContextMenu={(event) => {
            if (readonly) return;
            // Preserve the "right-click on workspace header to get root-level
            // context menu" behaviour from the previous header.
            const rootNode = treeHook.files[0];
            if (!rootNode) return;
            event.preventDefault();
            event.stopPropagation();
            openNodeContextMenu(rootNode, event.clientX, event.clientY);
          }}
        >
          <button type='button' role='tab' aria-selected={activeTab === 'files'} className={`workspace-card__tab ${activeTab === 'files' ? 'workspace-card__tab--active' : ''}`} onClick={() => setActiveTab('files')} title={workspace}>
            <Cloudy theme='outline' size='14' fill={activeTab === 'files' ? 'rgb(var(--primary-6))' : 'var(--text-secondary)'} />
            <span className='workspace-card__tab-label'>{t('conversation.workspace.tabFiles', { defaultValue: '临时空间' })}</span>
            {/* File count badge intentionally omitted per product feedback (#294): 后面的数量不要了吧，不要去统计. */}
          </button>
          <button type='button' role='tab' aria-selected={activeTab === 'skills'} className={`workspace-card__tab ${activeTab === 'skills' ? 'workspace-card__tab--active' : ''}`} onClick={() => setActiveTab('skills')}>
            <Magic theme='outline' size='14' fill={activeTab === 'skills' ? 'rgb(var(--primary-6))' : 'var(--text-secondary)'} />
            <span className='workspace-card__tab-label'>{t('conversation.workspace.tabSkills', { defaultValue: '可用技能' })}</span>
            {skillCount > 0 && (
              <span className={`workspace-card__count ${activeTab === 'skills' ? 'workspace-card__count--active' : ''}`} aria-hidden='true'>
                {skillCount}
              </span>
            )}
          </button>
        </div>

        {/* Shared Search + Refresh row — both tabs share the same toolbar. */}
        <div className='workspace-card__toolbar'>
          <Input
            className='w-full workspace-search-input'
            ref={searchInputRef}
            placeholder={activeTab === 'files' ? t('conversation.workspace.searchPlaceholder') : t('conversation.workspace.skillsSearchPlaceholder', { defaultValue: '搜索技能...' })}
            value={searchText}
            onChange={(value) => {
              setSearchText(value);
              if (activeTab === 'files') {
                onSearch(value);
              }
            }}
            allowClear
            prefix={<Search theme='outline' size='14' fill={'var(--text-secondary)'} />}
          />
          <Tooltip content={t('conversation.workspace.refresh')}>
            <button
              type='button'
              className={`workspace-card__refresh-btn ${(activeTab === 'files' ? treeHook.loading : skillsLoading) ? 'workspace-card__refresh-btn--spinning' : ''}`}
              aria-label={t('conversation.workspace.refresh')}
              onClick={(event) => {
                event.stopPropagation();
                if (activeTab === 'files') {
                  void treeHook.refreshWorkspace();
                } else {
                  void skillsHandleRef.current?.refresh();
                }
              }}
            >
              <Refresh theme='outline' size='14' fill={'var(--text-secondary)'} />
            </button>
          </Tooltip>
        </div>

        {/* Main content area — Skills grid OR Search + Tree. */}
        {activeTab === 'skills' && (
          <FlexFullContainer containerClassName='workspace-card__body workspace-card__body--skills overflow-y-auto'>
            <WorkspaceSkills
              ref={skillsHandleRef}
              workspace={workspace}
              eventPrefix={eventPrefix}
              backend={backend}
              conversationId={conversation_id}
              dataSource={dataSource === 'moss-session' ? 'moss-session' : 'workspace'}
              searchQuery={searchText}
              onLoadingChange={setSkillsLoading}
              onSynced={() => setLastSyncAt(Date.now())}
              onCountChange={setSkillCount}
              watchIdRef={watchIdRef}
            />
          </FlexFullContainer>
        )}

        {activeTab === 'files' && (
          <FlexFullContainer containerClassName='workspace-card__body overflow-y-auto'>
            {/* TaskPanel temporarily hidden per product feedback — can restore later.
             * <TaskPanel workspaceFiles={treeHook.files} workspace={workspace} />
             */}

            {/* Empty state or Tree */}
            {!hasOriginalFiles ? (
              <EmptyState
                icon={<FolderOpen theme='outline' size='48' fill='var(--color-text-3)' />}
                title={searchText ? t('conversation.workspace.search.empty') : readonly ? t('conversation.workspace.remotePendingTitle', { defaultValue: '会话开始后显示临时空间' }) : t('conversation.workspace.empty')}
                description={!searchText ? (readonly ? t('conversation.workspace.remotePendingDescription', { defaultValue: '首次消息创建会话后，将从 Moss Server 加载临时空间和草稿箱。' }) : t('conversation.workspace.emptyDescription')) : undefined}
                actions={
                  !searchText && !readonly
                    ? [
                        {
                          label: t('conversation.welcome.linkFolder'),
                          onClick: () => {
                            setShowDirectorySelector(true);
                          },
                          type: 'primary',
                        },
                      ]
                    : undefined
                }
                simple
              />
            ) : (
              <Tree
                className='!pl-32px !pr-16px workspace-tree'
                showLine
                key={treeHook.treeKey}
                selectedKeys={treeHook.selected}
                expandedKeys={treeHook.expandedKeys}
                treeData={treeData}
                fieldNames={{
                  children: 'children',
                  title: 'name',
                  key: 'relativePath',
                  isLeaf: 'isFile',
                }}
                multiple
                renderTitle={(node) => {
                  const relativePath = node.dataRef.relativePath;
                  const isFile = node.dataRef.isFile;
                  const isPasteTarget = allowUpload && !isFile && pasteHook.pasteTargetFolder === relativePath;
                  const nodeData = node.dataRef as IDirOrFile;
                  const directFileCount = !isFile ? (nodeData.children ?? []).filter((child) => child.isFile && !isHiddenWorkspaceEntry(child.name)).length : 0;
                  // Display .drafts with i18n name / 草稿箱目录显示本地化名称
                  const isDraftsDir = node.title === DRAFTS_DIR_NAME && !isFile;
                  const displayTitle = isDraftsDir ? t('conversation.workspace.drafts.title') : node.title;

                  return (
                    <div
                      className='flex items-center justify-between gap-6px min-w-0'
                      style={{ color: 'inherit' }}
                      onClick={() => {}}
                      onDoubleClick={() => {
                        if (isFile && !readonly) {
                          fileOpsHook.handleAddToChat(nodeData);
                        }
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        openNodeContextMenu(nodeData, event.clientX, event.clientY);
                      }}
                    >
                      <span className='flex items-center gap-4px min-w-0 flex-1 overflow-hidden whitespace-nowrap'>
                        <span className='overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0'>{displayTitle}</span>
                        {isPasteTarget && <span className='ml-1 text-xs text-blue-700 font-bold bg-blue-500 text-white px-1.5 py-0.5 rounded flex-shrink-0'>PASTE</span>}
                      </span>
                      <span className='flex items-center gap-6px flex-shrink-0'>{!isFile && directFileCount > 0 && <span className='workspace-tree__count-badge'>{directFileCount}</span>}</span>
                    </div>
                  );
                }}
                onSelect={(keys, extra) => {
                  const clickedKey = extractNodeKey(extra?.node);
                  const nodeData = extra && extra.node ? extractNodeData(extra.node) : null;
                  const isFileNode = Boolean(nodeData?.isFile);
                  const wasSelected = clickedKey ? treeHook.selectedKeysRef.current.includes(clickedKey) : false;

                  if (isFileNode) {
                    // 单击文件仅打开预览，不改变选中状态 / Single-click file only opens preview without changing selection state
                    if (clickedKey) {
                      const filteredKeys = treeHook.selectedKeysRef.current.filter((key) => key !== clickedKey);
                      treeHook.selectedKeysRef.current = filteredKeys;
                      treeHook.setSelected(filteredKeys);
                    }
                    treeHook.selectedNodeRef.current = null;
                    if (nodeData && clickedKey && !wasSelected) {
                      void fileOpsHook.handlePreviewFile(nodeData);
                    }
                    return;
                  }

                  // 目录节点仍保留原有选中逻辑 / Keep existing selection logic for folders
                  let newKeys: string[];

                  if (clickedKey && wasSelected) {
                    newKeys = treeHook.selectedKeysRef.current.filter((key) => key !== clickedKey);
                  } else if (clickedKey) {
                    newKeys = [...treeHook.selectedKeysRef.current, clickedKey];
                  } else {
                    newKeys = keys.filter((key) => key !== workspace);
                  }

                  treeHook.setSelected(newKeys);
                  treeHook.selectedKeysRef.current = newKeys;

                  if (clickedKey) {
                    const isExpanded = treeHook.expandedKeys.includes(clickedKey);
                    treeHook.setExpandedKeys(isExpanded ? treeHook.expandedKeys.filter((key) => key !== clickedKey) : [...treeHook.expandedKeys, clickedKey]);
                  }

                  if (extra && extra.node && nodeData && nodeData.fullPath && nodeData.relativePath != null) {
                    treeHook.selectedNodeRef.current = {
                      relativePath: nodeData.relativePath,
                      fullPath: nodeData.fullPath,
                    };
                  } else {
                    treeHook.selectedNodeRef.current = null;
                  }

                  const items: Array<{ path: string; name: string; isFile: boolean; relativePath?: string }> = [];
                  for (const k of newKeys) {
                    const node = findNodeByKey(treeHook.files, k);
                    if (node && node.fullPath && node.isFile) {
                      items.push({
                        path: node.fullPath,
                        name: node.name,
                        isFile: node.isFile,
                        relativePath: node.relativePath,
                      });
                    }
                  }
                  if (eventPrefix === 'acp') {
                    emitter.emit('acp.selected.file', items);
                  }
                }}
                onExpand={(keys) => {
                  treeHook.setExpandedKeys(keys);
                }}
                loadMore={(treeNode) => {
                  const nodeData = treeNode.props.dataRef as IDirOrFile;
                  const path = dataSource === 'moss-session' ? nodeData.relativePath : nodeData.fullPath;
                  const loadPromise = dataSource === 'moss-session' ? ipcBridge.conversation.getRemoteWorkspace.invoke({ conversation_id, path }).then((res) => (res?.success ? (res.data?.files ?? []) : [])) : ipcBridge.conversation.getWorkspace.invoke({ conversation_id, workspace, path });
                  return loadPromise.then((res) => {
                    const children = res[0]?.children ?? [];
                    treeHook.setFiles((prev) => updateTreeNodeChildren(prev, nodeData.relativePath || nodeData.fullPath, children));
                  });
                }}
              ></Tree>
            )}
          </FlexFullContainer>
        )}

        {/* Sync footer — mirrors ui.zip `task-panel.tsx` footer. Shows a pulsing
            blue ping + "正在同步…" while a scan / refresh is running, or a
            breathing green dot + "上次同步: <relative>" when idle. The ping dot
            doubles as the visual cue that the inotify watcher is live. */}
        {(() => {
          const isSyncing = activeTab === 'files' ? treeHook.loading : skillsLoading;
          const diffSec = Math.max(0, Math.floor((Date.now() - lastSyncAt) / 1000));
          let relative: string;
          if (diffSec < 10) {
            relative = t('conversation.workspace.lastSyncJustNow', { defaultValue: '刚刚' });
          } else if (diffSec < 60) {
            relative = t('conversation.workspace.lastSyncSecondsAgo', { count: diffSec, defaultValue: '{{count}} 秒前' });
          } else if (diffSec < 3600) {
            relative = t('conversation.workspace.lastSyncMinutesAgo', { count: Math.floor(diffSec / 60), defaultValue: '{{count}} 分钟前' });
          } else {
            relative = t('conversation.workspace.lastSyncHoursAgo', { count: Math.floor(diffSec / 3600), defaultValue: '{{count}} 小时前' });
          }
          const prefix = t('conversation.workspace.lastSyncPrefix', { defaultValue: '上次同步' });
          const syncingLabel = t('conversation.workspace.lastSyncSyncing', { defaultValue: '正在同步…' });
          return (
            <div className='workspace-card__footer'>
              <span className={`workspace-card__sync-dot ${isSyncing ? 'workspace-card__sync-dot--syncing' : 'workspace-card__sync-dot--live'}`} aria-hidden='true' />
              <span className='workspace-card__sync-label'>{isSyncing ? syncingLabel : `${prefix}: ${relative}`}</span>
            </div>
          );
        })()}
      </div>

      {/* Context Menu - rendered via Portal to avoid overflow clipping */}
      {modalsHook.contextMenu.visible &&
        contextMenuNode &&
        contextMenuStyle &&
        (!readonly || isContextMenuNodeFile) &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className='fixed z-[9999] min-w-200px max-w-240px rounded-12px bg-base/95 shadow-[0_12px_40px_rgba(15,23,42,0.16)] backdrop-blur-sm p-6px'
            style={{ top: contextMenuStyle.top, left: contextMenuStyle.left }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <div className='flex flex-col gap-4px'>
              {readonly ? (
                <>
                  {isPreviewSupported && (
                    <button
                      type='button'
                      className={menuButtonBase}
                      onClick={() => {
                        void fileOpsHook.handlePreviewFile(contextMenuNode);
                      }}
                    >
                      {t('conversation.workspace.contextMenu.preview')}
                    </button>
                  )}
                  <button
                    type='button'
                    className={menuButtonBase}
                    onClick={() => {
                      void fileOpsHook.handleDownloadNode(contextMenuNode);
                    }}
                  >
                    {t('conversation.workspace.contextMenu.download')}
                  </button>
                </>
              ) : isContextMenuNodeRoot ? (
                <>
                  <button
                    type='button'
                    className={menuButtonBase}
                    onClick={() => {
                      void fileOpsHook.handleOpenNode(contextMenuNode);
                      modalsHook.closeContextMenu();
                    }}
                  >
                    {t('conversation.workspace.contextMenu.open')}
                  </button>
                  <button
                    type='button'
                    className={menuButtonBase}
                    onClick={() => {
                      openNewFolderModal(contextMenuNode);
                    }}
                  >
                    {t('conversation.workspace.contextMenu.newFolder')}
                  </button>
                  <button
                    type='button'
                    className={menuButtonBase}
                    onClick={() => {
                      setWsRenameModal({ visible: true, name: workspaceDisplayName });
                      modalsHook.closeContextMenu();
                    }}
                  >
                    {t('conversation.workspace.contextMenu.rename')}
                  </button>
                  <div className='h-1px bg-muted my-2px'></div>
                  <button
                    type='button'
                    className={menuButtonBase}
                    onClick={() => {
                      showBdpanUploadPicker(contextMenuNode);
                    }}
                  >
                    {t('conversation.workspace.contextMenu.uploadToBdpan')}
                  </button>
                  <button
                    type='button'
                    className={menuButtonBase}
                    disabled={!shareoneInstalled}
                    onClick={() => {
                      if (!shareoneInstalled) return;
                      void handleShareFile(contextMenuNode);
                      modalsHook.closeContextMenu();
                    }}
                  >
                    {shareoneInstalled ? t('conversation.workspace.contextMenu.shareone', { defaultValue: 'ShareOne' }) : t('settings.runtimeSettings.status.disabled', { defaultValue: '未启用' })}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type='button'
                    className={menuButtonBase}
                    onClick={() => {
                      fileOpsHook.handleAddToChat(contextMenuNode);
                    }}
                  >
                    {t('conversation.workspace.contextMenu.addToChat')}
                  </button>
                  <button
                    type='button'
                    className={menuButtonBase}
                    onClick={() => {
                      void fileOpsHook.handleOpenNode(contextMenuNode);
                      modalsHook.closeContextMenu();
                    }}
                  >
                    {t('conversation.workspace.contextMenu.open')}
                  </button>
                  {isContextMenuNodeFile && (
                    <button
                      type='button'
                      className={menuButtonBase}
                      onClick={() => {
                        void fileOpsHook.handleRevealNode(contextMenuNode);
                        modalsHook.closeContextMenu();
                      }}
                    >
                      {t('conversation.workspace.contextMenu.openLocation')}
                    </button>
                  )}
                  {isContextMenuNodeFile && (
                    <button
                      type='button'
                      className={menuButtonBase}
                      onClick={() => {
                        void fileOpsHook.handleDownloadNode(contextMenuNode);
                      }}
                    >
                      {t('conversation.workspace.contextMenu.download')}
                    </button>
                  )}
                  {isContextMenuNodeFile && isPreviewSupported && (
                    <button
                      type='button'
                      className={menuButtonBase}
                      onClick={() => {
                        void fileOpsHook.handlePreviewFile(contextMenuNode);
                      }}
                    >
                      {t('conversation.workspace.contextMenu.preview')}
                    </button>
                  )}
                  {!isContextMenuNodeFile && (
                    <button
                      type='button'
                      className={menuButtonBase}
                      onClick={() => {
                        openNewFolderModal(contextMenuNode);
                      }}
                    >
                      {t('conversation.workspace.contextMenu.newFolder')}
                    </button>
                  )}
                  <div className='h-1px bg-muted my-2px'></div>
                  <button
                    type='button'
                    className={menuButtonBase}
                    onClick={() => {
                      showBdpanUploadPicker(contextMenuNode);
                    }}
                  >
                    {t('conversation.workspace.contextMenu.uploadToBdpan')}
                  </button>
                  {isContextMenuNodeFile && (
                    <button
                      type='button'
                      className={menuButtonBase}
                      disabled={!shareoneInstalled || !isShareoneSupported}
                      onClick={() => {
                        if (!shareoneInstalled || !isShareoneSupported) return;
                        void handleShareFile(contextMenuNode);
                        modalsHook.closeContextMenu();
                      }}
                    >
                      {shareoneInstalled && isShareoneSupported ? t('conversation.workspace.contextMenu.shareone', { defaultValue: 'ShareOne' }) : t('settings.runtimeSettings.status.disabled', { defaultValue: '未启用' })}
                    </button>
                  )}
                  <div className='h-1px bg-muted my-2px'></div>
                  {!isContextMenuNodeDrafts && (
                    <button
                      type='button'
                      className={menuButtonBase}
                      onClick={() => {
                        fileOpsHook.handleDeleteNode(contextMenuNode);
                      }}
                    >
                      {t('common.delete')}
                    </button>
                  )}
                  {!isContextMenuNodeDrafts && (
                    <button
                      type='button'
                      className={menuButtonBase}
                      onClick={() => {
                        fileOpsHook.openRenameModal(contextMenuNode);
                      }}
                    >
                      {t('conversation.workspace.contextMenu.rename')}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export default ChatWorkspace;
