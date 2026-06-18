/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SelectedNodeRef } from '../types';
import { ensureDraftsDirectoryNode, filterValidExpandedKeys, getAllDirKeys, getFirstLevelKeys, getLimitedDepthKeys } from '../utils/treeHelpers';
import { ipcBridge } from '@/common';
import type { IDirOrFile } from '@/common/ipcBridge';
import { emitter } from '@/renderer/utils/emitter';
import { dispatchWorkspaceHasFilesEvent } from '@/renderer/utils/workspaceEvents';

interface UseWorkspaceTreeOptions {
  workspace: string;
  conversation_id: string;
  eventPrefix: 'acp' | 'remote-agent';
  backend?: string;
  dataSource?: 'local' | 'moss-session';
}

export function filterHiddenWorkspaceDirs(nodes: IDirOrFile[], options: { eventPrefix: 'acp' | 'remote-agent'; backend?: string; isRoot?: boolean }): IDirOrFile[] {
  const { eventPrefix, backend, isRoot = true } = options;
  const hiddenNames = new Set<string>();

  if (isRoot && eventPrefix !== 'remote-agent') {
    if (eventPrefix === 'acp' && backend === 'claude') {
      hiddenNames.add('.claude');
    }
    if (eventPrefix === 'acp' && backend === 'scode') {
      hiddenNames.add('.nexus');
    }
  }

  return nodes
    .filter((node) => !(hiddenNames.has(node.name) && node.isDir))
    .map((node) => {
      const nextChildren = node.children
        ? filterHiddenWorkspaceDirs(node.children, {
            eventPrefix,
            backend,
            // Workspace trees usually have a synthetic root node with
            // `relativePath === ''`; its direct children are the real first
            // level entries that should receive the hide filter.
            isRoot: isRoot && node.relativePath === '',
          })
        : node.children;

      return {
        ...node,
        children: nextChildren,
      };
    });
}

/**
 * useWorkspaceTree - 合并树状态管理和选择逻辑
 * Merge tree state management and selection logic
 */
