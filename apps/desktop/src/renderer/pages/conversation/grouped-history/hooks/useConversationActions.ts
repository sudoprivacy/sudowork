/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Checkbox, Message, Modal } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import type { TChatConversation } from '@sudowork/common/storage';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { emitter } from '@/renderer/utils/emitter';
import { useConversationTabs } from '../../context/ConversationTabsContext';
import type { SidebarTabKey } from '../types';
import { isConversationPinned } from '../utils/groupingHelpers';

type UseConversationActionsParams = {
  batchMode: boolean;
  onSessionClick?: () => void;
  onBatchModeChange?: (value: boolean) => void;
  selectedConversationIds: Set<string>;
  setSelectedConversationIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  toggleSelectedConversation: (conversation: TChatConversation) => void;
  markAsRead: (conversationId: string) => void;
  activeTab: SidebarTabKey;
};

/**
 * Unified conversation actions hook
 *
 * All operations now go through Provider abstraction layer:
 * - ipcBridge.conversation.remove → Provider.deleteConversation
 * - ipcBridge.conversation.update → Provider.updateConversation
 *
 * Enterprise mode (remote-agent) conversations are cached locally,
 * so all UI operations work the same way.
 */
export const useConversationActions = ({ batchMode, onSessionClick, onBatchModeChange, selectedConversationIds, setSelectedConversationIds, toggleSelectedConversation, markAsRead, activeTab }: UseConversationActionsParams) => {
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameModalName, setRenameModalName] = useState<string>('');
  const [renameModalId, setRenameModalId] = useState<string | null>(null);
  const [renameLoading, setRenameLoading] = useState(false);
  const [dropdownVisibleId, setDropdownVisibleId] = useState<string | null>(null);
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { openTab, closeAllTabs, activeTab: conversationTab, updateTabName } = useConversationTabs();

  // Close dropdown when entering batch mode
  useEffect(() => {
    if (batchMode) {
      setDropdownVisibleId(null);
    }
  }, [batchMode]);

  const handleConversationClick = useCallback(
    async (conversation: TChatConversation) => {
      setDropdownVisibleId(null);
      if (batchMode) {
        toggleSelectedConversation(conversation);
        return;
      }

      const customWorkspace = conversation.extra?.customWorkspace;
      const newWorkspace = conversation.extra?.workspace;

      markAsRead(conversation.id);

      if (!customWorkspace) {
        closeAllTabs();
        void navigate(`/conversation/${conversation.id}`);
        if (onSessionClick) {
          onSessionClick();
        }
        return;
      }

      const currentWorkspace = conversationTab?.workspace;
      if (!currentWorkspace || currentWorkspace !== newWorkspace) {
        closeAllTabs();
      }

      openTab(conversation);
      void navigate(`/conversation/${conversation.id}`);
      if (onSessionClick) {
        onSessionClick();
      }
    },
    [batchMode, toggleSelectedConversation, markAsRead, closeAllTabs, navigate, onSessionClick, conversationTab, openTab]
  );

  /**
   * Remove conversation - unified for both local and enterprise mode
   * Goes through Provider abstraction layer
   */
  const removeConversation = useCallback(
    async (conversation: TChatConversation, deleteWorkspace?: boolean) => {
      const success = await ipcBridge.conversation.remove.invoke({ id: conversation.id, deleteWorkspace });
      if (!success) {
        return false;
      }

      // Tear down any Dify enhancement binding for this conversation.
      // Non-blocking and idempotent; safe to call regardless of binding state.
      try {
        const { unbindAssistantSession } = await import('@/renderer/shared/dify/sessionBinding');
        void unbindAssistantSession(conversation.id);
      } catch {
        /* best-effort */
      }

      emitter.emit('conversation.deleted', conversation.id);
      if (id === conversation.id) {
        void navigate('/');
      }
      return true;
    },
    [id, navigate]
  );

  const handleDeleteClick = useCallback(
    (conversation: TChatConversation) => {
      // Only offer the "delete workspace folder" checkbox for user-selected
      // project folders (customWorkspace === true). Auto temp scratch dirs are
      // reaped silently by the main process (deleteWorkspace stays undefined).
      const extra = conversation.extra as { workspace?: string; customWorkspace?: boolean } | undefined;
      const showWorkspaceCheckbox = extra?.customWorkspace === true && !!extra?.workspace;
      const deleteWorkspaceRef = { current: false };

      Modal.confirm({
        title: t('conversation.history.deleteTitle'),
        content: React.createElement(
          'div',
          null,
          React.createElement('div', null, t('conversation.history.deleteConfirm')),
          showWorkspaceCheckbox &&
            React.createElement(
              Checkbox,
              {
                onChange: (checked: boolean) => {
                  deleteWorkspaceRef.current = checked;
                },
                style: { marginTop: 12 },
              },
              t('conversation.history.deleteWorkspaceOption')
            )
        ),
        okText: t('conversation.history.confirmDelete'),
        cancelText: t('conversation.history.cancelDelete'),
        okButtonProps: { status: 'warning' },
        onOk: async () => {
          try {
            const success = await removeConversation(conversation, showWorkspaceCheckbox ? deleteWorkspaceRef.current : undefined);
            if (success) {
              emitter.emit('chat.history.refresh');
              Message.success(t('conversation.history.deleteSuccess'));
            } else {
              Message.error(t('conversation.history.deleteFailed'));
            }
          } catch (error) {
            console.error('Failed to remove conversation:', error);
            Message.error(t('conversation.history.deleteFailed'));
          }
        },
        style: { borderRadius: '12px' },
        alignCenter: true,
        getPopupContainer: () => document.body,
      });
    },
    [removeConversation, t]
  );

  const handleBatchDelete = useCallback(
    (conversations: TChatConversation[]) => {
      if (selectedConversationIds.size === 0) {
        Message.warning(t('conversation.history.batchNoSelection'));
        return;
      }

      const selectedIds = Array.from(selectedConversationIds);
      const selectedConvs = conversations.filter((c) => selectedIds.includes(c.id));
      // Checkbox applies only to user-selected custom folders; temp scratch dirs
      // are reaped silently regardless.
      const isCustomWorkspace = (c: TChatConversation) => {
        const extra = c.extra as { workspace?: string; customWorkspace?: boolean } | undefined;
        return extra?.customWorkspace === true && !!extra?.workspace;
      };
      const hasAnyCustomWorkspace = selectedConvs.some(isCustomWorkspace);
      const deleteWorkspaceRef = { current: false };

      Modal.confirm({
        title: t('conversation.history.batchDelete'),
        content: React.createElement(
          'div',
          null,
          React.createElement('div', null, t('conversation.history.batchDeleteConfirm', { count: selectedConversationIds.size })),
          hasAnyCustomWorkspace &&
            React.createElement(
              Checkbox,
              {
                onChange: (checked: boolean) => {
                  deleteWorkspaceRef.current = checked;
                },
                style: { marginTop: 12 },
              },
              t('conversation.history.deleteWorkspaceOption')
            )
        ),
        okText: t('conversation.history.confirmDelete'),
        cancelText: t('conversation.history.cancelDelete'),
        okButtonProps: { status: 'warning' },
        onOk: async () => {
          try {
            const results = await Promise.all(selectedConvs.map((conv) => removeConversation(conv, isCustomWorkspace(conv) ? deleteWorkspaceRef.current : undefined)));
            const successCount = results.filter(Boolean).length;
            if (successCount > 0) {
              emitter.emit('chat.history.refresh');
              Message.success(t('conversation.history.batchDeleteSuccess', { count: successCount }));
            } else {
              Message.error(t('conversation.history.deleteFailed'));
            }
          } catch (error) {
            console.error('Failed to batch delete conversations:', error);
            Message.error(t('conversation.history.deleteFailed'));
          } finally {
            setSelectedConversationIds(new Set());
            onBatchModeChange?.(false);
          }
        },
        style: { borderRadius: '12px' },
        alignCenter: true,
        getPopupContainer: () => document.body,
      });
    },
    [onBatchModeChange, removeConversation, selectedConversationIds, t, setSelectedConversationIds]
  );

  const handleEditStart = useCallback((conversation: TChatConversation) => {
    setRenameModalId(conversation.id);
    setRenameModalName(conversation.name);
    setRenameModalVisible(true);
  }, []);

  /**
   * Rename conversation - unified for both local and enterprise mode
   * Goes through Provider abstraction layer
   * Remote-agent conversations cache name locally
   */
  const handleRenameConfirm = useCallback(async () => {
    if (!renameModalId || !renameModalName.trim()) return;

    setRenameLoading(true);
    try {
      const success = await ipcBridge.conversation.update.invoke({
        id: renameModalId,
        updates: { name: renameModalName.trim() },
      });

      if (success) {
        updateTabName(renameModalId, renameModalName.trim());
        emitter.emit('chat.history.refresh');
        setRenameModalVisible(false);
        setRenameModalId(null);
        setRenameModalName('');
        Message.success(t('conversation.history.renameSuccess'));
      } else {
        Message.error(t('conversation.history.renameFailed'));
      }
    } catch (error) {
      console.error('Failed to update conversation name:', error);
      Message.error(t('conversation.history.renameFailed'));
    } finally {
      setRenameLoading(false);
    }
  }, [renameModalId, renameModalName, updateTabName, t]);

  const handleRenameCancel = useCallback(() => {
    setRenameModalVisible(false);
    setRenameModalId(null);
    setRenameModalName('');
  }, []);

  /**
   * Toggle pin - unified for both local and enterprise mode
   * Goes through Provider abstraction layer
   * Remote-agent conversations cache pin status locally
   */
  const handleTogglePin = useCallback(
    async (conversation: TChatConversation) => {
      const pinned = isConversationPinned(conversation);

      try {
        const success = await ipcBridge.conversation.update.invoke({
          id: conversation.id,
          updates: {
            extra: {
              pinned: !pinned,
              pinnedAt: pinned ? undefined : Date.now(),
              pinnedTab: !pinned ? activeTab : undefined,
            } as Partial<TChatConversation['extra']>,
          } as Partial<TChatConversation>,
          mergeExtra: true,
        });

        if (success) {
          emitter.emit('chat.history.refresh');
        } else {
          Message.error(t('conversation.history.pinFailed'));
        }
      } catch (error) {
        console.error('Failed to toggle pin conversation:', error);
        Message.error(t('conversation.history.pinFailed'));
      }
    },
    [t, activeTab]
  );

  const handleMenuVisibleChange = useCallback((conversationId: string, visible: boolean) => {
    setDropdownVisibleId(visible ? conversationId : null);
  }, []);

  const handleOpenMenu = useCallback((conversation: TChatConversation) => {
    setDropdownVisibleId(conversation.id);
  }, []);

  return {
    renameModalVisible,
    renameModalName,
    setRenameModalName,
    renameLoading,
    dropdownVisibleId,
    handleConversationClick,
    handleDeleteClick,
    handleBatchDelete,
    handleEditStart,
    handleRenameConfirm,
    handleRenameCancel,
    handleTogglePin,
    handleMenuVisibleChange,
    handleOpenMenu,
  };
};
