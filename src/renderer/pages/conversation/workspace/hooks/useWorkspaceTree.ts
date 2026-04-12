/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IDirOrFile } from '@/common/ipcBridge';
import { emitter } from '@/renderer/utils/emitter';
import { dispatchWorkspaceHasFilesEvent } from '@/renderer/utils/workspaceEvents';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SelectedNodeRef } from '../types';
import { filterValidExpandedKeys, getAllDirKeys, getFirstLevelKeys } from '../utils/treeHelpers';

interface UseWorkspaceTreeOptions {
  workspace: string;
  conversation_id: string;
  eventPrefix: 'acp' | 'openclaw-gateway';
  backend?: string;
}

export function filterHiddenWorkspaceDirs(
  nodes: IDirOrFile[],
  options: { eventPrefix: 'acp' | 'openclaw-gateway'; backend?: string; isRoot?: boolean }
): IDirOrFile[] {
  const { eventPrefix, backend, isRoot = true } = options;
  const hiddenNames = new Set<string>();

  if (isRoot) {
    if (eventPrefix === 'openclaw-gateway') {
      hiddenNames.add('skills');
    }
    if (eventPrefix === 'acp' && backend === 'claude') {
      hiddenNames.add('.claude');
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
export function useWorkspaceTree({ workspace, conversation_id, eventPrefix, backend }: UseWorkspaceTreeOptions) {
  // Tree state / 树状态
  const [files, setFiles] = useState<IDirOrFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [treeKey, setTreeKey] = useState(Math.random());
  const [expandedKeys, _setExpandedKeys] = useState<string[]>([]);

  // 使用 ref 跟踪用户当前展开的 key，避免在刷新时丢失状态
  // Use ref to track user's current expanded keys, preventing state loss during refreshes
  const expandedKeysRef = useRef<string[]>([]);

  // 包装 setExpandedKeys，自动同步 state 和 ref
  // Wrap setExpandedKeys to auto-sync state and ref
  const setExpandedKeys = useCallback((keys: string[] | ((prev: string[]) => string[])) => {
    if (typeof keys === 'function') {
      _setExpandedKeys((prev) => {
        const newKeys = keys(prev);
        expandedKeysRef.current = newKeys;
        return newKeys;
      });
    } else {
      expandedKeysRef.current = keys;
      _setExpandedKeys(keys);
    }
  }, []);

  // Selection state / 选中状态
  const [selected, setSelected] = useState<string[]>([]);

  // 标记是否为首次加载（用于区分初始化和后续刷新）
  // Track if this is the first load (to distinguish initialization from subsequent refreshes)
  const isFirstLoadRef = useRef(true);

  // 会话切换时重置首次加载标记
  // Reset first load flag when conversation switches
  useEffect(() => {
    isFirstLoadRef.current = true;
  }, [conversation_id]);

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
      console.warn('[WS_DEBUG] loadWorkspace called', { seq, path, workspace, conversation_id, search });
      setLoadingHandler(true);
      return ipcBridge.conversation.getWorkspace
        .invoke({ path, workspace, conversation_id, search: search || '' })
        .then((res) => {
          const filteredRes = filterHiddenWorkspaceDirs(res, { eventPrefix, backend });
          const childCount = filteredRes?.[0]?.children?.length ?? 0;
          console.warn('[WS_DEBUG] getWorkspace returned', { seq, current: loadSeqRef.current, resLength: filteredRes?.length, childCount, rootName: filteredRes?.[0]?.name });

          // Ignore stale responses from aborted requests:
          // The backend aborts previous getWorkspace calls, returning [].
          // Only apply the result from the latest request.
          if (seq !== loadSeqRef.current) {
            console.warn('[WS_DEBUG] ignoring stale response', { seq, current: loadSeqRef.current });
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
          // 后续刷新保留用户展开状态，仅移除已删除目录的 key
          // When searching: expand all folders containing matches
          // First load: only expand first level
          // Subsequent refreshes: preserve user's expanded keys, only remove deleted dirs
          if (search) {
            setExpandedKeys(getAllDirKeys(filteredRes));
          } else if (isFirstLoadRef.current) {
            setExpandedKeys(getFirstLevelKeys(filteredRes));
          } else {
            // 保留用户展开状态，过滤掉已不存在的目录
            // Preserve user's expanded keys, filter out deleted directories
            const validKeys = filterValidExpandedKeys(expandedKeysRef.current, filteredRes);
            setExpandedKeys(validKeys);
          }

          // 根据是否有文件决定工作空间面板的展开/折叠状态
          // Determine workspace panel expand/collapse state based on files
          const hasFiles = filteredRes.length > 0 && (filteredRes[0]?.children?.length ?? 0) > 0;

          if (isFirstLoadRef.current) {
            // 首次加载（切换会话或打开会话）：有文件展开，没文件折叠
            // First load (switch or open conversation): expand if has files, collapse if not
            dispatchWorkspaceHasFilesEvent(hasFiles, conversation_id);
            isFirstLoadRef.current = false;
          } else {
            // 后续刷新（Agent 生成文件等）：有文件就展开，不主动折叠
            // Subsequent refresh (agent generates files, etc.): expand if has files, never collapse
            if (hasFiles) {
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
    [backend, conversation_id, eventPrefix, workspace, setLoadingHandler]
  );

  /**
   * 刷新工作空间
   * Refresh workspace
   */
  const refreshWorkspace = useCallback(() => {
    return loadWorkspace(workspace);
  }, [workspace, loadWorkspace]);

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
          if (eventPrefix === 'openclaw-gateway') {
            emitter.emit('openclaw-gateway.selected.file', conversation_id, payload);
          } else {
            emitter.emit('acp.selected.file', payload);
          }
        } else if (shouldEmit) {
          if (eventPrefix === 'openclaw-gateway') {
            emitter.emit('openclaw-gateway.selected.file', conversation_id, []);
          } else {
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
          if (eventPrefix === 'openclaw-gateway') {
            emitter.emit('openclaw-gateway.selected.file', conversation_id, payload);
          } else {
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
          if (eventPrefix === 'openclaw-gateway') {
            emitter.emit('openclaw-gateway.selected.file', conversation_id, payload);
          } else {
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
