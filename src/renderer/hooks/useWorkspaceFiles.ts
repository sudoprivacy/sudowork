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

export type WorkspaceFileItem = {
  name: string;
  relativePath: string;
  fullPath: string;
  isDir: boolean;
};

/**
 * Recursively flatten an IDirOrFile tree into a flat list of file items
 * 将 IDirOrFile 树递归展平为文件列表
 */
function flattenFileTree(items: IDirOrFile[], result: WorkspaceFileItem[] = []): WorkspaceFileItem[] {
  for (const item of items) {
    if (item.isFile) {
      result.push({
        name: item.name,
        relativePath: item.relativePath,
        fullPath: item.fullPath,
        isDir: false,
      });
    }
    if (item.children && item.children.length > 0) {
      flattenFileTree(item.children, result);
    }
  }
  return result;
}

/**
 * Hook to fetch workspace files from the conversation's temporary workspace
 * 获取会话临时空间中的文件列表
 */
export function useWorkspaceFiles(): WorkspaceFileItem[] {
  const ctx = useConversationContextSafe();
  const [files, setFiles] = useState<WorkspaceFileItem[]>([]);

  const loadFiles = useCallback(() => {
    if (!ctx?.workspace || !ctx?.conversationId) return;
    ipcBridge.conversation.getWorkspace
      .invoke({
        path: ctx.workspace,
        workspace: ctx.workspace,
        conversation_id: ctx.conversationId,
      })
      .then((res) => {
        const flatFiles = flattenFileTree(res);
        setFiles(flatFiles);
      })
      .catch((err) => {
        console.error('[useWorkspaceFiles] Failed to load workspace files:', err);
      });
  }, [ctx?.workspace, ctx?.conversationId]);

  // Load on mount and when workspace/conversation changes
  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Auto-refresh when workspace files change (agent creates/modifies files)
  useAddEventListener('acp.workspace.refresh', loadFiles, [loadFiles]);
  useAddEventListener('openclaw-gateway.workspace.refresh', loadFiles, [loadFiles]);

  return files;
}
