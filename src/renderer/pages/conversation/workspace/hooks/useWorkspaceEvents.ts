import { useEffect, useRef } from 'react';
import { ipcBridge } from '@/common';
import type { IDirOrFile } from '@/common/ipcBridge';
import { emitter, useAddEventListener } from '@/renderer/utils/emitter';
import { getAllDirKeys } from '../utils/treeHelpers';
import type { ContextMenuState } from '../types';

interface UseWorkspaceEventsOptions {
  conversation_id: string;
  eventPrefix: 'acp' | 'remote-agent';
  // Absolute workspace root path — used to install an inotify-style recursive
  // directory watcher so the tree refreshes automatically when files change
  // outside of the agent event stream (manual file ops, external tools, etc.).
  workspace: string;

  // Dependencies from useWorkspaceTree
  refreshWorkspace: () => void;
  clearSelection: () => void;
  setFiles: React.Dispatch<React.SetStateAction<IDirOrFile[]>>;
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
  setExpandedKeys: React.Dispatch<React.SetStateAction<string[]>>;
  setTreeKey: React.Dispatch<React.SetStateAction<number>>;
  selectedNodeRef: React.MutableRefObject<{ relativePath: string; fullPath: string } | null>;
  selectedKeysRef: React.MutableRefObject<string[]>;

  // Dependencies from useWorkspaceModals
  closeContextMenu: () => void;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState>>;
  closeRenameModal: () => void;
  closeDeleteModal: () => void;
  readonly?: boolean;
  dataSource?: 'local' | 'moss-session';
}

/**
 * useWorkspaceEvents - 管理所有事件监听器
 * Manage all event listeners
 *
 * Returns { watchIdRef } so sibling hooks (skillCount, WorkspaceSkills) can
 * filter dirChanged events by the same watchId instead of reacting to every
 * file-system event globally.
 */
