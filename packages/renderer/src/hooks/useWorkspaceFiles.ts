/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { IDirOrFile } from '@sudowork/host-bridge/ipcBridge';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { DRAFTS_DIR_NAME } from '@sudowork/common/constants';
import { useConversationContextSafe } from '@renderer/context/ConversationContext';
import { useAddEventListener } from '@renderer/utils/emitter';

// Hidden directories that should never appear in @ file selector
// 隐藏目录列表：这些目录不应出现在 @ 文件选择器中
const HIDDEN_DIR_NAMES = new Set(['.git', '.nexus', '.scode', '.claude', '.sandbox-home', '.sandbox-tmp', '.idea', '.vscode', '.venv', '.next', '.pyc']);

// Common build/output directories to hide
// 常见构建/输出目录
const BUILD_DIR_NAMES = new Set(['dist', 'build', 'out', '__pycache__', 'venv', 'node_modules']);

const isHiddenOrBuildDir = (name: string): boolean => HIDDEN_DIR_NAMES.has(name) || BUILD_DIR_NAMES.has(name) || (name.startsWith('.') && name !== DRAFTS_DIR_NAME);
const normalizeUiPath = (value: string): string => value.replace(/\\/g, '/');

/**
 * Flattened workspace file item for @ mention selection
 */
export interface WorkspaceFileItem {
  /** File name (e.g. "main.py") */
  name: string;
  /** Full absolute path */
  fullPath: string;
  /** Relative path from workspace root (e.g. "src/main.py") */
  relativePath: string;
  /** Whether this is a file (true) or directory (false) */
  isFile: boolean;
  /** Whether this file is from the drafts folder / 是否为草稿箱文件 */
  isDraft?: boolean;
}

/**
 * Recursively flatten IDirOrFile tree into a flat list of file items
 */
function flattenFileTree(nodes: IDirOrFile[], result: WorkspaceFileItem[] = []): WorkspaceFileItem[] {
  for (const node of nodes) {
    const normalizedPath = normalizeUiPath(node.relativePath);
    const topDir = normalizedPath.split('/')[0];

    // Skip hidden/build directories and files inside them (allow .drafts)
    if (!node.isFile && isHiddenOrBuildDir(node.name)) continue;
    if (node.isFile && isHiddenOrBuildDir(topDir)) continue;

    if (node.isFile) {
      result.push({
        name: node.name,
        fullPath: node.fullPath,
        relativePath: normalizedPath,
        isFile: true,
      });
    }
    if (node.children && node.children.length > 0) {
      flattenFileTree(node.children, result);
    }
  }
  return result;
}

/**
 * Hook to fetch workspace files for @ mention file references.
 * Local (acp) conversations scan the workspace dir via ipcBridge.fs.getFilesByDir;
 * remote-agent conversations fetch the moss server-side workspace tree.
 * Listens for workspace refresh events to auto-update.
 */
