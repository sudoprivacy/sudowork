/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button, Empty, Input, Modal } from '@arco-design/web-react';
import { Down, FolderOpen } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import { useCronJobsMap } from '@/renderer/pages/cron/hooks/useCronJobs';
import FlexFullContainer from '@/renderer/components/FlexFullContainer';
import DirectorySelectionModal from '@/renderer/components/DirectorySelectionModal';
import type { TChatConversation } from '@/common/storage';
import WorkspaceCollapse from '../WorkspaceCollapse';
import ConversationRow from './ConversationRow';
import DragOverlayContent from './DragOverlayContent';
import SortableConversationRow from './SortableConversationRow';
import { useBatchSelection } from './hooks/useBatchSelection';
import { useConversationActions } from './hooks/useConversationActions';
import { useConversations } from './hooks/useConversations';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import { useExport } from './hooks/useExport';
import type { ConversationRowProps, ConversationItem, WorkspaceGroupedHistoryProps } from './types';

const WorkspaceGroupedHistory: React.FC<WorkspaceGroupedHistoryProps> = ({ onSessionClick, collapsed = false, tooltipEnabled = false, batchMode = false, onBatchModeChange, activeTab = 'timeline', onBatchApiChange }) => {
  const { id } = useParams();
  const { t } = useTranslation();
  const { getJobStatus, markAsRead, setActiveConversation } = useCronJobsMap();

  // Sync active conversation ref when route changes (for URL navigation)
  // This doesn't trigger state update, avoiding double render
  useEffect(() => {
    if (id) {
      setActiveConversation(id);
    }
  }, [id, setActiveConversation]);

  const { conversations, pinnedTimeline, pinnedScheduled, timelineConversations, scheduledGroups } = useConversations();

  // Select pinned list based on active tab
  const pinnedConversations = activeTab === 'scheduled' ? pinnedScheduled : pinnedTimeline;

  // Filter out pinned conversations from scheduled groups to avoid duplicates
  // Only filter based on pinnedScheduled (pinned in scheduled tab)
  const currentPinnedIds = useMemo(() => new Set(pinnedScheduled.map((c) => c.id)), [pinnedScheduled]);
  const filteredScheduledGroups = useMemo(() => {
    return scheduledGroups
      .map((group) => {
        const conversations = group.conversations.filter((conversation) => !currentPinnedIds.has(conversation.id));
        return {
          ...group,
          conversations,
          latestConversationTime: conversations[0]?.createTime || 0,
        };
      })
      .filter((group) => group.conversations.length > 0)
      .sort((a, b) => {
        const timeDiff = b.latestConversationTime - a.latestConversationTime;
        if (timeDiff !== 0) return timeDiff;
        return b.jobId.localeCompare(a.jobId);
      });
  }, [scheduledGroups, currentPinnedIds]);

  // ── Scheduled section top-level collapse state ──
  const SCHEDULED_SECTION_KEY = 'sudowork_scheduled_section_expanded';
  const [scheduledSectionExpanded, setScheduledSectionExpanded] = React.useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(SCHEDULED_SECTION_KEY);
      if (stored !== null) return JSON.parse(stored) as boolean;
    } catch {
      // ignore
    }
    return false;
  });

  const handleToggleScheduledSection = useCallback(() => {
    setScheduledSectionExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SCHEDULED_SECTION_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const SCHEDULED_EXPANSION_KEY = 'sudowork_scheduled_expansion';
  const [expandedScheduled, setExpandedScheduled] = React.useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(SCHEDULED_EXPANSION_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch {
      // ignore
    }
    // Default: all expanded — will be populated on first render
    return [];
  });

  const handleToggleScheduled = useCallback((jobId: string, jobName: string) => {
    setExpandedScheduled((prev) => {
      const currentKeys = new Set(prev);
      const currentlyExpanded = currentKeys.has(jobId) || currentKeys.has(jobName);

      currentKeys.delete(jobId);
      currentKeys.delete(jobName);

      if (!currentlyExpanded) {
        currentKeys.add(jobId);
      }

      const next = Array.from(currentKeys);
      try {
        localStorage.setItem(SCHEDULED_EXPANSION_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const { selectedConversationIds, setSelectedConversationIds, selectedCount, allSelected, toggleSelectedConversation, handleToggleSelectAll } = useBatchSelection(batchMode, conversations);

  const { renameModalVisible, renameModalName, setRenameModalName, renameLoading, dropdownVisibleId, handleConversationClick, handleDeleteClick, handleBatchDelete, handleEditStart, handleRenameConfirm, handleRenameCancel, handleTogglePin, handleMenuVisibleChange, handleOpenMenu } =
    useConversationActions({
      batchMode,
      activeTab,
      onSessionClick,
      onBatchModeChange,
      selectedConversationIds,
      setSelectedConversationIds,
      toggleSelectedConversation,
      markAsRead,
    });

  const {
    exportTask,
    exportModalVisible,
    exportTargetPath,
    exportModalLoading,
    exportFinished,
    showExportDirectorySelector,
    setShowExportDirectorySelector,
    closeExportModal,
    handleSelectExportDirectoryFromModal,
    handleSelectExportFolder,
    handleExportConversation,
    handleBatchExport,
    handleConfirmExport,
  } = useExport({
    conversations: conversations as TChatConversation[],
    selectedConversationIds,
    setSelectedConversationIds,
    onBatchModeChange,
  });

  const { sensors, activeId, activeConversation, handleDragStart, handleDragEnd, handleDragCancel, isDragEnabled } = useDragAndDrop({
    pinnedConversations: pinnedConversations as TChatConversation[],
    batchMode,
    collapsed,
  });

  // Publish the batch-action API up to the sider so its batch button can render
  // these actions in a popover. Cleared (null) whenever batch mode is off.
  useEffect(() => {
    if (!onBatchApiChange) return;
    if (!batchMode) {
      onBatchApiChange(null);
      return;
    }
    onBatchApiChange({
      selectedCount,
      allSelected,
      onToggleSelectAll: handleToggleSelectAll,
      onBatchExport: handleBatchExport,
      onBatchDelete: () => handleBatchDelete(conversations),
    });
    return () => onBatchApiChange(null);
  }, [onBatchApiChange, batchMode, selectedCount, allSelected, handleToggleSelectAll, handleBatchExport, handleBatchDelete, conversations]);

  const getConversationRowProps = useCallback(
    (conversation: ConversationItem): ConversationRowProps => ({
      conversation,
      collapsed,
      tooltipEnabled,
      batchMode,
      checked: selectedConversationIds.has(conversation.id),
      selected: id === conversation.id,
      menuVisible: dropdownVisibleId === conversation.id,
      onToggleChecked: toggleSelectedConversation,
      onConversationClick: handleConversationClick,
      onOpenMenu: handleOpenMenu,
      onMenuVisibleChange: handleMenuVisibleChange,
      onEditStart: handleEditStart,
      onDelete: handleDeleteClick,
      onExport: handleExportConversation,
      onTogglePin: handleTogglePin,
      getJobStatus,
    }),
    [collapsed, tooltipEnabled, batchMode, selectedConversationIds, id, dropdownVisibleId, toggleSelectedConversation, handleConversationClick, handleOpenMenu, handleMenuVisibleChange, handleEditStart, handleDeleteClick, handleExportConversation, handleTogglePin, getJobStatus]
  );

  const renderConversation = (conversation: ConversationItem) => {
    const rowProps = getConversationRowProps(conversation);
    return <ConversationRow key={conversation.id} {...rowProps} />;
  };

  // Collect all sortable IDs for the pinned section
  const pinnedIds = useMemo(() => pinnedConversations.map((c) => c.id), [pinnedConversations]);

  if (activeTab === 'timeline' && timelineConversations.length === 0 && pinnedConversations.length === 0) {
    return (
      <FlexFullContainer>
        <div className='f-center'>
          <Empty description={t('conversation.history.noHistory')} />
        </div>
      </FlexFullContainer>
    );
  }

  if (activeTab === 'scheduled' && filteredScheduledGroups.length === 0 && pinnedConversations.length === 0) {
    return (
      <FlexFullContainer>
        <div className='f-center'>
          <Empty icon={null} description={t('conversation.history.noScheduledTask')} className='mt-80px' />
        </div>
      </FlexFullContainer>
    );
  }

  return (
    <FlexFullContainer>
      <Modal
        title={t('conversation.history.renameTitle')}
        visible={renameModalVisible}
        onOk={handleRenameConfirm}
        onCancel={handleRenameCancel}
        okText={t('conversation.history.saveName')}
        cancelText={t('conversation.history.cancelEdit')}
        confirmLoading={renameLoading}
        okButtonProps={{ disabled: !renameModalName.trim() }}
        style={{ borderRadius: '12px' }}
        alignCenter
        getPopupContainer={() => document.body}
      >
        <Input autoFocus value={renameModalName} onChange={setRenameModalName} onPressEnter={handleRenameConfirm} placeholder={t('conversation.history.renamePlaceholder')} allowClear />
      </Modal>

      <Modal visible={exportModalVisible} title={t('conversation.history.exportDialogTitle')} onCancel={closeExportModal} footer={null} style={{ borderRadius: '12px' }} className='conversation-export-modal' alignCenter getPopupContainer={() => document.body}>
        <div className='py-8px'>
          <div className='text-base mb-4 text-foreground-secondary'>{exportTask?.mode === 'batch' ? t('conversation.history.exportDialogBatchDescription', { count: exportTask.conversationIds.length }) : t('conversation.history.exportDialogSingleDescription')}</div>

          <div className='mb-4 p-4 rounded-lg bg-fill-default'>
            <div className='text-base mb-2 text-foreground'>{t('conversation.history.exportTargetFolder')}</div>
            <button
              type='button'
              className={classNames('w-full flex items-center justify-between px-3 py-2.5 rounded-md border border-border bg-background text-left transition-colors', exportModalLoading ? 'cursor-not-allowed opacity-55' : 'cursor-pointer hover:border-border-deep')}
              onClick={() => {
                void handleSelectExportFolder();
              }}
              disabled={exportModalLoading}
            >
              <span className={classNames('text-base overflow-hidden text-ellipsis whitespace-nowrap', exportTargetPath ? 'text-foreground' : 'text-foreground-tertiary')}>{exportTargetPath || t('conversation.history.exportSelectFolder')}</span>
              <FolderOpen theme='outline' size='18' fill='currentColor' className='text-foreground-tertiary' />
            </button>
          </div>

          <div className='flex items-center gap-2 mb-5 text-base text-foreground-secondary'>
            <span>💡</span>
            <span>{t('conversation.history.exportDialogHint')}</span>
          </div>

          <div className='flex gap-3 justify-end'>
            {!exportFinished && (
              <Button shape='round' onClick={closeExportModal}>
                {t('common.cancel')}
              </Button>
            )}
            <Button
              type='primary'
              shape='round'
              loading={exportModalLoading}
              onClick={() => {
                if (exportFinished) {
                  closeExportModal();
                } else {
                  void handleConfirmExport();
                }
              }}
            >
              {exportModalLoading ? t('conversation.history.exporting') : exportFinished ? t('common.close') : t('common.confirm')}
            </Button>
          </div>
        </div>
      </Modal>

      <DirectorySelectionModal visible={showExportDirectorySelector} onConfirm={handleSelectExportDirectoryFromModal} onCancel={() => setShowExportDirectorySelector(false)} />

      <div className='size-full overflow-y-auto overflow-x-hidden'>
        {/* ── PINNED SECTION ── */}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
          {pinnedConversations.length > 0 && (
            <div className='mb-8px min-w-0'>
              {!collapsed && <div className='chat-history__section h-9 px-2.5 flex items-center text-xs text-foreground-tertiary font-500'>{t('conversation.history.pinnedSection')}</div>}
              <SortableContext items={pinnedIds} strategy={verticalListSortingStrategy}>
                <div className='min-w-0'>
                  {pinnedConversations.map((conversation) => {
                    const props = getConversationRowProps(conversation as ConversationItem);
                    return isDragEnabled ? <SortableConversationRow key={conversation.id} {...props} /> : <ConversationRow key={conversation.id} {...props} />;
                  })}
                </div>
              </SortableContext>
            </div>
          )}

          <DragOverlay dropAnimation={null}>{activeId && activeConversation ? <DragOverlayContent conversation={activeConversation} /> : null}</DragOverlay>
        </DndContext>

        {/* ── SCHEDULED SECTION (Scheduled tab only) ── */}
        {activeTab === 'scheduled' && filteredScheduledGroups.length > 0 && (
          <div className='mb-8px min-w-0'>
            {!collapsed && (
              <div className='chat-history__section h-9 px-2.5 text-xs text-foreground-tertiary font-500 flex items-center gap-1.5 cursor-pointer hover:text-foreground transition-colors select-none' onClick={handleToggleScheduledSection}>
                <Down size={12} className={classNames('line-height-0 transition-transform duration-200 shrink-0', scheduledSectionExpanded ? 'rotate-0' : '-rotate-90')} />
                <span>{t('cron.sidebar.scheduled', { defaultValue: 'Scheduled' })}</span>
              </div>
            )}
            {(collapsed || scheduledSectionExpanded) &&
              filteredScheduledGroups.map(({ jobId, jobName, conversations: cronConvs }) => {
                const isExpanded = expandedScheduled.includes(jobId) || expandedScheduled.includes(jobName);
                return (
                  <div key={jobId} className={classNames('min-w-0', { 'px-8px': !collapsed })}>
                    <WorkspaceCollapse
                      expanded={isExpanded}
                      onToggle={() => handleToggleScheduled(jobId, jobName)}
                      siderCollapsed={collapsed}
                      header={
                        <div className='flex items-center gap-8px text-14px min-w-0'>
                          <span className='font-medium truncate flex-1 text-foreground min-w-0'>{jobName}</span>
                        </div>
                      }
                    >
                      <div className={classNames('flex flex-col gap-2px min-w-0', { 'mt-4px': !collapsed })}>{cronConvs.map((conv) => renderConversation(conv as ConversationItem))}</div>
                    </WorkspaceCollapse>
                  </div>
                );
              })}
          </div>
        )}

        {activeTab === 'timeline' && timelineConversations.length > 0 && (
          <div className='min-w-0'>
            {!collapsed && <div className='chat-history__section h-9 px-2.5 flex items-center text-xs text-foreground-tertiary font-500'>{t('conversation.history.recent')}</div>}
            {timelineConversations.map((conversation) => renderConversation(conversation as ConversationItem))}
          </div>
        )}
      </div>
    </FlexFullContainer>
  );
};

export default WorkspaceGroupedHistory;
