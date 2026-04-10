/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IDirOrFile } from '@/common/ipcBridge';
import { useConversationContextSafe } from '@/renderer/context/ConversationContext';
import { useAddEventListener } from '@/renderer/utils/emitter';
import { useCallback, useEffect, useState } from 'react';

export interface WorkspaceFileItem {
  name: string;
  relativePath: string;
  fullPath: string;
}

/**
 * Flatten IDirOrFile tree into a flat list of file items (files only)
 */
function flattenDirOrFile(nodes: IDirOrFile[], result: WorkspaceFileItem[] = []): WorkspaceFileItem[] {
  for (const node of nodes) {
    if (node.isFile) {
      result.push({
        name: node.name,
        relativePath: node.relativePath,
        fullPath: node.fullPath,
      });
    }
    if (node.children && node.children.length > 0) {
      flattenDirOrFile(node.children, result);
    }
  }
  return result;
}

/**
 * Hook to fetch workspace files for @ mention file references in conversation pages.
 * Uses ConversationContext to get workspace path and conversation ID.
 */
export function useWorkspaceFiles(): WorkspaceFileItem[] {
  const context = useConversationContextSafe();
  const [files, setFiles] = useState<WorkspaceFileItem[]>([]);

  const fetchFiles = useCallback(async () => {
    if (!context?.workspace || !context?.conversationId) {
      setFiles([]);
      return;
    }
    try {
      const res = await ipcBridge.conversation.getWorkspace.invoke({
        conversation_id: context.conversationId,
        workspace: context.workspace,
        path: context.workspace,
        search: '',
      });
      const allFiles = flattenDirOrFile(res);
      setFiles(allFiles);
    } catch (err) {
      console.error('[useWorkspaceFiles] Failed to fetch workspace files:', err);
      setFiles([]);
    }
  }, [context?.workspace, context?.conversationId]);

  useEffect(() => {
    void fetchFiles();
  }, [fetchFiles]);

  // Listen for workspace refresh events to automatically update file list
  useAddEventListener('acp.workspace.refresh', () => void fetchFiles(), [fetchFiles]);
  useAddEventListener('openclaw-gateway.workspace.refresh', () => void fetchFiles(), [fetchFiles]);

  return files;
}
