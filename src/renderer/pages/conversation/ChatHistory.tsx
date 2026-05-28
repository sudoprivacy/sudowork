/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/storage';
import FlexFullContainer from '@/renderer/components/FlexFullContainer';
import { CronJobIndicator, useCronJobsMap } from '@/renderer/pages/cron';
import { useAllCronJobs } from '@/renderer/pages/cron/hooks/useCronJobs';
import { addEventListener, emitter } from '@/renderer/utils/emitter';
import { blockMobileInputFocus, blurActiveElement } from '@/renderer/utils/focus';
import { cleanupSiderTooltips, getSiderTooltipProps } from '@/renderer/utils/siderTooltip';
import { getActivityTime, createTimelineGrouper } from '@/renderer/utils/timeline';
import { formatSessionTime } from '@/renderer/utils/messageTime';
import { Checkbox, Input, Message, Modal, Tooltip } from '@arco-design/web-react';
import EmptyState from '@/renderer/components/base/EmptyState';
import { DeleteOne, MessageOne, EditOne } from '@icon-park/react';
import classNames from 'classnames';
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useLayoutContext } from '@/renderer/context/LayoutContext';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';

const useTimeline = () => {
  const { t } = useTranslation();
  return createTimelineGrouper(t);
};

const useScrollIntoView = (id: string) => {
  useEffect(() => {
    if (!id) return;
    const el = document.getElementById('c-' + id);
    if (!el) return;

    const findScrollParent = (node: HTMLElement | null): HTMLElement | null => {
      let p = node?.parentElement;
      while (p) {
        const style = window.getComputedStyle(p);
        const overflowY = style.overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll') return p;
        p = p.parentElement;
      }
      return null;
    };

    const container = findScrollParent(el);

    const isOutOfView = (): boolean => {
      const elRect = el.getBoundingClientRect();
      if (!container) {
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        return elRect.top < 0 || elRect.bottom > viewportHeight;
      }
      const cRect = container.getBoundingClientRect();
      return elRect.top < cRect.top || elRect.bottom > cRect.bottom;
    };

    if (isOutOfView()) {
      el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }, [id]);
};

// Key for localStorage to persist collapsed state of scheduled job folders
const SCHEDULED_FOLDER_KEY = 'cron_sidebar_expanded_';

// Virtuoso 列表项类型
type ChatHistoryListItem = { type: 'section-header'; id: string; title: string } | { type: 'folder-header'; id: string; jobId: string; title: string; isExpanded: boolean; count: number } | { type: 'conversation'; id: string; data: TChatConversation; isIndented: boolean };

const ChatHistory: React.FC<{ onSessionClick?: () => void; collapsed?: boolean }> = ({ onSessionClick, collapsed = false }) => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [chatHistory, setChatHistory] = useState<TChatConversation[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(SCHEDULED_FOLDER_KEY + 'state');
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { getJobStatus, markAsRead } = useCronJobsMap();
  const { jobs: cronJobs } = useAllCronJobs();
  const siderTooltipProps = getSiderTooltipProps(collapsed && !isMobile);

  useScrollIntoView(id);

  // Mark conversation as read when id changes
  useEffect(() => {
    if (id) {
      markAsRead(id);
    }
  }, [id, markAsRead]);

  const handleSelect = (conversation: TChatConversation) => {
    cleanupSiderTooltips();
    blockMobileInputFocus();
    blurActiveElement();
    // ipcBridge.conversation.createWithConversation.invoke({ conversation }).then(() => {
    Promise.resolve(navigate(`/conversation/${conversation.id}`)).catch((error) => {
      console.error('Navigation failed:', error);
    });
    // 点击session后自动隐藏sidebar
    if (onSessionClick) {
      onSessionClick();
    }
    // });
  };

  const isConversation = !!id;

  useEffect(() => {
    const refresh = () => {
      // Get conversations from database instead of file storage
      ipcBridge.database.getUserConversations
        .invoke({ page: 0, pageSize: 10000 })
        .then((history) => {
          if (history && Array.isArray(history) && history.length > 0) {
            const sortedHistory = history.sort((a, b) => getActivityTime(b) - getActivityTime(a));
            setChatHistory(sortedHistory);
          } else {
            setChatHistory([]);
          }
        })
        .catch((error) => {
          console.error('[ChatHistory] Failed to load conversations from database:', error);
          setChatHistory([]);
        });
    };
    refresh();
    return addEventListener('chat.history.refresh', refresh);
  }, [isConversation]);

  const handleRemoveConversation = (id: string, deleteWorkspace?: boolean) => {
    void ipcBridge.conversation.remove
      .invoke({ id, deleteWorkspace })
      .then((success) => {
        if (success) {
          // Trigger refresh to reload from database
          emitter.emit('chat.history.refresh');
          Message.success(t('conversation.history.deleteSuccess'));
          void Promise.resolve(navigate('/')).catch((error) => {
            console.error('Navigation failed:', error);
          });
        } else {
          Message.error(t('conversation.history.deleteFailed'));
        }
      })
      .catch((error) => {
        console.error('Failed to remove conversation:', error);
        Message.error(t('conversation.history.deleteFailed'));
      });
  };

  const handleDeleteClick = (conversation: TChatConversation) => {
    const hasWorkspace = !!(conversation.extra as { workspace?: string } | undefined)?.workspace;
    const deleteWorkspaceRef = { current: false };

    Modal.confirm({
      title: t('conversation.history.deleteTitle'),
      content: React.createElement('div', null,
        React.createElement('div', null, t('conversation.history.deleteConfirm')),
        hasWorkspace && React.createElement(Checkbox, {
          onChange: (checked: boolean) => { deleteWorkspaceRef.current = checked; },
          style: { marginTop: 12 },
        }, t('conversation.history.deleteWorkspaceOption'))
      ),
      okText: t('conversation.history.confirmDelete'),
      cancelText: t('conversation.history.cancelDelete'),
      okButtonProps: { status: 'warning' },
      onOk: () => {
        handleRemoveConversation(conversation.id, deleteWorkspaceRef.current);
      },
      style: { borderRadius: '12px' },
      alignCenter: true,
    });
  };

  const handleEditStart = (conversation: TChatConversation) => {
    setEditingId(conversation.id);
    setEditingName(conversation.name);
  };

  const handleEditSave = async () => {
    if (!editingId || !editingName.trim()) return;

    try {
      const success = await ipcBridge.conversation.update.invoke({
        id: editingId,
        updates: { name: editingName.trim() },
      });

      if (success) {
        // Trigger refresh to reload from database
        emitter.emit('chat.history.refresh');
      }
    } catch (error) {
      console.error('Failed to update conversation name:', error);
    } finally {
      setEditingId(null);
      setEditingName('');
    }
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditingName('');
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      void handleEditSave();
    } else if (e.key === 'Escape') {
      handleEditCancel();
    }
  };

  const toggleFolder = useCallback((jobId: string) => {
    setExpandedFolders((prev) => {
      const next = { ...prev, [jobId]: !prev[jobId] };
      try {
        localStorage.setItem(SCHEDULED_FOLDER_KEY + 'state', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const formatTimeline = useTimeline();

  // Virtuoso ref for programmatic scrolling
  const virtuosoRef = React.useRef<VirtuosoHandle>(null);

  // Recent section: exclude cron-created run records (tagged with `extra.cronJobId`).
  // Pre-bound user conversations stay in their original timeline slot.
  const recentConvs = useMemo(() => chatHistory.filter((c) => !(c.extra as { cronJobId?: string } | undefined)?.cronJobId), [chatHistory]);

  // Scheduled section: one group per cron job, sourced from the cron jobs table
  // so a single conversation bound to multiple jobs appears in multiple groups.
  const scheduledGroups = useMemo(() => {
    const convById = new Map(chatHistory.map((c) => [c.id, c]));
    const runRecordsByJob = new Map<string, TChatConversation[]>();
    chatHistory.forEach((conv) => {
      const jobId = (conv.extra as { cronJobId?: string } | undefined)?.cronJobId;
      if (!jobId) return;
      if (!runRecordsByJob.has(jobId)) runRecordsByJob.set(jobId, []);
      runRecordsByJob.get(jobId)!.push(conv);
    });

    const groups: { jobId: string; jobName: string; convs: TChatConversation[] }[] = [];
    cronJobs.forEach((job) => {
      const convs: TChatConversation[] = [];
      const seen = new Set<string>();
      if (job.metadata.conversationId) {
        const bound = convById.get(job.metadata.conversationId);
        if (bound) {
          convs.push(bound);
          seen.add(bound.id);
        }
      }
      (runRecordsByJob.get(job.id) || []).forEach((conv) => {
        if (!seen.has(conv.id)) {
          convs.push(conv);
          seen.add(conv.id);
        }
      });
      if (convs.length === 0) return;
      convs.sort((a, b) => getActivityTime(b) - getActivityTime(a));
      groups.push({ jobId: job.id, jobName: job.name, convs });
    });
    groups.sort((a, b) => getActivityTime(b.convs[0]) - getActivityTime(a.convs[0]));
    return groups;
  }, [chatHistory, cronJobs]);

  // 扁平化所有列表项用于虚拟滚动
  const listItems = useMemo<ChatHistoryListItem[]>(() => {
    const items: ChatHistoryListItem[] = [];

    // Scheduled section
    if (scheduledGroups.length > 0) {
      // 添加 Scheduled 分组标题
      items.push({
        type: 'section-header',
        id: 'scheduled-section',
        title: t('cron.sidebar.scheduled', { defaultValue: 'Scheduled' }),
      });

      // 添加每个定时任务的文件夹和会话
      scheduledGroups.forEach(({ jobId, jobName, convs }) => {
        const isExpanded = expandedFolders[jobId] !== false;
        items.push({
          type: 'folder-header',
          id: `folder-${jobId}`,
          jobId,
          title: jobName,
          isExpanded,
          count: convs.length,
        });

        if (isExpanded) {
          convs.forEach((conv) => {
            items.push({
              type: 'conversation',
              id: `conv-${conv.id}`,
              data: conv,
              isIndented: true,
            });
          });
        }
      });
    }

    // Recent section
    recentConvs.forEach((item) => {
      const timeline = formatTimeline(item);
      if (timeline) {
        items.push({
          type: 'section-header',
          id: `timeline-${timeline}-${item.id}`,
          title: timeline,
        });
      }
      items.push({
        type: 'conversation',
        id: `conv-${item.id}`,
        data: item,
        isIndented: false,
      });
    });

    return items;
  }, [scheduledGroups, recentConvs, expandedFolders, formatTimeline, t]);

  // 处理文件夹点击
  const handleFolderClick = useCallback((jobId: string) => toggleFolder(jobId), [toggleFolder]);

  const renderConversation = useCallback(
    (conversation: TChatConversation, isIndented: boolean) => {
      const isSelected = id === conversation.id;
      const isEditing = editingId === conversation.id;
      const cronStatus = getJobStatus(conversation.id);
      const activityTime = getActivityTime(conversation);
      const timeLabel = activityTime ? formatSessionTime(activityTime, i18n.language, t('conversation.history.yesterday')) : '';

      return (
        <Tooltip {...siderTooltipProps} content={conversation.name || t('conversation.welcome.newConversation')} position='right'>
          <div
            id={'c-' + conversation.id}
            className={classNames('chat-history__item hover:bg-hover px-12px py-8px rd-8px flex justify-start items-center group cursor-pointer relative overflow-hidden group shrink-0 conversation-item [&.conversation-item+&.conversation-item]:mt-2px', {
              '!bg-active ': isSelected,
              'pl-16px': isIndented,
            })}
            onClick={handleSelect.bind(null, conversation)}
          >
            <MessageOne theme='outline' size='20' className='mt-2px flex' />
            <FlexFullContainer className='h-24px collapsed-hidden ml-10px min-w-0'>
              {isEditing ? (
                <Input className='chat-history__item-editor text-14px lh-24px h-24px w-full' value={editingName} onChange={setEditingName} onKeyDown={handleEditKeyDown} onBlur={handleEditSave} autoFocus size='small' />
              ) : (
                <div className='flex items-center gap-4px w-full'>
                  <div className='chat-history__item-name text-nowrap overflow-hidden text-ellipsis inline-block flex-1 text-14px lh-24px whitespace-nowrap min-w-0'>{conversation.name}</div>
                  <CronJobIndicator status={cronStatus} size={14} />
                  {timeLabel && !collapsed && <span className='text-11px text-[color:var(--color-text-4)] whitespace-nowrap shrink-0 group-hover:hidden'>{timeLabel}</span>}
                </div>
              )}
            </FlexFullContainer>
            {!isEditing && (
              <div
                className={classNames('absolute right-0px top-0px h-full w-70px items-center justify-end hidden group-hover:flex !collapsed-hidden pr-12px')}
                style={{
                  backgroundImage: isSelected ? `linear-gradient(to right, transparent, var(--aou-2) 50%)` : `linear-gradient(to right, transparent, var(--aou-1) 50%)`,
                }}
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                {!isEditing && (
                  <span
                    className='flex-center mr-8px'
                    onClick={(event) => {
                      event.stopPropagation();
                      handleEditStart(conversation);
                    }}
                    role='button'
                    aria-label={t('common.ariaLabel.edit')}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleEditStart(conversation);
                      }
                    }}
                  >
                    <EditOne theme='outline' size='20' className='flex' />
                  </span>
                )}
                {!isEditing && (
                    <span
                      className='flex-center'
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDeleteClick(conversation);
                      }}
                      role='button'
                      aria-label={t('common.ariaLabel.delete')}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          handleDeleteClick(conversation);
                        }
                      }}
                    >
                      <DeleteOne theme='outline' size='20' className='flex' />
                    </span>
                )}
              </div>
            )}
          </div>
        </Tooltip>
      );
    },
    [id, editingId, editingName, collapsed, siderTooltipProps, i18n.language, t, getJobStatus, handleSelect, handleEditKeyDown, handleEditSave, handleEditStart, handleDeleteClick]
  );

  // Virtuoso item renderer
  const renderListItem = useCallback(
    (index: number, item: ChatHistoryListItem) => {
      switch (item.type) {
        case 'section-header':
          return (
            <div className='chat-history__section px-12px py-8px text-13px text-t-secondary font-bold collapsed-hidden' key={item.id}>
              {item.title}
            </div>
          );
        case 'folder-header':
          return (
            <div className='chat-history__item hover:bg-hover px-12px py-8px rd-8px flex items-center gap-6px cursor-pointer shrink-0 collapsed-hidden' onClick={() => handleFolderClick(item.jobId)} key={item.id}>
              <span className={classNames('text-t-secondary text-12px transition-transform', { 'rotate-90': item.isExpanded })}>▶</span>
              <span className='text-14px text-t-primary truncate flex-1'>{item.title}</span>
              <span className='text-11px text-[color:var(--color-text-4)] shrink-0'>{item.count}</span>
            </div>
          );
        case 'conversation':
          return renderConversation(item.data, item.isIndented);
        default:
          return null;
      }
    },
    [renderConversation, handleFolderClick]
  );

  return (
    <FlexFullContainer>
      <div
        className={classNames('size-full chat-history', {
          'flex-center': !listItems.length,
          'chat-history--collapsed': collapsed,
        })}
      >
        {!listItems.length ? (
          <EmptyState
            icon={<MessageOne theme='outline' size='48' fill='var(--color-text-3)' />}
            title={t('conversation.history.noHistory')}
            actions={[
              {
                label: t('conversation.history.actionNewConversation'),
                onClick: () => {
                  void Promise.resolve(navigate('/')).catch((error) => {
                    console.error('Navigation failed:', error);
                  });
                },
                type: 'primary',
              },
            ]}
            simple
          />
        ) : (
          <Virtuoso ref={virtuosoRef} className='size-full' data={listItems} itemContent={renderListItem} increaseViewportBy={400} />
        )}
      </div>
    </FlexFullContainer>
  );
};

export default ChatHistory;