export function useWorkspaceTree({ workspace, conversation_id, eventPrefix, backend, dataSource = 'local' }: UseWorkspaceTreeOptions) {
  // Tree state / 树状态
  const [files, setFiles] = useState<IDirOrFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [treeKey, setTreeKey] = useState(Math.random());
  const [expandedKeys, _setExpandedKeys] = useState<string[]>([]);

  // 从 localStorage 获取持久化的展开状态
  const getPersistedExpandedKeys = useCallback(() => {
    try {
      if (!conversation_id) return null;
      const stored = localStorage.getItem(`workspace-expanded-keys-${conversation_id}`);
      if (stored) {
        return JSON.parse(stored) as string[];
      }
    } catch {
      // 忽略错误
    }
    return null;
  }, [conversation_id]);

  // 使用 ref 跟踪用户当前展开的 key，避免在刷新时丢失状态
  // Use ref to track user's current expanded keys, preventing state loss during refreshes
  const expandedKeysRef = useRef<string[]>([]);

  // 包装 setExpandedKeys，自动同步 state 和 ref 以及 localStorage
  // Wrap setExpandedKeys to auto-sync state, ref and localStorage
  const setExpandedKeys = useCallback(
    (keys: string[] | ((prev: string[]) => string[])) => {
      if (typeof keys === 'function') {
        _setExpandedKeys((prev) => {
          const newKeys = keys(prev);
          expandedKeysRef.current = newKeys;
          if (conversation_id) {
            try {
              localStorage.setItem(`workspace-expanded-keys-${conversation_id}`, JSON.stringify(newKeys));
            } catch {
              // ignore
            }
          }
          return newKeys;
        });
      } else {
        expandedKeysRef.current = keys;
        _setExpandedKeys(keys);
        if (conversation_id) {
          try {
            localStorage.setItem(`workspace-expanded-keys-${conversation_id}`, JSON.stringify(keys));
          } catch {
            // ignore
          }
        }
      }
    },
    [conversation_id]
  );

  // Selection state / 选中状态
  const [selected, setSelected] = useState<string[]>([]);

  // 标记是否为首次加载（用于区分初始化和后续刷新）
  // Track if this is the first load (to distinguish initialization from subsequent refreshes)
  const isFirstLoadRef = useRef(true);

  // 会话切换时重置首次加载标记
  // Reset first load flag when conversation switches
  useEffect(() => {
    isFirstLoadRef.current = true;

    // 切换会话时，尝试从 localStorage 恢复展开状态
    const persistedKeys = getPersistedExpandedKeys();
    if (persistedKeys) {
      expandedKeysRef.current = persistedKeys;
      _setExpandedKeys(persistedKeys);
    } else {
      expandedKeysRef.current = []; // 切换会话时重置展开状态
      _setExpandedKeys([]);
    }
  }, [conversation_id, workspace, getPersistedExpandedKeys]);

  const selectedKeysRef = useRef<string[]>([]);
  const selectedNodeRef = useRef<SelectedNodeRef | null>(null);

  // Loading time tracker / 加载时间追踪
  const lastLoadingTime = useRef(Date.now());

  /**
   * 设置 loading 状态（带防抖，避免图标闪烁）
   * Set loading state with debounce to avoid icon flickering
   */
  const setLoadingHandler = useCallback((newState: boolean) => {
    if (newState) {
      lastLoadingTime.current = Date.now();
      setLoading(true);
    } else {
      // 确保loading动画保持至少1秒 / Ensure loading animation lasts at least 1 second
      if (Date.now() - lastLoadingTime.current > 1000) {
        setLoading(false);
      } else {
        setTimeout(() => {
          setLoading(false);
        }, 1000);
      }
    }
  }, []);

  /**
   * 加载工作空间文件树
   * Load workspace file tree
   */
  // Track the latest request to ignore stale/aborted responses
  const loadSeqRef = useRef(0);

  const loadWorkspace = useCallback(
    (path: string, search?: string) => {
      const seq = ++loadSeqRef.current;
      setLoadingHandler(true);
      const workspacePromise =
        dataSource === 'moss-session'
          ? ipcBridge.conversation.getRemoteWorkspace.invoke({ conversation_id, path: path === workspace ? undefined : path, search: search || '' }).then((res) => {
              if (!res?.success) {
                throw new Error(res?.msg || 'Failed to load remote workspace');
              }
              return res.data?.files ?? [];
            })
          : ipcBridge.conversation.getWorkspace.invoke({ path, workspace, conversation_id, search: search || '' });

      return workspacePromise
        .then((res) => {
          const shouldEnsureRemoteDrafts = dataSource === 'moss-session' && !search && path === workspace;
          const normalizedRes = shouldEnsureRemoteDrafts ? ensureDraftsDirectoryNode(res) : res;
          const filteredRes = filterHiddenWorkspaceDirs(normalizedRes, { eventPrefix, backend });

          // Ignore stale responses from aborted requests:
          // The backend aborts previous getWorkspace calls, returning [].
          // Only apply the result from the latest request.
          if (seq !== loadSeqRef.current) {
            return filteredRes;
          }

          setFiles(filteredRes);
          // 只在搜索时才重置 Tree key，否则保持选中状态
          // Only reset Tree key when searching, otherwise keep selection state
          if (search) {
            setTreeKey(Math.random());
          }

          // 搜索时展开所有包含匹配结果的文件夹
          // 首次加载只展开第一层
          // 大目录（>100 个子项）只展开前两层，避免性能问题
          // 后续刷新保留用户展开状态，仅移除已删除目录的 key
          // When searching: expand all folders containing matches
          // First load: only expand first level
          // Large directory (>100 children): only expand first 2 levels to avoid performance issues
          // Subsequent refreshes: preserve user's expanded keys, only remove deleted dirs
          if (search) {
            setExpandedKeys(getAllDirKeys(filteredRes));
          } else if (isFirstLoadRef.current) {
            // 大目录优化：如果子项超过 100 个，只展开前两层
            // Large directory optimization: if children > 100, only expand first 2 levels
            // 如果从 localStorage 恢复了持久化的状态，则优先使用
            // If persisted state is restored from localStorage, use it first
            const persistedKeys = getPersistedExpandedKeys();
            if (persistedKeys && persistedKeys.length > 0) {
              const validKeys = filterValidExpandedKeys(persistedKeys, filteredRes);
              setExpandedKeys(validKeys);
            } else if (expandedKeysRef.current && expandedKeysRef.current.length > 0) {
              const validKeys = filterValidExpandedKeys(expandedKeysRef.current, filteredRes);
              setExpandedKeys(validKeys);
            } else {
              const childCount = filteredRes?.[0]?.children?.length ?? 0;
              if (childCount > 100) {
                setExpandedKeys(getLimitedDepthKeys(filteredRes, 2));
              } else {
                setExpandedKeys(getFirstLevelKeys(filteredRes));
              }
            }
          } else {
            // 保留用户展开状态，过滤掉已不存在的目录
            // Preserve user's expanded keys, filter out deleted directories
            if (expandedKeysRef.current && expandedKeysRef.current.length > 0) {
              const validKeys = filterValidExpandedKeys(expandedKeysRef.current, filteredRes);
              setExpandedKeys(validKeys);
            }
          }

          // 根据是否有文件决定工作空间面板的展开/折叠状态
          // Determine workspace panel expand/collapse state based on files
          const hasFiles = filteredRes.length > 0 && (filteredRes[0]?.children?.length ?? 0) > 0;
          const shouldShowWorkspace = dataSource === 'moss-session' || hasFiles;

          if (isFirstLoadRef.current) {
            // 首次加载（切换会话或打开会话）：有文件展开，没文件折叠
            // First load (switch or open conversation): expand if has files, collapse if not
            dispatchWorkspaceHasFilesEvent(shouldShowWorkspace, conversation_id);
            isFirstLoadRef.current = false;
          } else {
            // 后续刷新（Agent 生成文件等）：有文件就展开，不主动折叠
            // Subsequent refresh (agent generates files, etc.): expand if has files, never collapse
            if (shouldShowWorkspace) {
              dispatchWorkspaceHasFilesEvent(true, conversation_id);
            }
          }

          return filteredRes;
        })
        .finally(() => {
          // Only clear loading for the latest request — stale/aborted requests
          // must not prematurely cancel the spinner while a newer request is in flight.
          if (seq === loadSeqRef.current) {
            setLoadingHandler(false);
          }
        });
    },
    [backend, conversation_id, dataSource, eventPrefix, getPersistedExpandedKeys, setExpandedKeys, workspace, setLoadingHandler]
  );

  /**
   * 刷新工作空间
   * Refresh workspace
   */
  const refreshWorkspace = useCallback(() => {
    return loadWorkspace(workspace);
  }, [workspace, loadWorkspace]);

  // Whenever the active conversation/workspace changes, load the current tree
  // directly from the latest props instead of relying on external reset hooks.
  useEffect(() => {
    if (!workspace) return;
    void loadWorkspace(workspace);
  }, [conversation_id, workspace, loadWorkspace]);

  /**
   * 确保节点被选中，并可选地发送事件
   * Ensure node is selected and optionally emit event
   */
  const ensureNodeSelected = useCallback(
    (nodeData: IDirOrFile, options?: { emit?: boolean }) => {
      const key = nodeData.relativePath;
      const shouldEmit = Boolean(options?.emit);

      if (!key) {
        setSelected([]);
        selectedKeysRef.current = [];
        if (!nodeData.isFile && nodeData.fullPath) {
          // 记录最后选中的文件夹 / Remember the latest selected folder
          selectedNodeRef.current = {
            relativePath: key ?? '',
            fullPath: nodeData.fullPath,
          };
        }
        if (shouldEmit && nodeData.fullPath) {
          const payload = [
            {
              path: nodeData.fullPath,
              name: nodeData.name,
              isFile: nodeData.isFile,
              relativePath: nodeData.relativePath,
            },
          ];
          if (eventPrefix === 'acp') {
            emitter.emit('acp.selected.file', payload);
          }
        } else if (shouldEmit) {
          if (eventPrefix === 'acp') {
            emitter.emit('acp.selected.file', []);
          }
        }
        return;
      }

      setSelected([key]);
      selectedKeysRef.current = [key];

      if (!nodeData.isFile) {
        selectedNodeRef.current = {
          relativePath: key,
          fullPath: nodeData.fullPath,
        };
        if (shouldEmit && nodeData.fullPath) {
          // 将文件夹对象发给发送框 / Emit folder object to send box
          const payload = [
            {
              path: nodeData.fullPath,
              name: nodeData.name,
              isFile: false,
              relativePath: nodeData.relativePath,
            },
          ];
          if (eventPrefix === 'acp') {
            emitter.emit('acp.selected.file', payload);
          }
        }
      } else if (nodeData.fullPath) {
        selectedNodeRef.current = null;
        if (shouldEmit) {
          // 选中文件时，将文件信息广播 / Broadcast file info when selected
          const payload = [
            {
              path: nodeData.fullPath,
              name: nodeData.name,
              isFile: true,
              relativePath: nodeData.relativePath,
            },
          ];
          if (eventPrefix === 'acp') {
            emitter.emit('acp.selected.file', payload);
          }
        }
      }
    },
    [eventPrefix]
  );

  /**
   * 清空选中状态
   * Clear selection state
   */
  const clearSelection = useCallback(() => {
    setSelected([]);
    selectedKeysRef.current = [];
    selectedNodeRef.current = null;
  }, []);

  return {
    // State / 状态
    files,
    loading,
    treeKey,
    expandedKeys,
    selected,
    selectedKeysRef,
    selectedNodeRef,

    // Actions / 操作
    setFiles,
    setTreeKey,
    setExpandedKeys,
    setSelected,
    loadWorkspace,
    refreshWorkspace,
    ensureNodeSelected,
    clearSelection,
  };
}
