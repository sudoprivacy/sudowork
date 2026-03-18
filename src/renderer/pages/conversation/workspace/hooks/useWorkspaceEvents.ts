/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IDirOrFile } from '@/common/ipcBridge';
import { emitter, useAddEventListener } from '@/renderer/utils/emitter';
import { useEffect } from 'react';
import type { ContextMenuState } from '../types';

interface UseWorkspaceEventsOptions {
  conversation_id: string;
  eventPrefix: 'gemini' | 'acp' | 'codex' | 'openclaw-gateway';

  // Dependencies from useWorkspaceTree
  refreshWorkspace: () => void;
  clearSelection: () => void;
  setFiles: React.Dispatch<React.SetStateAction<IDirOrFile[]>>;
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
  setExpandedKeys: React.Dispatch<React.SetStateAction<string[]>>;
  setTreeKey: React.Dispatch<React.SetStateAction<number>>;
  selectedNodeRef: React.MutableRefObject<{ relativePath: string; fullPath: string } | null>;
  selectedKeysRef: React.MutableRefObject<string[]>;

  // Dependencies from useWorkspaceModals
  closeContextMenu: () => void;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState>>;
  closeRenameModal: () => void;
  closeDeleteModal: () => void;
}

/**
 * useWorkspaceEvents - 管理所有事件监听器
 * Manage all event listeners
 */
export function useWorkspaceEvents(options: UseWorkspaceEventsOptions) {
  const { conversation_id, eventPrefix, refreshWorkspace, clearSelection, setFiles, setSelected, setExpandedKeys, setTreeKey, selectedNodeRef, selectedKeysRef, closeContextMenu, setContextMenu, closeRenameModal, closeDeleteModal } = options;

  /**
   * 监听对话切换事件 - 重置所有状态
   * Listen to conversation switch event - reset all states
   */
  useEffect(() => {
    setFiles([]);
    setSelected([]);
    setExpandedKeys([]);
    selectedNodeRef.current = null;
    selectedKeysRef.current = [];
    setTreeKey(Math.random());
    setContextMenu({ visible: false, x: 0, y: 0, node: null });
    closeRenameModal();
    closeDeleteModal();
    refreshWorkspace();
    if (eventPrefix === 'openclaw-gateway') {
      emitter.emit('openclaw-gateway.selected.file', conversation_id, []);
    } else {
      emitter.emit(`${eventPrefix}.selected.file` as 'gemini.selected.file' | 'acp.selected.file' | 'codex.selected.file' | 'nanobot.selected.file', []);
    }
  }, [conversation_id, eventPrefix]); // Only depend on conversation_id to avoid infinite loop

  /**
   * 监听 Agent 响应流 - 自动刷新工作空间
   * Listen to agent response stream - auto refresh workspace
   * OpenClaw uses ACP protocol, emits acp_tool_call on tool calls
   */
  useEffect(() => {
    const handleGeminiResponse = (data: { type: string }) => {
      if (data.type === 'tool_group' || data.type === 'tool_call') {
        refreshWorkspace();
      }
    };
    const handleAcpResponse = (data: { type: string }) => {
      if (data.type === 'acp_tool_call') {
        refreshWorkspace();
      }
    };
    const handleCodexResponse = (data: { type: string }) => {
      if (data.type === 'codex_tool_call') {
        refreshWorkspace();
      }
    };
    const handleOpenClawResponse = (data: { type: string }) => {
      if (data.type === 'acp_tool_call') {
        refreshWorkspace();
      }
    };
    const unsubscribeGemini = ipcBridge.geminiConversation.responseStream.on(handleGeminiResponse);
    const unsubscribeAcp = ipcBridge.acpConversation.responseStream.on(handleAcpResponse);
    const unsubscribeCodex = ipcBridge.codexConversation.responseStream.on(handleCodexResponse);
    const unsubscribeOpenClaw = ipcBridge.openclawConversation.responseStream.on(handleOpenClawResponse);

    return () => {
      unsubscribeGemini();
      unsubscribeAcp();
      unsubscribeCodex();
      unsubscribeOpenClaw();
    };
  }, []); // Empty dependency - event listeners are stable, refreshWorkspace is captured from closure

  /**
   * 监听手动刷新工作空间事件
   * Listen to manual refresh workspace event
   */
  useAddEventListener(`${eventPrefix}.workspace.refresh`, () => refreshWorkspace(), [refreshWorkspace]);

  /**
   * 监听清空选中文件事件（发送消息后）
   * Listen to clear selected files event (after sending message)
   */
  useAddEventListener(`${eventPrefix}.selected.file.clear`, () => clearSelection(), [clearSelection]);

  /**
   * 监听选中文件变化事件（sendbox 中关闭标签时同步状态）(#1083)
   * Listen to selected files change event (sync state when closing tags in sendbox)
   * OpenClaw uses (conversation_id, items) format; others use (items) only.
   */
  useAddEventListener(
    `${eventPrefix}.selected.file`,
    (...args: [Array<{ path: string; name: string; isFile: boolean; relativePath?: string }>] | [string, Array<{ path: string; name: string; isFile: boolean; relativePath?: string }>]) => {
      const items = eventPrefix === 'openclaw-gateway' ? (args[1] as Array<{ path: string; name: string; isFile: boolean; relativePath?: string }>) : (args[0] as Array<{ path: string; name: string; isFile: boolean; relativePath?: string }>);
      if (!Array.isArray(items)) return;
      if (eventPrefix === 'openclaw-gateway' && args[0] !== conversation_id) return;

      // Extract relative paths from items, filter out files (only keep folders in tree selection)
      // 从 items 中提取相对路径，过滤掉文件（树选中状态只保留文件夹）
      const newKeys = items.filter((item) => !item.isFile && item.relativePath).map((item) => item.relativePath!);
      setSelected(newKeys);
      selectedKeysRef.current = newKeys;

      // Update selectedNodeRef based on items
      // 根据 items 更新 selectedNodeRef
      const folders = items.filter((item) => !item.isFile);
      if (folders.length > 0) {
        const lastFolder = folders[folders.length - 1];
        selectedNodeRef.current = lastFolder.relativePath
          ? {
              relativePath: lastFolder.relativePath,
              fullPath: lastFolder.path,
            }
          : null;
      } else {
        selectedNodeRef.current = null;
      }
    },
    [eventPrefix, conversation_id, setSelected, selectedKeysRef, selectedNodeRef]
  );

  /**
   * 监听搜索工作空间响应
   * Listen to search workspace response
   */
  useEffect(() => {
    return ipcBridge.conversation.responseSearchWorkSpace.provider((data) => {
      if (data.match) setFiles([data.match]);
      return Promise.resolve();
    });
  }, [setFiles]);

  /**
   * 监听右键菜单外部点击 - 关闭菜单
   * Listen to clicks outside context menu - close menu
   */
  useEffect(() => {
    const handleClose = () => {
      closeContextMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu();
      }
    };
    window.addEventListener('click', handleClose);
    window.addEventListener('scroll', handleClose, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleClose);
      window.removeEventListener('scroll', handleClose, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeContextMenu]);
}