export function useWorkspaceFiles(): WorkspaceFileItem[] {
  const conversationContext = useConversationContextSafe();
  const workspace = conversationContext?.workspace;
  const conversationType = conversationContext?.type;
  const conversationId = conversationContext?.conversationId;
  const [files, setFiles] = useState<WorkspaceFileItem[]>([]);
  const loadingRef = useRef(false);

  const loadFiles = useCallback(async () => {
    if (loadingRef.current) return;
    // remote-agent（moss）会话：文件在 moss 服务端工作区，取会话工作区树（根调用即全树）
    if (conversationType === 'remote-agent') {
      if (!conversationId) return;
      loadingRef.current = true;
      try {
        const res = await ipcBridge.conversation.getRemoteWorkspace.invoke({ conversation_id: conversationId });
        const rootChildren = res?.success ? (res.data?.files[0]?.children ?? []) : [];
        const flatList = flattenFileTree(rootChildren);
        flatList.sort((a, b) => a.name.localeCompare(b.name));
        setFiles(flatList);
      } catch (error) {
        console.error('[useWorkspaceFiles] Failed to load workspace files:', error);
      } finally {
        loadingRef.current = false;
      }
      return;
    }
    if (!workspace) return;
    loadingRef.current = true;
    try {
      // Fetch workspace files and draft files in parallel
      // 并行获取工作空间文件和草稿箱文件
      const workspaceFilesPromise = ipcBridge.fs.getFilesByDir.invoke({ dir: workspace, root: workspace });
      const draftsFilesPromise = ipcBridge.workspaceManage.listDrafts.invoke({ workspace }).catch((): null => null);
      const [result, draftsResult] = await Promise.all([workspaceFilesPromise, draftsFilesPromise]);

      const flatList = result && result.length > 0 && result[0].children ? flattenFileTree(result[0].children) : [];

      // Merge draft files into the list with isDraft flag
      // 将草稿箱文件合并到列表中，标记 isDraft
      if (draftsResult?.success && draftsResult.data && draftsResult.data.length > 0) {
        const sep = workspace.includes('\\') ? '\\' : '/';
        const draftsDir = `${workspace}${sep}${DRAFTS_DIR_NAME}`;
        const fileIndexByRelativePath = new Map(flatList.map((item, index) => [normalizeUiPath(item.relativePath), index] as const));
        for (const draft of draftsResult.data) {
          const relativePath = normalizeUiPath(`${DRAFTS_DIR_NAME}/${draft.name}`);
          const existingIndex = fileIndexByRelativePath.get(relativePath);
          if (existingIndex !== undefined) {
            flatList[existingIndex] = {
              ...flatList[existingIndex],
              isDraft: true,
            };
            continue;
          }
          flatList.push({
            name: draft.name,
            fullPath: `${draftsDir}${sep}${draft.name}`,
            relativePath,
            isFile: true,
            isDraft: true,
          });
          fileIndexByRelativePath.set(relativePath, flatList.length - 1);
        }
      }

      flatList.sort((a, b) => a.name.localeCompare(b.name));
      setFiles(flatList);
    } catch (error) {
      console.error('[useWorkspaceFiles] Failed to load workspace files:', error);
    } finally {
      loadingRef.current = false;
    }
  }, [workspace, conversationId, conversationType]);

  // Initial load
  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  // Listen for file system changes (dirChanged) to auto-refresh on delete/rename
  // 监听文件系统变更事件，文件删除/重命名后自动刷新列表
  useEffect(() => {
    if (!workspace) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const lastRefreshRef = { current: 0 };
    const COOLDOWN_MS = 1000;

    const unsubscribe = ipcBridge.fileWatch.dirChanged.on(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (Date.now() - lastRefreshRef.current < COOLDOWN_MS) return;
        lastRefreshRef.current = Date.now();
        void loadFiles();
      }, 300);
    });

    return () => {
      unsubscribe();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [workspace, loadFiles]);

  // Listen for workspace refresh events (when agent creates/modifies files)
  useAddEventListener(
    'acp.workspace.refresh',
    () => {
      if (conversationType === 'acp') {
        void loadFiles();
      }
    },
    [conversationType, loadFiles]
  );

  // remote-agent 会话：发送后刷新（上传的文件已随消息写入 moss 服务端工作区）
  useAddEventListener(
    'remote-agent.workspace.refresh',
    () => {
      if (conversationType === 'remote-agent') {
        void loadFiles();
      }
    },
    [conversationType, loadFiles]
  );

  // remote-agent 会话：按消息流刷新（agent 生成文件后 content/finish 时重载，
  // 对齐右侧 moss 工作区面板的刷新语义，300ms debounce）
  useEffect(() => {
    if (conversationType !== 'remote-agent') return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = ipcBridge.conversation.responseStream.on((message) => {
      if (message.conversation_id !== conversationId) return;
      if (message.type !== 'content' && message.type !== 'finish') return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void loadFiles();
      }, 300);
    });

    return () => {
      unsubscribe();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [conversationType, conversationId, loadFiles]);

  return files;
}
