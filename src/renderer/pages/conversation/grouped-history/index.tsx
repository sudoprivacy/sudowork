/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/storage';
import { ipcBridge } from '@/common';
import DirectorySelectionModal from '@/renderer/components/DirectorySelectionModal';
import FlexFullContainer from '@/renderer/components/FlexFullContainer';
import { CronJobIndicator, useCronJobsMap } from '@/renderer/pages/cron';
import { emitter } from '@/renderer/utils/emitter';
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button, Empty, Input, Message, Modal } from '@arco-design/web-react';
import { Down, FolderOpen } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import WorkspaceCollapse from '../WorkspaceCollapse';
import ConversationRow from './ConversationRow';
import DragOverlayContent from './DragOverlayContent';
import SortableConversationRow from './SortableConversationRow';
import { useBatchSelection } from './hooks/useBatchSelection';
import { useConversationActions } from './hooks/useConversationActions';
import { useConversations } from './hooks/useConversations';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import { useExport } from './hooks/useExport';
import type { ConversationRowProps, WorkspaceGroupedHistoryProps } from './types';

const WorkspaceGroupedHistory: React.FC<WorkspaceGroupedHistoryProps> = ({ onSessionClick, collapsed = false, tooltipEnabled = false, batchMode = false, onBatchModeChange, activeTab = 'timeline' }) => {
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

  const { conversations, expandedWorkspaces, pinnedTimeline, pinnedScheduled, timelineSections, scheduledGroups, handleToggleWorkspace } = useConversations();

  // Select pinned list based on active tab
  const pinnedConversations = activeTab === 'scheduled' ? pinnedScheduled : pinnedTimeline;

  // Filter out pinned conversations from scheduled groups to avoid duplicates
  // Only filter based on pinnedScheduled (pinned in scheduled tab)
  const currentPinnedIds = useMemo(() => new Set(pinnedScheduled.map((c) => c.id)), [pinnedScheduled]);
  const filteredScheduledGroups = useMemo(
    () => scheduledGroups.map((group) => ({ ...group, conversations: group.conversations.filter((c) => !currentPinnedIds.has(c.id)) })).filter((g) => g.conversations.length > 0),
    [scheduledGroups, pinnedScheduled],
  );

  // ── Timeline section collapse state ──
  const TIMELINE_EXPANSION_KEY = 'aionui_timeline_expansion';
  // Map of timeline label → expanded boolean. undefined means "use default" (true).
  const [expandedTimeline, setExpandedTimeline] = React.useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem(TIMELINE_EXPANSION_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, boolean>;
      }
    } catch {
      // ignore
    }
    return {};
  });

  const isTimelineSectionExpanded = useCallback(
    (timelineLabel: string): boolean => {
      return expandedTimeline[timelineLabel] !== false; // default to expanded
    },
    [expandedTimeline]
  );

  const handleToggleTimeline = useCallback((timelineLabel: string) => {
    setExpandedTimeline((prev) => {
      const currentlyExpanded = prev[timelineLabel] !== false; // default true
      const next = { ...prev, [timelineLabel]: !currentlyExpanded };
      try {
        localStorage.setItem(TIMELINE_EXPANSION_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // ── Scheduled section top-level collapse state ──
  const SCHEDULED_SECTION_KEY = 'aionui_scheduled_section_expanded';
  const [scheduledSectionExpanded, setScheduledSectionExpanded] = React.useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(SCHEDULED_SECTION_KEY);
      if (stored !== null) return JSON.parse(stored) as boolean;
    } catch {
      // ignore
    }
    return false; // collapsed by default
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

  const SCHEDULED_EXPANSION_KEY = 'aionui_scheduled_expansion';
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

  const handleToggleScheduled = useCallback((jobName: string) => {
    setExpandedScheduled((prev) => {
      const next = prev.includes(jobName) ? prev.filter((n) => n !== jobName) : [...prev, jobName];
      try {
        localStorage.setItem(SCHEDULED_EXPANSION_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // Workspace rename state / 工作空间重命名状态
  const [wsRenameModal, setWsRenameModal] = useState<{ visible: boolean; workspace: string; name: string }>({ visible: false, workspace: '', name: '' });
  const [wsRenameLoading, setWsRenameLoading] = useState(false);

  const handleWorkspaceRenameStart = useCallback((workspacePath: string, currentDisplayName: string) => {
    setWsRenameModal({ visible: true, workspace: workspacePath, name: currentDisplayName });
  }, []);

  const handleWorkspaceRenameConfirm = useCallback(async () => {
    const newName = wsRenameModal.name.trim();
    if (!newName) return;
    setWsRenameLoading(true);
    try {
      const result = await ipcBridge.workspaceManage.updateDisplayName.invoke({ workspace: wsRenameModal.workspace, displayName: newName });
      if (result?.success) {
        Message.success(t('conversation.workspace.renameWorkspace.success'));
        setWsRenameModal({ visible: false, workspace: '', name: '' });
        emitter.emit('chat.history.refresh');
      } else {
        Message.error(result?.msg || t('conversation.workspace.renameWorkspace.failed'));
      }
    } catch (error) {
      Message.error(t('conversation.workspace.renameWorkspace.failed'));
    } finally {
      setWsRenameLoading(false);
    }
  }, [wsRenameModal, t]);

  const { selectedConversationIds, setSelectedConversationIds, selectedCount, allSelected, toggleSelectedConversation, handleToggleSelectAll } = useBatchSelection(batchMode, conversations);

  const { renameModalVisible, renameModalName, setRenameModalName, renameLoading, dropdownVisibleId, handleConversationClick, handleDeleteClick, handleBatchDelete, handleEditStart, handleRenameConfirm, handleRenameCancel, handleTogglePin, handleMenuVisibleChange, handleOpenMenu } = useConversationActions({
    batchMode,
    activeTab,
    onSessionClick,
    onBatchModeChange,
    selectedConversationIds,
    setSelectedConversationIds,
    toggleSelectedConversation,
    markAsRead,
  });

  const { exportTask, exportModalVisible, exportTargetPath, exportModalLoading, exportFinished, showExportDirectorySelector, setShowExportDirectorySelector, closeExportModal, handleSelectExportDirectoryFromModal, handleSelectExportFolder, handleExportConversation, handleBatchExport, handleConfirmExport } = useExport({
    conversations,
    selectedConversationIds,
    setSelectedConversationIds,
    onBatchModeChange,
  });

  const { sensors, activeId, activeConversation, handleDragStart, handleDragEnd, handleDragCancel, isDragEnabled } = useDragAndDrop({
    pinnedConversations,
    batchMode,
    collapsed,
  });

  const getConversationRowProps = useCallback(
    (conversation: TChatConversation): ConversationRowProps => ({
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

  const renderConversation = (conversation: TChatConversation) => {
    const rowProps = getConversationRowProps(conversation);
    return <ConversationRow key={conversation.id} {...rowProps} />;
  };

  // Collect all sortable IDs for the pinned section
  const pinnedIds = useMemo(() => pinnedConversations.map((c) => c.id), [pinnedConversations]);

  if (activeTab === 'timeline' && timelineSections.length === 0 && pinnedConversations.length === 0) {
    return (
      <FlexFullContainer>
        <div className='flex-center'>
          <Empty description={t('conversation.history.noHistory')} />
        </div>
      </FlexFullContainer>
    );
  }

  if (activeTab === 'scheduled' && filteredScheduledGroups.length === 0 && pinnedConversations.length === 0) {
    return (
      <FlexFullContainer>
        <div className='flex-center'>
          <Empty description={t('conversation.history.noHistory')} />
        </div>
      </FlexFullContainer>
    );
  }

  return (
    <FlexFullContainer>
      <Modal title={t('conversation.history.renameTitle')} visible={renameModalVisible} onOk={handleRenameConfirm} onCancel={handleRenameCancel} okText={t('conversation.history.saveName')} cancelText={t('conversation.history.cancelEdit')} confirmLoading={renameLoading} okButtonProps={{ disabled: !renameModalName.trim() }} style={{ borderRadius: '12px' }} alignCenter getPopupContainer={() => document.body}>
        <Input autoFocus value={renameModalName} onChange={setRenameModalName} onPressEnter={handleRenameConfirm} placeholder={t('conversation.history.renamePlaceholder')} allowClear />
      </Modal>

      <Modal visible={exportModalVisible} title={t('conversation.history.exportDialogTitle')} onCancel={closeExportModal} footer={null} style={{ borderRadius: '12px' }} className='conversation-export-modal' alignCenter getPopupContainer={() => document.body}>
        <div className='py-8px'>
          <div className='text-14px mb-16px text-t-secondary'>{exportTask?.mode === 'batch' ? t('conversation.history.exportDialogBatchDescription', { count: exportTask.conversationIds.length }) : t('conversation.history.exportDialogSingleDescription')}</div>

          <div className='mb-16px p-16px rounded-12px bg-fill-1'>
            <div className='text-14px mb-8px text-t-primary'>{t('conversation.history.exportTargetFolder')}</div>
            <div
              className='flex items-center justify-between px-12px py-10px rounded-8px transition-colors'
              style={{
                backgroundColor: 'var(--color-bg-1)',
                border: '1px solid var(--color-border-2)',
                cursor: exportModalLoading ? 'not-allowed' : 'pointer',
                opacity: exportModalLoading ? 0.55 : 1,
              }}
              onClick={() => {
                void handleSelectExportFolder();
              }}
            >
              <span className='text-14px overflow-hidden text-ellipsis whitespace-nowrap' style={{ color: exportTargetPath ? 'var(--color-text-1)' : 'var(--color-text-3)' }}>
                {exportTargetPath || t('conversation.history.exportSelectFolder')}
              </span>
              <FolderOpen theme='outline' size='18' fill='var(--color-text-3)' />
            </div>
          </div>

          <div className='flex items-center gap-8px mb-20px text-14px text-t-secondary'>
            <span>💡</span>
            <span>{t('conversation.history.exportDialogHint')}</span>
          </div>

          <div className='flex gap-12px justify-end'>
            {!exportFinished && (
              <button
                className='px-24px py-8px rounded-20px text-14px font-medium transition-all'
                style={{
                  border: '1px solid var(--color-border-2)',
                  backgroundColor: 'var(--color-fill-2)',
                  color: 'var(--color-text-1)',
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.backgroundColor = 'var(--color-fill-3)';
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.backgroundColor = 'var(--color-fill-2)';
                }}
                onClick={closeExportModal}
              >
                {t('common.cancel')}
              </button>
            )}
            <button
              className='px-24px py-8px rounded-20px text-14px font-medium transition-all'
              style={{
                border: 'none',
                backgroundColor: exportModalLoading ? 'var(--color-fill-3)' : 'var(--color-text-1)',
                color: 'var(--color-bg-1)',
                cursor: exportModalLoading ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={(event) => {
                if (!exportModalLoading) {
                  event.currentTarget.style.opacity = '0.85';
                }
              }}
              onMouseLeave={(event) => {
                if (!exportModalLoading) {
                  event.currentTarget.style.opacity = '1';
                }
              }}
              onClick={() => {
                if (exportFinished) {
                  closeExportModal();
                } else {
                  void handleConfirmExport();
                }
              }}
              disabled={exportModalLoading}
            >
              {exportModalLoading ? t('conversation.history.exporting') : exportFinished ? t('common.close') : t('common.confirm')}
            </button>
          </div>
        </div>
      </Modal>

      <DirectorySelectionModal visible={showExportDirectorySelector} onConfirm={handleSelectExportDirectoryFromModal} onCancel={() => setShowExportDirectorySelector(false)} />

      {/* Workspace Rename Modal / 工作空间重命名弹窗 */}
      <Modal title={t('conversation.workspace.renameWorkspace.title')} visible={wsRenameModal.visible} onOk={handleWorkspaceRenameConfirm} onCancel={() => setWsRenameModal({ visible: false, workspace: '', name: '' })} okText={t('common.confirm')} cancelText={t('common.cancel')} confirmLoading={wsRenameLoading} okButtonProps={{ disabled: !wsRenameModal.name.trim() }} style={{ borderRadius: '12px' }} alignCenter getPopupContainer={() => document.body}>
        <div className='text-13px text-t-secondary mb-8px'>{t('conversation.workspace.renameWorkspace.hint')}</div>
        <Input autoFocus value={wsRenameModal.name} onChange={(v) => setWsRenameModal((prev) => ({ ...prev, name: v }))} onPressEnter={handleWorkspaceRenameConfirm} placeholder={t('conversation.workspace.renameWorkspace.placeholder')} />
      </Modal>

      {batchMode && !collapsed && (
        <div className='px-12px pb-8px'>
          <div className='rd-8px bg-fill-1 p-10px flex flex-col gap-8px border border-solid border-[rgba(var(--primary-6),0.08)]'>
            <div className='text-12px leading-18px text-t-secondary'>{t('conversation.history.selectedCount', { count: selectedCount })}</div>
            <div className='grid grid-cols-2 gap-6px'>
              <Button className='!col-span-2 !w-full !justify-center !min-w-0 !h-30px !px-8px !text-12px whitespace-nowrap' size='mini' type='secondary' onClick={handleToggleSelectAll}>
                {allSelected ? t('common.cancel') : t('conversation.history.selectAll')}
              </Button>
              <Button className='!w-full !justify-center !min-w-0 !h-30px !px-8px !text-12px whitespace-nowrap' size='mini' type='secondary' onClick={handleBatchExport}>
                {t('conversation.history.batchExport')}
              </Button>
              <Button className='!w-full !justify-center !min-w-0 !h-30px !px-8px !text-12px whitespace-nowrap' size='mini' status='warning' onClick={handleBatchDelete}>
                {t('conversation.history.batchDelete')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className='size-full overflow-y-auto overflow-x-hidden'>
        {/* ── PINNED SECTION ── */}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
          {pinnedConversations.length > 0 && (
            <div className='mb-8px min-w-0'>
              {!collapsed && <div className='chat-history__section px-12px py-8px text-13px text-t-secondary font-bold'>{t('conversation.history.pinnedSection')}</div>}
              <SortableContext items={pinnedIds} strategy={verticalListSortingStrategy}>
                <div className='min-w-0'>
                  {pinnedConversations.map((conversation) => {
                    const props = getConversationRowProps(conversation);
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
              <div className='chat-history__section px-12px py-8px text-13px text-t-secondary font-bold flex items-center gap-6px cursor-pointer hover:text-t-primary transition-colors select-none' onClick={handleToggleScheduledSection}>
                <Down size={12} className={classNames('line-height-0 transition-transform duration-200 flex-shrink-0', scheduledSectionExpanded ? 'rotate-0' : '-rotate-90')} />
                <span>{t('cron.sidebar.scheduled', { defaultValue: 'Scheduled' })}</span>
              </div>
            )}
            {(collapsed || scheduledSectionExpanded) &&
              filteredScheduledGroups.map(({ jobName, conversations: cronConvs }) => {
                const isExpanded = expandedScheduled.includes(jobName);
                return (
                  <div key={jobName} className={classNames('min-w-0', { 'px-8px': !collapsed })}>
                    <WorkspaceCollapse
                      expanded={isExpanded}
                      onToggle={() => handleToggleScheduled(jobName)}
                      siderCollapsed={collapsed}
                      header={
                        <div className='flex items-center gap-8px text-14px min-w-0'>
                          <span className='font-medium truncate flex-1 text-t-primary min-w-0'>{jobName}</span>
                        </div>
                      }
                    >
                      <div className={classNames('flex flex-col gap-2px min-w-0', { 'mt-4px': !collapsed })}>{cronConvs.map((conv) => renderConversation(conv))}</div>
                    </WorkspaceCollapse>
                  </div>
                );
              })}
          </div>
        )}

        {activeTab === 'timeline' && timelineSections.map((section) => {
          const sectionExpanded = isTimelineSectionExpanded(section.timeline);
          return (
            <div key={section.timeline} className='mb-8px min-w-0'>
              {!collapsed && (
                <div className='chat-history__section px-12px py-8px text-13px text-t-secondary font-bold flex items-center gap-6px cursor-pointer hover:text-t-primary transition-colors select-none' onClick={() => handleToggleTimeline(section.timeline)}>
                  <Down size={12} className={classNames('line-height-0 transition-transform duration-200 flex-shrink-0', sectionExpanded ? 'rotate-0' : '-rotate-90')} />
                  <span>{section.timeline}</span>
                </div>
              )}

              {(collapsed || sectionExpanded) &&
                section.items.map((item) => {
                  if (item.type === 'workspace' && item.workspaceGroup) {
                    const group = item.workspaceGroup;
                    return (
                      <div key={group.workspace} className={classNames('min-w-0 group', { 'px-8px': !collapsed })}>
                        <WorkspaceCollapse
                          expanded={expandedWorkspaces.includes(group.workspace)}
                          onToggle={() => handleToggleWorkspace(group.workspace)}
                          siderCollapsed={collapsed}
                          header={
                            <div className='flex items-center gap-8px text-14px min-w-0'>
                              <span className='font-medium truncate flex-1 text-t-primary min-w-0'>{group.displayName}</span>
                              <button
                                type='button'
                                className='opacity-0 group-hover:opacity-100 hover:text-t-primary text-t-secondary flex-shrink-0 border-none bg-transparent p-0 cursor-pointer transition-opacity'
                                title={t('conversation.workspace.renameWorkspace.title')}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleWorkspaceRenameStart(group.workspace, group.displayName);
                                }}
                              >
                                <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                                  <path d='M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' />
                                  <path d='M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z' />
                                </svg>
                              </button>
                            </div>
                          }
                        >
                          <div className={classNames('flex flex-col gap-2px min-w-0', { 'mt-4px': !collapsed })}>{group.conversations.map((conversation) => renderConversation(conversation))}</div>
                        </WorkspaceCollapse>
                      </div>
                    );
                  }

                  if (item.type === 'conversation' && item.conversation) {
                    return renderConversation(item.conversation);
                  }

                  return null;
                })}
            </div>
          );
        })}
      </div>
    </FlexFullContainer>
  );
};

export default WorkspaceGroupedHistory;
