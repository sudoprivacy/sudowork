/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Message, Popconfirm, Switch, Tag } from '@arco-design/web-react';
import { IconDelete, IconEdit, IconPlayArrow } from '@arco-design/web-react/icon';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useAppMode } from '@renderer/hooks/useAppMode';
import { emitter } from '@renderer/utils/emitter';
import { ipcBridge } from '@/common';
import type { ICronJob } from '@/common/ipcBridge';
import type { TChatConversation } from '@/common/storage';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import CronJobFormDrawer from '@/renderer/pages/cron/components/CronJobFormDrawer';
import { useAssistantsForCron } from '@/renderer/pages/cron/hooks/useAssistantsForCron';
import { formatNextRunRelative, getJobStatusFlags, unwrapCronResult } from '@/renderer/pages/cron/utils';
import { useConversationTabs } from '@/renderer/pages/conversation/context/ConversationTabsContext';
import PageWrapper from '@renderer/components/base/PageWrapper';

function getCronJobConversationTarget(job: ICronJob): string | undefined {
  const isNewMode = (job.metadata.conversationMode ?? 'new') === 'new';
  if (isNewMode) return job.state.lastConversationId;
  return job.metadata.conversationId || job.state.lastConversationId;
}

export default function CronJobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { isEnterprise } = useAppMode();
  const { openTab } = useConversationTabs();
  // Enterprise scheduled tasks are always moss-hosted; consumer mode is local.
  const sessionMode: 'remote' | 'local' = isEnterprise ? 'remote' : 'local';
  const [job, setJob] = useState<ICronJob | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const assistants = useAssistantsForCron();
  const localeKey = i18n.language?.startsWith('zh') ? 'zh-CN' : 'en-US';

  // Fetch fresh job data on mount
  useEffect(() => {
    if (!jobId) return;
    void (async () => {
      const result = await ipcBridge.cron.getJob.invoke({ jobId });
      setJob(result);
      if (result) {
        const targetConvId = getCronJobConversationTarget(result);
        if (targetConvId) {
          try {
            const conv = (await ipcBridge.conversation.get.invoke({ id: targetConvId })) as TChatConversation | null;
            if (conv) openTab(conv);
          } catch {
            // ignore — conversation tab is best-effort
          }
          emitter.emit('conversation.remote.sync', targetConvId);
        }
      }
    })();
  }, [jobId, openTab]);

  // Keep job state in sync with background updates
  useEffect(() => {
    if (!jobId) return;
    return ipcBridge.cron.onJobUpdated.on((updated: ICronJob) => {
      if (updated.id === jobId) setJob(updated);
    });
  }, [jobId]);

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      const updated = unwrapCronResult(await ipcBridge.cron.updateJob.invoke({ jobId: id, updates: { enabled } }));
      setJob(updated);
      Message.success(enabled ? t('cron.resumeSuccess', '任务已恢复') : t('cron.pauseSuccess', '任务已暂停'));
    } catch (err) {
      Message.error(String(err));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      unwrapCronResult(await ipcBridge.cron.removeJob.invoke({ jobId: id }));
      Message.success(t('cron.deleteSuccess', '任务已删除'));
      emitter.emit('cron.jobs.refresh');
      void navigate(-1);
    } catch (err) {
      Message.error(String(err));
    }
  };

  const handleTrigger = async (id: string) => {
    try {
      unwrapCronResult(await ipcBridge.cron.triggerJob.invoke({ jobId: id }));
      const updatedJob = await ipcBridge.cron.getJob.invoke({ jobId: id });
      Message.success(t('cron.runNowSuccess', '任务已触发执行'));
      emitter.emit('chat.history.refresh');
      if (updatedJob) {
        setJob(updatedJob);
        const targetConversationId = getCronJobConversationTarget(updatedJob);
        if (targetConversationId) {
          void navigate(`/conversation/${targetConversationId}`);
          emitter.emit('conversation.remote.sync', targetConversationId);
          window.setTimeout(() => emitter.emit('conversation.remote.sync', targetConversationId), 1000);
          window.setTimeout(() => emitter.emit('conversation.remote.sync', targetConversationId), 3000);
        }
      }
    } catch (err) {
      Message.error(String(err));
    }
  };

  const handleSaved = async () => {
    if (!jobId) return;
    const updated = await ipcBridge.cron.getJob.invoke({ jobId });
    if (updated) setJob(updated);
  };

  if (!job) return null;

  const { hasError, isPaused } = getJobStatusFlags(job);
  const selectedAssistant = job.metadata.presetAssistantId ? assistants.find((a) => a.id === job.metadata.presetAssistantId) : undefined;
  const assistantName = selectedAssistant ? selectedAssistant.nameI18n?.[localeKey] || selectedAssistant.name || 'Sudo Code' : job.metadata.presetAssistantId || 'Sudo Code';

  const targetConvId = getCronJobConversationTarget(job);
  const isNewMode = (job.metadata.conversationMode ?? 'new') === 'new';

  return (
    <PageWrapper
      back={{ label: t('cron.allScheduledTasks', '全部定时任务'), onClick: () => void navigate(-1) }}
      title={job.name}
      subtitle={
        <div className='flex items-center gap-2 mt-1'>
          <Tag color={hasError ? 'red' : isPaused ? 'orangered' : 'green'} size='small'>
            {hasError ? t('cron.status.error', '执行出错') : isPaused ? t('cron.status.paused', '已暂停') : t('cron.status.active', '运行中')}
          </Tag>
          {!isPaused && job.state.nextRunAtMs && (
            <span>
              {t('cron.create.nextRun', '下次运行')} {formatNextRunRelative(t, job.state.nextRunAtMs)}
            </span>
          )}
        </div>
      }
      actions={
        <>
          <Button type='text' size='small' icon={<IconEdit />} onClick={() => setDrawerVisible(true)} />
          <Popconfirm title={t('cron.confirmDelete', '确定要删除此定时任务吗？')} onOk={() => void handleDelete(job.id)}>
            <Button type='text' size='small' status='danger' icon={<IconDelete />} />
          </Popconfirm>
          <Button type='primary' size='small' shape='round' icon={<IconPlayArrow />} onClick={() => void handleTrigger(job.id)}>
            {t('cron.actions.runNow', '立即执行')}
          </Button>
        </>
      }
    >
      <div className='space-y-6 mt-6'>
        {/* Info sections */}
        <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
          <div>
            <div className='text-13px text-secondary mb-1'>{t('cron.create.description', '描述')}</div>
            <div className='text-14px text-foreground'>{job.schedule.description || '-'}</div>
          </div>
          <div>
            <div className='text-13px text-secondary mb-1'>{t('cron.create.prompt', '指令')}</div>
            <div className='bg-2 rd-8px px-3 py-2 text-13px text-foreground break-words whitespace-pre-wrap max-h-30 overflow-y-auto'>{job.target.payload.text}</div>
          </div>
          <div>
            <div className='text-13px text-secondary mb-1'>{t('cron.create.conversationMode', '执行模式')}</div>
            <div className='text-14px text-foreground'>{(job.metadata.conversationMode ?? 'new') === 'new' ? t('cron.create.conversationMode.new', '每次新建会话') : t('cron.create.conversationMode.reuse', '复用已有会话')}</div>
          </div>
          {job.metadata.workspace && (
            <div>
              <div className='text-13px text-secondary mb-1'>{t('cron.create.workspace', '工作目录')}</div>
              <div className='text-14px text-foreground truncate' title={job.metadata.workspace}>
                {job.metadata.workspace.split('/').pop() || job.metadata.workspace}
              </div>
            </div>
          )}
          <div>
            <div className='text-13px text-secondary mb-1'>{t('cron.create.agent', '智能体')}</div>
            <div className='text-14px text-foreground flex items-center gap-1.5'>
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
          <div className='bg-red-1 rd-8px px-3 py-2 text-13px text-red-6'>
            <span className='font-medium'>{t('cron.lastError', '错误信息')}:</span> {job.state.lastError}
          </div>
        )}

        {/* Repeats */}
        <div>
          <div className='text-13px text-secondary mb-2'>{t('cron.create.frequency', '频率')}</div>
          <div className='flex items-center gap-3'>
            <Switch size='small' checked={job.enabled} onChange={(checked) => void handleToggle(job.id, checked)} />
            <span className='text-14px text-foreground'>{job.schedule.description}</span>
          </div>
        </div>

        {/* Conversation link */}
        {targetConvId && (
          <div>
            <div className='text-13px text-secondary mb-1'>{t('cron.goToConversation', '跳转到所属会话')}</div>
            <span className='text-14px text-primary cursor-pointer hover:underline' onClick={() => void navigate(`/conversation/${targetConvId}`)}>
              {isNewMode ? t('cron.goToLastConversation', '查看最近执行会话') : job.metadata.conversationTitle || t('cron.goToConversationLink', '查看会话')}
            </span>
          </div>
        )}
      </div>
      <CronJobFormDrawer visible={drawerVisible} editJob={job} sessionMode={sessionMode} onClose={() => setDrawerVisible(false)} onSaved={() => void handleSaved()} />
    </PageWrapper>
  );
}
