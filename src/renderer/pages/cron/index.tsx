/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Message, Popconfirm, Switch, Tag } from '@arco-design/web-react';
import { Add, AlarmClock, ArrowLeft, DeleteOne, Edit, Info, PlayOne, Sun } from '@icon-park/react';
import dayjs from 'dayjs';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAppMode } from '@renderer/hooks/useAppMode';
import { useEnterpriseSessionMode } from '@renderer/hooks/useEnterpriseSessionMode';
import { emitter } from '@renderer/utils/emitter';
import { ipcBridge } from '@/common';
import type { ICronJob } from '@/common/ipcBridge';
import type { TChatConversation } from '@/common/storage';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import EmptyState from '@/renderer/components/base/EmptyState';
import CronJobFormDrawer from '@/renderer/pages/cron/components/CronJobFormDrawer';
import Item from '@/renderer/pages/cron/components/Item';
import { useAssistantsForCron } from '@/renderer/pages/cron/hooks/useAssistantsForCron';
import { useAllCronJobs } from '@/renderer/pages/cron/hooks/useCronJobs';
import { getJobStatusFlags, unwrapCronResult } from '@/renderer/pages/cron/utils';
import { useAuth } from '@/renderer/context/AuthContext';
import { useConversationTabs } from '@/renderer/pages/conversation/context/ConversationTabsContext';
import PageWrapper from '@renderer/components/base/PageWrapper';

function getCronJobConversationTarget(job: ICronJob): string | undefined {
  const isNewMode = (job.metadata.conversationMode ?? 'new') === 'new';
  if (isNewMode) return job.state.lastConversationId;
  return job.metadata.conversationId || job.state.lastConversationId;
}

// ─── Helper: format relative next run ───

function useFormatNextRunRelative() {
  const { t } = useTranslation();
  return useCallback(
    (nextRunAtMs?: number): string => {
      if (!nextRunAtMs) return '';
      const d = dayjs(nextRunAtMs);
      const now = dayjs();
      const time = d.format('HH:mm');
      if (d.isSame(now, 'day')) return t('cron.create.nextRunToday', { time });
      if (d.isSame(now.add(1, 'day'), 'day')) return t('cron.create.nextRunTomorrow', { time });
      return d.format('MM-DD HH:mm');
    },
    [t]
  );
}

function CronJobCardGrid({ jobs, onSelectJob }: ICronJobCardGridProps) {
  const { t } = useTranslation();
  const formatNextRun = useFormatNextRunRelative();
  return (
    <div className='grid grid-cols-1 md:grid-cols-2 gap-12px'>
      {jobs.map((job) => {
        const { isPaused } = getJobStatusFlags(job);
        return (
          <div key={job.id} className='bg-2 rd-12px px-20px py-16px cursor-pointer hover:bg-3 transition-colors border' onClick={() => onSelectJob(job)}>
            <div className='text-15px font-medium text-foreground mb-8px'>{job.name}</div>
            {!isPaused && job.schedule.description && <div className='text-13px text-secondary mb-8px'>{job.schedule.description}</div>}
            {!isPaused && job.state.nextRunAtMs && (
              <div className='text-13px text-secondary'>
                {t('cron.create.nextRun')} <span className='font-medium text-foreground'>{formatNextRun(job.state.nextRunAtMs)}</span>
              </div>
            )}
            {isPaused && <div className='text-13px text-secondary'>{t('cron.status.paused')}</div>}
          </div>
        );
      })}
    </div>
  );
}

