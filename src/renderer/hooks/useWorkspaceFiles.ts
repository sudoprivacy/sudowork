/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IDirOrFile } from '@/common/ipcBridge';
import { emitter } from '@/renderer/utils/emitter';
import type { FileItem } from './useSkillSelectorController';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Flatten an IDirOrFile tree into a flat FileItem list.
 * Only includes files (not directories).
 */
function flattenFiles(items: IDirOrFile[]): FileItem[] {
  const result: FileItem[] = [];
  const walk = (nodes: IDirOrFile[]) => {
    for (const node of nodes) {
      if (node.isFile) {
        result.push({
          name: node.name,
          relativePath: node.relativePath,
          fullPath: node.fullPath,
          isDir: false,
        });
      }
      if (node.children) {
        walk(node.children);
      }
    }
  };
  walk(items);
  return result;
}

/**
 * Hook to fetch workspace files for @ mention in conversation sendbox.
 * Uses ipcBridge.conversation.getWorkspace to fetch the file tree,
 * then flattens it into a FileItem list.
 *
 * Listens for workspace refresh events to keep the list up to date.
 */
export function useWorkspaceFiles(conversationId: string, workspace: string | undefined, eventPrefix: 'acp' | 'openclaw-gateway'): FileItem[] {
  const [files, setFiles] = useState<FileItem[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const loadFiles = useCallback(async () => {
    if (!workspace || !conversationId) {
      setFiles([]);
      return;
    }

    // Abort any previous request
    if (abortRef.current) {
      abortRef.current.abort();
    }
    abortRef.current = new AbortController();

    try {
      const result = await ipcBridge.conversation.getWorkspace.invoke({
        conversation_id: conversationId,
        workspace,
        path: '',
      });
      if (result) {
        setFiles(flattenFiles(result));
      }
    } catch (err) {
      // Silently ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('[useWorkspaceFiles] Failed to load workspace files:', err);
    }
  }, [conversationId, workspace]);

  // Initial load
  useEffect(() => {
    void loadFiles();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadFiles]);

  // Listen for workspace refresh events
  useEffect(() => {
    const refreshEvent = `${eventPrefix}.workspace.refresh` as const;
    const handler = () => {
      void loadFiles();
    };
    emitter.on(refreshEvent, handler);
    return () => {
      emitter.off(refreshEvent, handler);
    };
  }, [eventPrefix, loadFiles]);

  return files;
}
