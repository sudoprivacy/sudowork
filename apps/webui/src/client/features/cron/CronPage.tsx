/**
 * 定时任务列表页（布局对齐 Sudowork cron 页）：PageWrapper 标题区 + 2 列卡片网格。
 */
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useSWR, { useSWRConfig } from 'swr'
import { Button, Switch } from '@arco-design/web-react'
import { AlarmClock, Plus } from 'lucide-react'
import { cronApi, type CronJob } from './cronApi'
import { CronJobFormDrawer } from './CronJobFormDrawer'

export function CronPage(): React.ReactElement {
  const navigate = useNavigate()
  const { mutate } = useSWRConfig()
  const { data } = useSWR('cron/jobs', cronApi.list)
  const [formOpen, setFormOpen] = useState(false)
  const [cronDisabled, setCronDisabled] = useState(false)

  const jobs = data?.jobs ?? []
  const canCreate = (data?.canCreate ?? false) && !cronDisabled

  async function handleToggle(job: CronJob, enabled: boolean): Promise<void> {
    await cronApi.update(job.id, { enabled })
    void mutate('cron/jobs')
  }

  return (
    <div className='page-wrapper w-full min-h-full box-border overflow-y-auto px-10 pb-4' data-testid='cron-page'>
      <div className='page-content mx-auto w-full max-w-240'>
        {/* 头部（PageWrapper title/subtitle/actions） */}
        <div className='flex items-start justify-between gap-4 mb-4'>
          <div className='flex flex-col gap-0.5'>
            <h2 className='text-24px font-600 text-foreground my-0'>定时任务</h2>
            <div className='text-13px text-secondary'>设定定时任务，让 Agent 按计划自动执行</div>
          </div>
          <div className='shrink-0 flex items-center gap-2'>
            {canCreate ? (
              <Button
                type='primary'
                shape='round'
                icon={<Plus size={13} />}
                onClick={() => setFormOpen(true)}
              >
                新建任务
              </Button>
            ) : null}
          </div>
        </div>

        {/* 任务网格（2 列卡片） */}
        {jobs.length === 0 ? (
          <div className='flex flex-col items-center justify-center py-10 px-5 text-center'>
            <AlarmClock size={56} className='text-secondary' />
            <div className='text-16px font-500 text-foreground mt-3'>暂无定时任务</div>
            <div className='text-13px text-secondary mt-1'>创建自动执行的 Agent 任务</div>
            {canCreate ? (
              <Button
                type='primary'
                shape='round'
                className='mt-4 px-5 min-w-25 hover:-translate-y-1px transition-transform'
                onClick={() => setFormOpen(true)}
              >
                新建任务
              </Button>
            ) : null}
          </div>
        ) : (
          <div className='space-y-4'>
            <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className='card'
                  onClick={() => void navigate(`/cron/${job.id}`)}
                >
                  <div className='flex items-start justify-between gap-2'>
                    <div className='text-15px font-medium text-foreground mb-2 truncate'>{job.name}</div>
                    <Switch
                      size='small'
                      checked={job.enabled}
                      onChange={(v) => {
                        void handleToggle(job, v)
                      }}
                      className={job.enabled ? '!bg-primary !border-[var(--ui-accent-orange)]' : ''}
                    />
                  </div>
                  <div className='text-13px text-secondary mb-2'>
                    {job.schedule ? `${job.schedule.kind}: ${job.schedule.value}` : ''}
                  </div>
                  <div className='text-13px text-secondary'>
                    {job.enabled ? (
                      <>
                        下次运行{' '}
                        <span className='font-medium text-foreground'>
                          {job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : '—'}
                        </span>
                      </>
                    ) : (
                      '已暂停'
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <CronJobFormDrawer
        visible={formOpen}
        onClose={() => setFormOpen(false)}
        onCronDisabled={() => setCronDisabled(true)}
        onCreated={() => {
          setFormOpen(false)
          void mutate('cron/jobs')
        }}
      />
    </div>
  )
}
