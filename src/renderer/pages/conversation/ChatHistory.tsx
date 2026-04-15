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
import { Empty, Popconfirm, Input, Tooltip } from '@arco-design/web-react';
import { DeleteOne, MessageOne, EditOne } from '@icon-park/react';
import classNames from 'classnames';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useLayoutContext } from '@/renderer/context/LayoutContext';

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

  const handleRemoveConversation = (id: string) => {
    void ipcBridge.conversation.remove
      .invoke({ id })
      .then((success) => {
        if (success) {
          // Trigger refresh to reload from database
          emitter.emit('chat.history.refresh');
          void Promise.resolve(navigate('/')).catch((error) => {
            console.error('Navigation failed:', error);
          });
        }
      })
      .catch((error) => {
        console.error('Failed to remove conversation:', error);
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

  const toggleFolder = (jobName: string) => {
    setExpandedFolders((prev) => {
      const next = { ...prev, [jobName]: !prev[jobName] };
      try {
        localStorage.setItem(SCHEDULED_FOLDER_KEY + 'state', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const formatTimeline = useTimeline();

  const renderConversation = (conversation: TChatConversation) => {
    const isSelected = id === conversation.id;
    const isEditing = editingId === conversation.id;
    const cronStatus = getJobStatus(conversation.id);
    const activityTime = getActivityTime(conversation);
    const timeLabel = activityTime ? formatSessionTime(activityTime, i18n.language, t('conversation.history.yesterday')) : '';

    return (
      <Tooltip key={conversation.id} {...siderTooltipProps} content={conversation.name || t('conversation.welcome.newConversation')} position='right'>
        <div
          id={'c-' + conversation.id}
          className={classNames('chat-history__item hover:bg-hover px-12px py-8px rd-8px flex justify-start items-center group cursor-pointer relative overflow-hidden group shrink-0 conversation-item [&.conversation-item+&.conversation-item]:mt-2px', {
            '!bg-active ': isSelected,
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
                >
                  <EditOne theme='outline' size='20' className='flex' />
                </span>
              )}
              {!isEditing && (
                <Popconfirm
                  title={t('conversation.history.deleteTitle')}
                  content={t('conversation.history.deleteConfirm')}
                  okText={t('conversation.history.confirmDelete')}
                  cancelText={t('conversation.history.cancelDelete')}
                  onOk={(event) => {
                    event.stopPropagation();
                    handleRemoveConversation(conversation.id);
                  }}
                  onCancel={(event) => {
                    event.stopPropagation();
                  }}
                >
                  <span
                    className='flex-center'
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    <DeleteOne theme='outline' size='20' className='flex' />
                  </span>
                </Popconfirm>
              )}
            </div>
          )}
          {/* legacy hover overlay removed to avoid duplicate edit icon */}
        </div>
      </Tooltip>
    );
  };

  // Recent section: exclude cron-created run records (tagged with `extra.cronJobId`).
  // Pre-bound user conversations stay in their original timeline slot.
  const recentConvs = chatHistory.filter((c) => !(c.extra as any)?.cronJobId);

  // Scheduled section: one group per cron job, sourced from the cron jobs table
  // so a single conversation bound to multiple jobs appears in multiple groups.
  const convById = new Map(chatHistory.map((c) => [c.id, c]));
  const runRecordsByJob = new Map<string, TChatConversation[]>();
  chatHistory.forEach((conv) => {
    const jobId = (conv.extra as any)?.cronJobId as string | undefined;
    if (!jobId) return;
    if (!runRecordsByJob.has(jobId)) runRecordsByJob.set(jobId, []);
    runRecordsByJob.get(jobId)!.push(conv);
  });
  const scheduledGroups: { jobName: string; convs: TChatConversation[] }[] = [];
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
    scheduledGroups.push({ jobName: job.name, convs });
  });
  scheduledGroups.sort((a, b) => getActivityTime(b.convs[0]) - getActivityTime(a.convs[0]));

  return (
    <FlexFullContainer>
      <div
        className={classNames('size-full chat-history', {
          'flex-center': !chatHistory.length,
          'flex flex-col overflow-y-auto': !!chatHistory.length,
          'chat-history--collapsed': collapsed,
        })}
      >
        {!chatHistory.length ? (
          <Empty className='chat-history__placeholder' description={t('conversation.history.noHistory')} />
        ) : (
          <>
            {/* ── SCHEDULED SECTION ── */}
            {scheduledGroups.length > 0 && (
              <>
                <div className='chat-history__section px-12px py-8px text-13px text-t-secondary font-bold collapsed-hidden'>{t('cron.sidebar.scheduled', { defaultValue: 'Scheduled' })}</div>
                {scheduledGroups.map(({ jobName, convs }) => {
                  const isExpanded = expandedFolders[jobName] !== false; // default open
                  return (
                    <React.Fragment key={jobName}>
                      {/* Folder header */}
                      <div className='chat-history__item hover:bg-hover px-12px py-8px rd-8px flex items-center gap-6px cursor-pointer shrink-0 collapsed-hidden' onClick={() => toggleFolder(jobName)}>
                        <span className={classNames('text-t-secondary text-12px transition-transform', { 'rotate-90': isExpanded })}>▶</span>
                        <span className='text-14px text-t-primary truncate flex-1'>{jobName}</span>
                      </div>
                      {/* Conversations under this folder */}
                      {isExpanded &&
                        convs.map((conv) => (
                          <div key={conv.id} className='pl-16px'>
                            {renderConversation(conv)}
                          </div>
                        ))}
                    </React.Fragment>
                  );
                })}
              </>
            )}

            {/* ── RECENTS SECTION ── */}
            {recentConvs.map((item) => {
              const timeline = formatTimeline(item);
              return (
                <React.Fragment key={item.id}>
                  {timeline && <div className='chat-history__section px-12px py-8px text-13px text-t-secondary font-bold'>{timeline}</div>}
                  {renderConversation(item)}
                </React.Fragment>
              );
            })}
          </>
        )}
      </div>
    </FlexFullContainer>
  );
};

export default ChatHistory;
