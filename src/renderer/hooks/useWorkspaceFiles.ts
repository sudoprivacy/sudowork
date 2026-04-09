/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IDirOrFile } from '@/common/ipcBridge';
import type { FileItem } from '@/renderer/hooks/useSkillSelectorController';
import { emitter } from '@/renderer/utils/emitter';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Flatten an IDirOrFile tree into a flat list of FileItem (files only, no directories).
 */
function flattenFiles(nodes: IDirOrFile[], prefix = ''): FileItem[] {
  const result: FileItem[] = [];
  for (const node of nodes) {
    const relativePath = prefix ? `${prefix}/${node.name}` : node.relativePath || node.name;
    if (node.isFile) {
      result.push({
        relativePath,
        name: node.name,
        isDir: false,
      });
    }
    if (node.children && node.children.length > 0) {
      result.push(...flattenFiles(node.children, relativePath));
    }
  }
  return result;
}

/**
 * Hook to fetch workspace files for @ mention file references.
 * Uses ipcBridge.conversation.getWorkspace to fetch the file tree of the workspace.
 *
 * @param conversationId - The conversation ID
 * @param workspace - The workspace directory path
 */
export function useWorkspaceFiles(conversationId: string | undefined, workspace: string | undefined): FileItem[] {
  const [files, setFiles] = useState<FileItem[]>([]);
  const loadSeqRef = useRef(0);

  const loadFiles = useCallback(() => {
    if (!conversationId || !workspace) {
      setFiles([]);
      return;
    }

    const seq = ++loadSeqRef.current;

    ipcBridge.conversation.getWorkspace
      .invoke({
        conversation_id: conversationId,
        workspace,
        path: workspace,
        search: '',
      })
      .then((res) => {
        // Ignore stale responses
        if (seq !== loadSeqRef.current) return;

        if (res && res.length > 0) {
          // The response is a tree with a root node; flatten children
          const root = res[0];
          const children = root?.children ?? [];
          setFiles(flattenFiles(children));
        } else {
          setFiles([]);
        }
      })
      .catch(() => {
        if (seq === loadSeqRef.current) {
          setFiles([]);
        }
      });
  }, [conversationId, workspace]);

  // Load files on mount and when workspace changes
  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Listen for workspace refresh events
  useEffect(() => {
    if (!conversationId || !workspace) return;

    const handler = () => {
      loadFiles();
    };

    // Listen for the acp.workspace.refresh event emitted after file operations
    emitter.on('acp.workspace.refresh', handler);

    return () => {
      emitter.off('acp.workspace.refresh', handler);
    };
  }, [conversationId, workspace, loadFiles]);

  return files;
}

/**
 * Hook to fetch files from a specific directory path (for GuidPage).
 * Uses ipcBridge fs.getFilesByDir to fetch files.
 *
 * @param dir - The directory path to list files from
 */
export function useDirectoryFiles(dir: string | undefined): FileItem[] {
  const [files, setFiles] = useState<FileItem[]>([]);
  const loadSeqRef = useRef(0);

  useEffect(() => {
    if (!dir) {
      setFiles([]);
      return;
    }

    const seq = ++loadSeqRef.current;

    ipcBridge.fs.getFilesByDir
      .invoke({ dir, root: dir })
      .then((res) => {
        if (seq !== loadSeqRef.current) return;

        if (res && res.length > 0) {
          const root = res[0];
          const children = root?.children ?? [];
          setFiles(flattenFiles(children));
        } else {
          setFiles([]);
        }
      })
      .catch(() => {
        if (seq === loadSeqRef.current) {
          setFiles([]);
        }
      });
  }, [dir]);

  return files;
}
