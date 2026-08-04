/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Switch } from '@arco-design/web-react';
import { IconPlus } from '@arco-design/web-react/icon';
import { AlarmClock, Info, Sun } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAppMode } from '@renderer/hooks/useAppMode';
import { useCronAccess } from '@renderer/hooks/useCronAccess';
import { useAddEventListener } from '@renderer/utils/emitter';
import { ipcBridge } from '@/common';
import type { ICronJob } from '@/common/ipcBridge';
import EmptyState from '@/renderer/components/base/EmptyState';
import CronJobFormDrawer from '@/renderer/pages/cron/components/CronJobFormDrawer';
import Item from '@/renderer/pages/cron/components/Item';
import { useAllCronJobs } from '@/renderer/pages/cron/hooks/useCronJobs';
import { getJobStatusFlags } from '@/renderer/pages/cron/utils';
import PageWrapper from '@renderer/components/base/PageWrapper';

function CronJobCardGrid({ jobs, onSelectJob }: ICronJobCardGridProps) {
  const { t } = useTranslation();
  return (
    <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
      {jobs.map((job) => {
        const { isPaused } = getJobStatusFlags(job);
        return (
          <div key={job.id} className='card' onClick={() => onSelectJob(job)}>
            <div className='text-15px font-medium text-foreground mb-2'>{job.name}</div>
            {!isPaused && job.schedule.description && <div className='text-13px text-secondary mb-2'>{job.schedule.description}</div>}
            {!isPaused && job.state.nextRunAtMs && (
              <div className='text-13px text-secondary'>
                {t('cron.create.nextRun', '下次运行')} <span className='font-medium text-foreground'>{job.state.nextRunAtMs}</span>
              </div>
            )}
            {isPaused && <div className='text-13px text-secondary'>{t('cron.status.paused', '已暂停')}</div>}
          </div>
        );
      })}
    </div>
  );
}

export default function CronPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isEnterprise } = useAppMode();
  // Creation is gated by the org flag (admins bypass); owners/co-owners keep
  // view/edit/run/delete on their existing jobs even while creation is disabled.
  const { isCronCreateEnabled } = useCronAccess();
  // Enterprise scheduled tasks are always moss-hosted (the legacy enterprise
  // "local" cron mode is deprecated); consumer mode is always local.
  const sessionMode: 'remote' | 'local' = isEnterprise ? 'remote' : 'local';
  const { jobs, loading, error, refetch } = useAllCronJobs();

  const [keepAwake, setKeepAwake] = useState(false);
  useEffect(() => {
    if (sessionMode === 'remote') return;
    ipcBridge.cron.getPowerSaveActive
      .invoke()
      .then((active) => setKeepAwake(active))
      .catch(() => {});
  }, [sessionMode]);

  useAddEventListener('cron.jobs.refresh', () => void refetch());

  const handleKeepAwakeChange = async (checked: boolean) => {
    setKeepAwake(checked);
    try {
      await ipcBridge.cron.setPowerSave.invoke({ enabled: checked });
    } catch {
      setKeepAwake(!checked);
    }
  };

  const [drawerVisible, setDrawerVisible] = useState(false);

  return (
    <PageWrapper
      title={t('cron.scheduledTasks', '定时任务')}
      subtitle={t('cron.create.listSubtitle', '设定定时任务，让 Agent 按计划自动执行')}
      actions={
        jobs.length > 0 &&
        isCronCreateEnabled && (
          <Button type='primary' shape='round' icon={<IconPlus />} onClick={() => setDrawerVisible(true)}>
            {t('cron.create.button', '新建任务')}
          </Button>
        )
      }
    >
      <div className='space-y-4'>
        {/* Error state (remote mode) */}
        {error && sessionMode === 'remote' && (
          <div className='bg-red-1 rd-12px px-4 py-3 flex items-center justify-between'>
            <div className='flex items-center gap-2 text-13px text-red-6'>
              <Info size={16} />
              <span>{t('cron.error.serverUnavailable', '无法连接服务器')}</span>
            </div>
            <Button size='small' shape='round' onClick={() => void refetch()}>
              {t('common.retry', '重试')}
            </Button>
          </div>
        )}

        {/* Keep-awake banner (local mode only) */}
        {sessionMode === 'local' && (
          <Item
            icon={<Sun size={20} />}
            title={t('cron.create.keepAwake', '保持唤醒')}
            description={t('cron.create.awakeBanner', '定时任务仅在电脑唤醒时运行')}
            status={<span className='text-13px text-secondary'>{keepAwake ? t('common.enabled', '已启用') : t('common.disabled', '已关闭')}</span>}
            action={<Switch size='small' checked={keepAwake} onChange={handleKeepAwakeChange} />}
          />
        )}

        {/* Job cards or empty state */}
        {!loading && jobs.length === 0 ? (
          <EmptyState
            simple
            icon={<AlarmClock size={56} className='text-secondary' />}
            title={t('cron.noTasks', '暂无定时任务')}
            description={t('cron.create.emptyHint', '创建自动执行的 Agent 任务')}
            actions={isCronCreateEnabled ? [{ label: t('cron.create.button', '新建任务'), onClick: () => setDrawerVisible(true) }] : undefined}
          />
        ) : (
          <CronJobCardGrid jobs={jobs} onSelectJob={(job) => void navigate(`/app/cron/${job.id}`)} />
        )}
      </div>

      <CronJobFormDrawer visible={drawerVisible} editJob={null} sessionMode={sessionMode} onClose={() => setDrawerVisible(false)} onSaved={() => void refetch()} />
    </PageWrapper>
  );
}

interface ICronJobCardGridProps {
  jobs: ICronJob[];
  onSelectJob: (job: ICronJob) => void;
}
