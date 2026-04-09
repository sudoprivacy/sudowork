/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import type { IDirOrFile } from '@/common/ipcBridge';
import { useAddEventListener } from '@/renderer/utils/emitter';

export type FileItem = {
  name: string;
  relativePath: string;
  fullPath: string;
};

/**
 * Flatten IDirOrFile tree to a flat list of files (excluding directories)
 * 将 IDirOrFile 树展平为文件列表（排除目录）
 */
function flattenFiles(items: IDirOrFile[]): FileItem[] {
  const result: FileItem[] = [];
  for (const item of items) {
    if (item.isFile) {
      result.push({
        name: item.name,
        relativePath: item.relativePath || item.name,
        fullPath: item.fullPath,
      });
    }
    if (item.children && item.children.length > 0) {
      result.push(...flattenFiles(item.children));
    }
  }
  return result;
}

/**
 * Hook to fetch workspace files for @ mention file references
 * 获取工作空间文件列表，用于 @ 引用文件
 */
export function useWorkspaceFiles(conversationId: string): FileItem[] {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [workspace, setWorkspace] = useState('');

  // Fetch workspace path from conversation metadata
  // 从会话元数据获取工作空间路径
  useEffect(() => {
    if (!conversationId) return;
    void ipcBridge.conversation.get.invoke({ id: conversationId }).then((res) => {
      if (res?.extra?.workspace) {
        setWorkspace(res.extra.workspace);
      }
    });
  }, [conversationId]);

  const fetchFiles = useCallback(async () => {
    if (!conversationId || !workspace) {
      setFiles([]);
      return;
    }
    try {
      const res = await ipcBridge.conversation.getWorkspace.invoke({
        conversation_id: conversationId,
        workspace,
        path: workspace,
        search: '',
      });
      if (res && res.length > 0) {
        setFiles(flattenFiles(res));
      } else {
        setFiles([]);
      }
    } catch (err) {
      console.error('[useWorkspaceFiles] Failed to fetch workspace files:', err);
      setFiles([]);
    }
  }, [conversationId, workspace]);

  // Fetch on mount and when dependencies change
  useEffect(() => {
    void fetchFiles();
  }, [fetchFiles]);

  // Listen for workspace refresh events (both acp and openclaw-gateway)
  // 监听工作空间刷新事件（ACP 和 OpenClaw）
  useAddEventListener('acp.workspace.refresh', () => void fetchFiles(), [fetchFiles]);
  useAddEventListener('openclaw-gateway.workspace.refresh', () => void fetchFiles(), [fetchFiles]);

  return files;
}
