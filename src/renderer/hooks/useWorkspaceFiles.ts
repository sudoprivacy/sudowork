/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IDirOrFile } from '@/common/ipcBridge';
import { emitter, useAddEventListener } from '@/renderer/utils/emitter';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Flattened workspace file item for mention dropdown
 */
export interface WorkspaceFileItem {
  /** File name (e.g. "main.ts") */
  name: string;
  /** Path relative to workspace root (e.g. "src/main.ts") */
  relativePath: string;
}

/**
 * Flatten nested IDirOrFile tree into a flat list of files (excludes directories)
 */
function flattenFiles(items: IDirOrFile[]): WorkspaceFileItem[] {
  const result: WorkspaceFileItem[] = [];
  const walk = (nodes: IDirOrFile[]) => {
    for (const node of nodes) {
      if (node.isFile) {
        result.push({
          name: node.name,
          relativePath: node.relativePath,
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
 * Hook that fetches and provides workspace files for the @ mention dropdown.
 *
 * @param workspace - Workspace directory path
 * @param conversationId - Conversation ID (used for workspace API calls)
 */
export function useWorkspaceFiles(workspace: string | undefined, conversationId?: string) {
  const [files, setFiles] = useState<WorkspaceFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const loadSeqRef = useRef(0);

  const loadFiles = useCallback(async () => {
    if (!workspace) {
      setFiles([]);
      return;
    }
    const seq = ++loadSeqRef.current;
    setLoading(true);
    try {
      const res = await ipcBridge.conversation.getWorkspace.invoke({
        conversation_id: conversationId || '',
        workspace,
        path: workspace,
      });
      // Ignore stale responses
      if (seq !== loadSeqRef.current) return;
      setFiles(flattenFiles(res));
    } catch {
      if (seq === loadSeqRef.current) {
        setFiles([]);
      }
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, [workspace, conversationId]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  // Refresh when workspace files change (agent generates files, etc.)
  useAddEventListener(
    'acp.workspace.refresh',
    () => {
      void loadFiles();
    },
    [loadFiles]
  );

  return { files, loading, refreshFiles: loadFiles };
}
