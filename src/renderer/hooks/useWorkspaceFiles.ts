/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import type { IDirOrFile } from '@/common/ipcBridge';
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
      const result = await ipcBridge.fs.getFilesByDir.invoke({ dir: workspace, root: workspace });
      const flatList = result && result.length > 0 && result[0].children ? flattenFileTree(result[0].children) : [];
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

  // Listen to file system watcher events for real-time updates when files are
  // created, modified, or deleted outside of emitter-based flows (e.g. agent
  // tool calls, external editors, OS-level file operations).
  // Uses debounce to avoid excessive re-fetches during burst changes.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshAtRef = useRef(0);

  useEffect(() => {
    if (!workspace) return;
    const COOLDOWN_MS = 1000;

    const unsubscribe = ipcBridge.fileWatch.dirChanged.on(() => {
      // Debounce: skip if we refreshed recently
      if (Date.now() - lastRefreshAtRef.current < COOLDOWN_MS) return;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        lastRefreshAtRef.current = Date.now();
        void loadFiles();
      }, 300);
    });

    return () => {
      unsubscribe();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [workspace, loadFiles]);

  return files;
}
