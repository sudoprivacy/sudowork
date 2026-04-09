/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import type { IDirOrFile } from '@/common/ipcBridge';
import { useConversationContextSafe } from '@/renderer/context/ConversationContext';

export interface WorkspaceFileItem {
  name: string;
  relativePath: string;
  fullPath: string;
  isDir: boolean;
}

/**
 * Flatten a file tree into a flat list of file items (files only, no directories)
 */
function flattenFileTree(items: IDirOrFile[], maxItems = 200): WorkspaceFileItem[] {
  const result: WorkspaceFileItem[] = [];

  const traverse = (nodes: IDirOrFile[]) => {
    for (const node of nodes) {
      if (result.length >= maxItems) return;

      if (node.isFile) {
        result.push({
          name: node.name,
          relativePath: node.relativePath,
          fullPath: node.fullPath,
          isDir: false,
        });
      }

      if (node.children) {
        traverse(node.children);
      }
    }
  };

  traverse(items);
  return result;
}

/**
 * Hook to fetch workspace files for @ file references.
 * Uses ConversationContext to get workspace path; returns empty if not available.
 */
export function useWorkspaceFiles(): {
  files: WorkspaceFileItem[];
  loading: boolean;
  refresh: () => Promise<void>;
  hasWorkspace: boolean;
} {
  const context = useConversationContextSafe();
  const [files, setFiles] = useState<WorkspaceFileItem[]>([]);
  const [loading, setLoading] = useState(false);

  const workspace = context?.workspace;
  const conversationId = context?.conversationId;

  const loadFiles = useCallback(async () => {
    if (!workspace || !conversationId) return;

    setLoading(true);
    try {
      const res = await ipcBridge.conversation.getWorkspace.invoke({
        conversation_id: conversationId,
        workspace,
        path: workspace,
      });

      const flatFiles = flattenFileTree(res);
      setFiles(flatFiles);
    } catch (err) {
      console.error('Failed to load workspace files:', err);
    } finally {
      setLoading(false);
    }
  }, [workspace, conversationId]);

  // Load files on mount and when workspace changes
  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  return {
    files,
    loading,
    refresh: loadFiles,
    hasWorkspace: !!workspace,
  };
}

/**
 * Hook to fetch files from a specific directory path (for GuidPage workspace selector).
 * Only activates when a directory path is provided.
 */
export function useDirectoryFiles(dir: string): {
  files: WorkspaceFileItem[];
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [files, setFiles] = useState<WorkspaceFileItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadFiles = useCallback(async () => {
    if (!dir) {
      setFiles([]);
      return;
    }

    setLoading(true);
    try {
      const res = await ipcBridge.fs.getFilesByDir.invoke({ dir, root: dir });
      const flatFiles = flattenFileTree(res);
      setFiles(flatFiles);
    } catch (err) {
      console.error('Failed to load directory files:', err);
    } finally {
      setLoading(false);
    }
  }, [dir]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  return {
    files,
    loading,
    refresh: loadFiles,
  };
}