function CronJobDetail({ job, onBack, onEdit, onDelete, onToggle, onTrigger, onNavigate }: ICronJobDetailProps) {
  const { t, i18n } = useTranslation();
  const formatNextRun = useFormatNextRunRelative();
  const { hasError, isPaused } = getJobStatusFlags(job);
  const assistants = useAssistantsForCron();
  const localeKey = i18n.language?.startsWith('zh') ? 'zh-CN' : 'en-US';
  const selectedAssistant = job.metadata.presetAssistantId ? assistants.find((a) => a.id === job.metadata.presetAssistantId) : undefined;
  const assistantName = selectedAssistant ? selectedAssistant.nameI18n?.[localeKey] || selectedAssistant.name || 'Sudo Code' : job.metadata.presetAssistantId || 'Sudo Code';

  return (
    <div className='space-y-24px'>
      {/* Back nav */}
      <div className='flex items-center gap-4px text-13px text-secondary cursor-pointer hover:text-foreground' onClick={onBack}>
        <ArrowLeft theme='outline' size={14} />
        <span>{t('cron.allScheduledTasks', { defaultValue: '全部定时任务' })}</span>
      </div>

      {/* Header */}
      <div className='flex items-start justify-between gap-16px'>
        <div>
          <h2 className='text-22px font-bold text-foreground m-0 mb-8px'>{job.name}</h2>
          <div className='flex items-center gap-8px'>
            <Tag color={hasError ? 'red' : isPaused ? 'orangered' : 'green'} size='small'>
              {hasError ? t('cron.status.error') : isPaused ? t('cron.status.paused') : t('cron.status.active')}
            </Tag>
            {!isPaused && job.state.nextRunAtMs && (
              <span className='text-13px text-secondary'>
                {t('cron.create.nextRun')} {formatNextRun(job.state.nextRunAtMs)}
              </span>
            )}
          </div>
        </div>
        <div className='flex items-center gap-8px shrink-0'>
          <Button type='text' size='small' icon={<Edit theme='outline' size={16} />} onClick={() => onEdit(job)} />
          <Popconfirm title={t('cron.confirmDelete')} onOk={() => onDelete(job.id)}>
            <Button type='text' size='small' status='danger' icon={<DeleteOne theme='outline' size={16} />} />
          </Popconfirm>
          <Button type='primary' size='small' shape='round' icon={<PlayOne theme='outline' />} onClick={() => onTrigger(job.id)}>
            {t('cron.actions.runNow', { defaultValue: '立即执行' })}
          </Button>
        </div>
      </div>

      {/* Info sections */}
      <div className='grid grid-cols-1 md:grid-cols-2 gap-24px'>
        {/* Description */}
        <div>
          <div className='text-13px text-secondary mb-4px'>{t('cron.create.description', { defaultValue: '描述' })}</div>
          <div className='text-14px text-foreground'>{job.schedule.description || '-'}</div>
        </div>
        {/* Instructions / Prompt */}
        <div>
          <div className='text-13px text-secondary mb-4px'>{t('cron.create.prompt', { defaultValue: '指令' })}</div>
          <div className='bg-2 rd-8px px-12px py-8px text-13px text-foreground break-words whitespace-pre-wrap max-h-120px overflow-y-auto'>{job.target.payload.text}</div>
        </div>
        {/* Execution mode */}
        <div>
          <div className='text-13px text-secondary mb-4px'>{t('cron.create.conversationMode', { defaultValue: '执行模式' })}</div>
          <div className='text-14px text-foreground'>{(job.metadata.conversationMode ?? 'new') === 'new' ? t('cron.create.conversationMode.new', { defaultValue: '每次新建会话' }) : t('cron.create.conversationMode.reuse', { defaultValue: '复用已有会话' })}</div>
        </div>
        {/* Working directory */}
        {job.metadata.workspace && (
          <div>
            <div className='text-13px text-secondary mb-4px'>{t('cron.create.workspace', { defaultValue: '工作目录' })}</div>
            <div className='text-14px text-foreground truncate' title={job.metadata.workspace}>
              {job.metadata.workspace.split('/').pop() || job.metadata.workspace}
            </div>
          </div>
        )}
        {/* Assistant */}
        <div>
          <div className='text-13px text-secondary mb-4px'>{t('cron.create.agent', { defaultValue: '数字助手' })}</div>
          <div className='text-14px text-foreground flex items-center gap-6px'>
            {(() => {
              const avatarValue = selectedAssistant?.avatar?.trim();
              if (!avatarValue) return null;
              const resolvedAvatar = resolveExtensionAssetUrl(avatarValue);
              const avatarImage = resolvedAvatar || avatarValue;
              const isImageAvatar = /\.(svg|png|jpe?g|webp|gif)$/i.test(avatarImage) || /^(https?:|aion-asset:\/\/|file:\/\/|data:)/i.test(avatarImage);
              return isImageAvatar ? <img src={avatarImage} alt='' width={16} height={16} style={{ objectFit: 'contain' }} /> : <span style={{ fontSize: 14, lineHeight: '16px' }}>{avatarValue}</span>;
            })()}
            <span>{assistantName}</span>
          </div>
        </div>
      </div>

      {/* Error info */}
      {hasError && job.state.lastError && (
        <div className='bg-red-1 rd-8px px-12px py-8px text-13px text-red-6'>
          <span className='font-medium'>{t('cron.lastError')}:</span> {job.state.lastError}
        </div>
      )}

      {/* Repeats */}
      <div>
        <div className='text-13px text-secondary mb-8px'>{t('cron.create.frequency', { defaultValue: '重复' })}</div>
        <div className='flex items-center gap-12px'>
          <Switch size='small' checked={job.enabled} onChange={(checked) => onToggle(job.id, checked)} />
          <span className='text-14px text-foreground'>{job.schedule.description}</span>
        </div>
      </div>

      {/* Conversation link */}
      {(() => {
        const isNewMode = (job.metadata.conversationMode ?? 'new') === 'new';
        const targetConvId = getCronJobConversationTarget(job);
        let targetConvTitle: string;
        if (isNewMode) {
          targetConvTitle = t('cron.goToLastConversation', { defaultValue: '查看最近执行会话' });
        } else if (job.metadata.conversationId) {
          targetConvTitle = job.metadata.conversationTitle || t('cron.goToConversationLink', { defaultValue: '查看会话' });
        } else {
          // reuse mode without pre-binding — fall back to lastConversationId
          targetConvTitle = t('cron.goToConversationLink', { defaultValue: '查看会话' });
        }
        if (!targetConvId) return null;
        const convId = targetConvId;
        return (
          <div>
            <div className='text-13px text-secondary mb-4px'>{t('cron.goToConversation')}</div>
            <span className='text-14px text-primary cursor-pointer hover:underline' onClick={() => onNavigate(convId)}>
              {targetConvTitle}
            </span>
          </div>
        );
      })()}
    </div>
  );
}

