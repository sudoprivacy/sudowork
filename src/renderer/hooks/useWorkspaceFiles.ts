/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import type { IDirOrFile } from '@/common/ipcBridge';
import { DRAFTS_DIR_NAME } from '@/common/constants';
import { useConversationContextSafe } from '@/renderer/context/ConversationContext';
import { useAddEventListener } from '@/renderer/utils/emitter';

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
    if (node.isFile) {
      result.push({
        name: node.name,
        fullPath: node.fullPath,
        relativePath: node.relativePath,
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
 * Uses ipcBridge.fs.getFilesByDir (more reliable than conversation.getWorkspace).
 * Listens for workspace refresh events to auto-update.
 */
export function useWorkspaceFiles(): WorkspaceFileItem[] {
  const conversationContext = useConversationContextSafe();
  const workspace = conversationContext?.workspace;
  const conversationType = conversationContext?.type;
  const [files, setFiles] = useState<WorkspaceFileItem[]>([]);
  const loadingRef = useRef(false);

  const loadFiles = useCallback(async () => {
    if (!workspace || loadingRef.current) return;
    loadingRef.current = true;
    try {
      // Fetch workspace files and draft files in parallel
      // 并行获取工作空间文件和草稿箱文件
      const [result, draftsResult] = await Promise.all([
        ipcBridge.fs.getFilesByDir.invoke({ dir: workspace, root: workspace }),
        ipcBridge.workspaceManage.listDrafts.invoke({ workspace }).catch(() => null),
      ]);

      const flatList = result && result.length > 0 && result[0].children ? flattenFileTree(result[0].children) : [];

      // Merge draft files into the list with isDraft flag
      // 将草稿箱文件合并到列表中，标记 isDraft
      if (draftsResult?.success && draftsResult.data && draftsResult.data.length > 0) {
        const sep = workspace.includes('\\') ? '\\' : '/';
        const draftsDir = `${workspace}${sep}${DRAFTS_DIR_NAME}`;
        for (const draft of draftsResult.data) {
          flatList.push({
            name: draft.name,
            fullPath: `${draftsDir}${sep}${draft.name}`,
            relativePath: `${DRAFTS_DIR_NAME}/${draft.name}`,
            isFile: true,
            isDraft: true,
          });
        }
      }

      flatList.sort((a, b) => a.name.localeCompare(b.name));
      setFiles(flatList);
    } catch (error) {
      console.error('[useWorkspaceFiles] Failed to load workspace files:', error);
    } finally {
      loadingRef.current = false;
    }
  }, [workspace]);

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

  useAddEventListener(
    'openclaw-gateway.workspace.refresh',
    () => {
      if (conversationType === 'openclaw-gateway') {
        void loadFiles();
      }
    },
    [conversationType, loadFiles]
  );

  return files;
}