export function useWorkspaceEvents(options: UseWorkspaceEventsOptions) {
  const { conversation_id, eventPrefix, workspace, refreshWorkspace, clearSelection, setFiles, setSelected, setExpandedKeys, setTreeKey, selectedNodeRef, selectedKeysRef, closeContextMenu, setContextMenu, closeRenameModal, closeDeleteModal, readonly = false, dataSource = 'local' } = options;

  // Keep the latest refreshWorkspace callable stable for the watcher debounce
  // callback so we don't have to tear the watcher down and rebuild it on every
  // render (each renderer-side debounce timer still flushes to the freshest
  // handler).
  const refreshRef = useRef(refreshWorkspace);
  useEffect(() => {
    refreshRef.current = refreshWorkspace;
  }, [refreshWorkspace]);

  // Expose the active directory-watch ID so other hooks can filter dirChanged
  // events to only the workspace watcher, avoiding a global feedback loop.
  const watchIdRef = useRef<string | null>(null);

  /**
   * 监听对话切换事件 - 重置所有状态
   * Listen to conversation switch event - reset all states
   */
  useEffect(() => {
    setFiles([]);
    setSelected([]);
    // 不要在这里重置展开状态，由 useWorkspaceTree 的 useEffect 负责处理（读取 localStorage 或清空）
    // Do not reset expanded keys here, handled by useWorkspaceTree's useEffect (reading localStorage or clearing)
    selectedNodeRef.current = null;
    selectedKeysRef.current = [];
    setTreeKey(Math.random());
    setContextMenu({ visible: false, x: 0, y: 0, node: null });
    closeRenameModal();
    closeDeleteModal();
    if (eventPrefix === 'acp') {
      emitter.emit('acp.selected.file', []);
    }
  }, [closeDeleteModal, closeRenameModal, conversation_id, eventPrefix, setContextMenu, setFiles, setSelected, setTreeKey, selectedKeysRef, selectedNodeRef]);

  /**
   * 监听 Agent 响应流 - 自动刷新工作空间
   * Listen to agent response stream - auto refresh workspace
   */
  useEffect(() => {
    if (dataSource === 'moss-session') {
      return undefined;
    }

    const handleAcpResponse = (data: { type: string }) => {
      if (data.type === 'acp_tool_call' || data.type === 'codex_tool_call') {
        refreshWorkspace();
      }
    };
    const unsubscribeAcp = ipcBridge.acpConversation.responseStream.on(handleAcpResponse);

    return () => {
      unsubscribeAcp();
    };
  }, [dataSource, refreshWorkspace]);

  useEffect(() => {
    if (dataSource !== 'moss-session') {
      return undefined;
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let followUpTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = (delay = 300) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        refreshRef.current();
      }, delay);
    };
    const scheduleFollowUpRefresh = (delay = 1200) => {
      if (followUpTimer) clearTimeout(followUpTimer);
      followUpTimer = setTimeout(() => {
        followUpTimer = null;
        refreshRef.current();
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

      if (message.type === 'acp_tool_call') {
        const status = (message.data as { status?: string } | undefined)?.status;
        if (!status || status === 'completed') {
          scheduleRefresh();
        }
        return;
      }

      if (message.type === 'content' || message.type === 'finish') {
        scheduleRefresh();
        scheduleFollowUpRefresh();
      }
    });

    const unsubscribeConversation = ipcBridge.database.conversationChanged.on((event) => {
      if (event.conversationId === conversation_id && event.action === 'updated') {
        scheduleRefresh();
      }
    });

    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (followUpTimer) {
        clearTimeout(followUpTimer);
        followUpTimer = null;
      }
      unsubscribeStream();
      unsubscribeConversation();
    };
  }, [conversation_id, dataSource, refreshWorkspace]);

  /**
   * inotify 风格的工作空间目录监听 — 任何文件/子目录变化都会触发刷新
   * inotify-style directory watcher on the workspace root — any file or
   * subdirectory change triggers a debounced tree refresh so the UI stays in
   * sync without relying on agent stream events or manual reload. Platform
   * differences (macOS/Windows native recursive vs. Linux per-dir walk) are
   * handled transparently by the main-process bridge.
   */
  // Minimum interval between dirChanged-triggered refreshes to prevent
  // feedback loops on Windows where file system reads during getWorkspace
  // (stat, readdir) can spuriously trigger further fs.watch events.
  const lastDirRefreshAtRef = useRef(0);

  useEffect(() => {
    if (!workspace || readonly || dataSource === 'moss-session') return;

    let cancelled = false;
    let localWatchId: string | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const DIR_REFRESH_COOLDOWN_MS = 1000;

    const scheduleRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      // Renderer-side debounce stacks on top of the 120ms main-process debounce
      // to coalesce bursts (e.g. npm install writing hundreds of files) into a
      // single tree reload.
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (cancelled) return;
        // Skip if we refreshed recently — prevents the refresh → file reads
        // → dirChanged → refresh loop that occurs on Windows.
        if (Date.now() - lastDirRefreshAtRef.current < DIR_REFRESH_COOLDOWN_MS) return;
        lastDirRefreshAtRef.current = Date.now();
        refreshRef.current();
      }, 200);
    };

    const unsubscribe = ipcBridge.fileWatch.dirChanged.on((payload) => {
      if (!localWatchId || payload.watchId !== localWatchId) return;
      scheduleRefresh();
    });

    void (async () => {
      try {
        const res = await ipcBridge.fileWatch.startWatchDir.invoke({ dirPath: workspace, recursive: true });
        if (cancelled) {
          if (res?.success && res.data?.watchId) {
            ipcBridge.fileWatch.stopWatchDir.invoke({ watchId: res.data.watchId }).catch(() => {});
          }
          return;
        }
        if (res?.success && res.data?.watchId) {
          localWatchId = res.data.watchId;
          watchIdRef.current = res.data.watchId;
        }
      } catch {
        /* workspace may not exist yet; ignore, agent events will still refresh */
      }
    })();

    return () => {
      cancelled = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      unsubscribe();
      if (localWatchId) {
        ipcBridge.fileWatch.stopWatchDir.invoke({ watchId: localWatchId }).catch(() => {});
        localWatchId = null;
      }
      watchIdRef.current = null;
    };
  }, [workspace, readonly, dataSource]);

  /**
   * 监听手动刷新工作空间事件
   * Listen to manual refresh workspace event
   */
  useAddEventListener(`${eventPrefix}.workspace.refresh`, () => refreshWorkspace(), [refreshWorkspace]);

  /**
   * 监听清空选中文件事件（发送消息后）
   * Listen to clear selected files event (after sending message)
   */
  useAddEventListener(`${eventPrefix}.selected.file.clear`, () => clearSelection(), [clearSelection]);

  /**
   * 监听选中文件变化事件（sendbox 中关闭标签时同步状态）(#1083)
   * Listen to selected files change event (sync state when closing tags in sendbox)
   */
  useAddEventListener(
    `${eventPrefix}.selected.file`,
    (...args: [Array<{ path: string; name: string; isFile: boolean; relativePath?: string }>] | [string, Array<{ path: string; name: string; isFile: boolean; relativePath?: string }>]) => {
      if (eventPrefix === 'remote-agent') return;
      const items = args[0] as Array<{ path: string; name: string; isFile: boolean; relativePath?: string }>;
      if (!Array.isArray(items)) return;

      // Extract relative paths from items, filter out files (only keep folders in tree selection)
      // 从 items 中提取相对路径，过滤掉文件（树选中状态只保留文件夹）
      const newKeys = items.filter((item) => !item.isFile && item.relativePath).map((item) => item.relativePath!);
      setSelected(newKeys);
      selectedKeysRef.current = newKeys;

      // Update selectedNodeRef based on items
      // 根据 items 更新 selectedNodeRef
      const folders = items.filter((item) => !item.isFile);
      if (folders.length > 0) {
        const lastFolder = folders[folders.length - 1];
        selectedNodeRef.current = lastFolder.relativePath
          ? {
              relativePath: lastFolder.relativePath,
              fullPath: lastFolder.path,
            }
          : null;
      } else {
        selectedNodeRef.current = null;
      }
    },
    [eventPrefix, conversation_id, setSelected, selectedKeysRef, selectedNodeRef]
  );

  useEffect(() => {
    if (!conversation_id || dataSource === 'moss-session') return undefined;

    const unsubscribeRefresh = ipcBridge.conversation.responseStream.on((message) => {
      if (message.conversation_id !== conversation_id) return;
      if (message.type !== 'finish') return;
      refreshRef.current();
    });

    return () => {
      unsubscribeRefresh();
    };
  }, [conversation_id, dataSource]);

  /**
   * 监听搜索工作空间响应
   * Listen to search workspace response
   */
  useEffect(() => {
    return ipcBridge.conversation.responseSearchWorkSpace.provider((data) => {
      if (data.match) {
        const matchData = [data.match];
        setFiles(matchData);
        // 搜索时自动展开所有文件夹，让用户直接看到匹配结果
        // Auto-expand all folders on search so users can see matches directly
        setExpandedKeys(getAllDirKeys(matchData));
      }
      return Promise.resolve();
    });
  }, [setFiles, setExpandedKeys]);

  /**
   * 监听右键菜单外部点击 - 关闭菜单
   * Listen to clicks outside context menu - close menu
   */
  useEffect(() => {
    const handleClose = () => {
      closeContextMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu();
      }
    };
    window.addEventListener('click', handleClose);
    window.addEventListener('scroll', handleClose, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleClose);
      window.removeEventListener('scroll', handleClose, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeContextMenu]);

  return { watchIdRef };
}