export default function CronPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isEnterprise } = useAppMode();
  const { user } = useAuth();
  const { openTab } = useConversationTabs();
  const canUseLocalCronMode = !isEnterprise || user?.localModeAvailable === true;
  const { sessionMode, setSessionMode } = useEnterpriseSessionMode({
    localModeAvailable: canUseLocalCronMode,
    remoteModeAvailable: isEnterprise,
  });
  const { jobs, loading, error, pauseJob, resumeJob, deleteJob, refetch } = useAllCronJobs();

  // Keep-awake toggle state (only for local mode)
  const [keepAwake, setKeepAwake] = useState(false);
  useEffect(() => {
    if (sessionMode === 'remote') return; // Remote mode doesn't support power save
    ipcBridge.cron.getPowerSaveActive
      .invoke()
      .then((active) => {
        setKeepAwake(active);
      })
      .catch(() => {});
  }, [sessionMode]);

  const handleKeepAwakeChange = async (checked: boolean) => {
    setKeepAwake(checked);
    try {
      await ipcBridge.cron.setPowerSave.invoke({ enabled: checked });
    } catch {
      // revert on failure
      setKeepAwake(!checked);
    }
  };

  // View state
  const [selectedJob, setSelectedJob] = useState<ICronJob | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [editingJob, setEditingJob] = useState<ICronJob | null>(null);

  // Refresh selected job when jobs list updates
  const currentJob = useMemo(() => {
    if (!selectedJob) return null;
    return jobs.find((j) => j.id === selectedJob.id) || null;
  }, [jobs, selectedJob]);

  const handleToggle = async (jobId: string, enabled: boolean) => {
    try {
      if (enabled) {
        await resumeJob(jobId);
        Message.success(t('cron.resumeSuccess'));
      } else {
        await pauseJob(jobId);
        Message.success(t('cron.pauseSuccess'));
      }
    } catch (err) {
      Message.error(String(err));
    }
  };

  const handleDelete = async (jobId: string) => {
    try {
      await deleteJob(jobId);
      Message.success(t('cron.deleteSuccess'));
      setSelectedJob(null);
    } catch (err) {
      Message.error(String(err));
    }
  };

  const handleNavigate = (conversationId: string) => {
    void navigate(`/conversation/${conversationId}`);
  };

  const handleTrigger = async (jobId: string) => {
    try {
      unwrapCronResult(await ipcBridge.cron.triggerJob.invoke({ jobId }));
      const updatedJob = unwrapCronResult(await ipcBridge.cron.getJob.invoke({ jobId }));
      Message.success(t('cron.runNowSuccess'));
      emitter.emit('chat.history.refresh');
      const targetConversationId = updatedJob ? getCronJobConversationTarget(updatedJob) : undefined;
      if (targetConversationId) {
        void navigate(`/conversation/${targetConversationId}`);
        emitter.emit('conversation.remote.sync', targetConversationId);
        window.setTimeout(() => emitter.emit('conversation.remote.sync', targetConversationId), 1000);
        window.setTimeout(() => emitter.emit('conversation.remote.sync', targetConversationId), 3000);
      }
      void refetch();
    } catch (err) {
      Message.error(String(err));
    }
  };

  const handleEdit = (job: ICronJob) => {
    setEditingJob(job);
    setDrawerVisible(true);
  };

  const handleBackToList = useCallback(() => {
    setSelectedJob(null);
  }, []);

  const handleCreate = () => {
    setEditingJob(null);
    setDrawerVisible(true);
  };

  const handleSelectJob = useCallback(
    async (job: ICronJob) => {
      setSelectedJob(job);
      const targetConversationId = getCronJobConversationTarget(job);
      if (targetConversationId) {
        try {
          const result = (await ipcBridge.conversation.get.invoke({ id: targetConversationId })) as TChatConversation | null;
          if (result) {
            openTab(result);
          }
        } catch (error) {
          console.warn('Failed to open cron target conversation:', error);
        }
        emitter.emit('conversation.remote.sync', targetConversationId);
      }
    },
    [openTab]
  );

  return (
    <PageWrapper>
      <div className='flex flex-col h-full w-full'>
        <AionScrollArea className='flex-1 min-h-0 pb-16px' disableOverflow>
          {/* ── DETAIL VIEW ── */}
          {currentJob ? (
            <CronJobDetail job={currentJob} onBack={handleBackToList} onEdit={handleEdit} onDelete={handleDelete} onToggle={handleToggle} onTrigger={handleTrigger} onNavigate={handleNavigate} />
          ) : (
            /* ── LIST VIEW ── */
            <div className='space-y-16px'>
              {/* Header */}
              <div className='flex items-center justify-between gap-16px'>
                <div className='min-w-0'>
                  <h2 className='text-20px font-bold text-foreground m-0 mb-4px'>{t('cron.scheduledTasks')}</h2>
                  <div className='text-13px text-secondary'>{t('cron.create.listSubtitle', { defaultValue: '设定定时任务，让 Agent 按计划自动执行' })}</div>
                </div>
                {jobs.length > 0 && (
                  <Button type='primary' shape='round' onClick={handleCreate}>
                    <span className='inline-flex items-center justify-center gap-4px'>
                      <Add theme='outline' size={14} className='block' />
                      <span>{t('cron.create.button', { defaultValue: '新建任务' })}</span>
                    </span>
                  </Button>
                )}
              </div>

              {/* Enterprise mode: Remote/Local switcher */}
              {isEnterprise && (
                <div className='bg-2 rd-12px px-16px py-12px flex items-center justify-between'>
                  <div className='flex items-center gap-8px text-13px text-secondary'>
                    <Info theme='outline' size={16} fill={'var(--text-secondary)'} />
                    <span>{t('cron.mode.select', { defaultValue: '数据存储位置' })}</span>
                  </div>
                  <div className='flex items-center gap-4px'>
                    {canUseLocalCronMode && (
                      <Button size='small' shape='round' type={sessionMode === 'local' ? 'primary' : 'text'} onClick={() => setSessionMode('local')}>
                        {t('cron.mode.local', { defaultValue: '本地' })}
                      </Button>
                    )}
                    <Button size='small' shape='round' type={sessionMode === 'remote' ? 'primary' : 'text'} onClick={() => setSessionMode('remote')}>
                      {t('cron.mode.remote', { defaultValue: '云端' })}
                    </Button>
                  </div>
                </div>
              )}

              {/* Error state (remote mode: Moss API unavailable) */}
              {error && sessionMode === 'remote' && (
                <div className='bg-red-1 rd-12px px-16px py-12px flex items-center justify-between'>
                  <div className='flex items-center gap-8px text-13px text-red-6'>
                    <Info theme='outline' size={16} />
                    <span>{t('cron.error.serverUnavailable', { defaultValue: '无法连接服务器' })}</span>
                  </div>
                  <Button size='small' shape='round' onClick={() => void refetch()}>
                    {t('common.retry', { defaultValue: '重试' })}
                  </Button>
                </div>
              )}

              {/* Info banner (local mode only) */}
              {sessionMode === 'local' && (
                <div className='overflow-hidden rd-12px border'>
                  <Item
                    icon={<Sun theme='outline' size={20} />}
                    title={t('cron.create.keepAwake', { defaultValue: '保持唤醒' })}
                    description={t('cron.create.awakeBanner', { defaultValue: '定时任务仅在电脑唤醒时运行' })}
                    status={<span className='text-13px text-secondary'>{keepAwake ? t('common.enabled', { defaultValue: '已启用' }) : t('common.disabled', { defaultValue: '已关闭' })}</span>}
                    action={<Switch size='small' className='cron-keep-awake-switch' checked={keepAwake} onChange={handleKeepAwakeChange} />}
                  />
                </div>
              )}

              {/* Job cards or empty state */}
              {!loading && jobs.length === 0 ? (
                <EmptyState
                  simple
                  icon={<AlarmClock theme='outline' size={56} className='text-[var(--ui-accent-orange)]' />}
                  title={t('cron.noTasks', { defaultValue: '暂无定时任务' })}
                  description={t('cron.create.emptyHint', { defaultValue: '创建自动执行的 Agent 任务' })}
                  actions={[{ label: t('cron.create.button', { defaultValue: '新建任务' }), onClick: handleCreate }]}
                />
              ) : (
                <CronJobCardGrid jobs={jobs} onSelectJob={handleSelectJob} />
              )}
            </div>
          )}
        </AionScrollArea>

        <CronJobFormDrawer visible={drawerVisible} editJob={editingJob} sessionMode={sessionMode} onClose={() => setDrawerVisible(false)} onSaved={() => void refetch()} />
      </div>
    </PageWrapper>
  );
}

interface ICronJobCardGridProps {
  jobs: ICronJob[];
  onSelectJob: (job: ICronJob) => void;
}

interface ICronJobDetailProps {
  job: ICronJob;
  onBack: () => void;
  onEdit: (job: ICronJob) => void;
  onDelete: (jobId: string) => void;
  onToggle: (jobId: string, enabled: boolean) => void;
  onTrigger: (jobId: string) => void;
  onNavigate: (conversationId: string) => void;
}
