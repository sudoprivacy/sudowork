/**
 * 任务详情页（布局对齐 Sudowork cron/detail）：PageWrapper back/title/状态 Tag
 * + 信息网格 + 频率块 + 会话链接 + 编辑/删除/立即执行。
 */
import React, { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import useSWR, { useSWRConfig } from 'swr'
import { Button, Message, Popconfirm, Switch, Tag } from '@arco-design/web-react'
import { Pencil, Play, Trash2 } from 'lucide-react'
import { cronApi } from './cronApi'
import { CronRuns } from './CronRuns'
import { CronJobFormDrawer } from './CronJobFormDrawer'

export function CronJobDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { mutate } = useSWRConfig()
  const { data: job } = useSWR(id ? ['cron/job', id] : null, () => cronApi.get(id!))
  const [editOpen, setEditOpen] = useState(false)

  async function handleToggle(enabled: boolean): Promise<void> {
    if (!id) return
    await cronApi.update(id, { enabled })
    void mutate(['cron/job', id])
    void mutate('cron/jobs')
  }

  async function handleTrigger(): Promise<void> {
    if (!id) return
    try {
      await cronApi.trigger(id)
      Message.success('已触发执行')
    } catch (err) {
      Message.error(`触发失败：${(err as Error).message}`)
    }
  }

  async function handleDelete(): Promise<void> {
    if (!id) return
    await cronApi.remove(id)
    Message.success('已删除')
    void navigate('/cron')
  }

  const isPaused = job ? !job.enabled : false

  return (
    <div className='page-wrapper w-full min-h-full box-border overflow-y-auto px-10 pb-4' data-testid='cron-detail-page'>
      <div className='page-content mx-auto w-full max-w-240'>
        {/* 返回 */}
        <div className='inline-flex items-center gap-1 text-13px text-secondary hover:text-foreground hover:bg-base rd-2 px-2 py-1 mb-4 -ml-2 cursor-pointer' onClick={() => void navigate('/cron')}>
          ← 全部定时任务
        </div>

        {/* 头部 */}
        <div className='flex items-start justify-between gap-4 mb-4'>
          <div className='flex flex-col gap-0.5 min-w-0'>
            <h2 className='text-24px font-600 text-foreground my-0 truncate'>{job?.name ?? '任务详情'}</h2>
            <div className='flex items-center gap-2 mt-1'>
              <Tag color={isPaused ? 'orangered' : 'green'} size='small'>
                {isPaused ? '已暂停' : '运行中'}
              </Tag>
              <span className='text-13px text-secondary'>
                下次运行{' '}
                {job?.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : '—'}
              </span>
            </div>
          </div>
          <div className='shrink-0 flex items-center gap-2'>
            <Button type='text' size='small' icon={<Pencil size={14} />} onClick={() => setEditOpen(true)}>
              编辑
            </Button>
            <Popconfirm title='确定要删除此定时任务吗？' onOk={() => void handleDelete()}>
              <Button type='text' size='small' status='danger' icon={<Trash2 size={14} />}>
                删除
              </Button>
            </Popconfirm>
            <Button
              type='primary'
              size='small'
              shape='round'
              icon={<Play size={14} />}
              onClick={() => void handleTrigger()}
            >
              立即执行
            </Button>
          </div>
        </div>

        <div className='space-y-6 mt-6'>
          {/* 信息网格 */}
          <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
            <InfoField label='描述' value={String((job as { description?: string } | undefined)?.description ?? '—')} />
            <InfoField label='执行模式' value={job?.conversationMode === 'reuse' ? '复用已有会话' : '每次新建会话'} />
            <div>
              <div className='text-13px text-secondary mb-1'>指令</div>
              <div className='bg-2 rd-8px px-3 py-2 text-13px break-words whitespace-pre-wrap max-h-30 overflow-y-auto'>
                {job?.payloadMessage ?? '—'}
              </div>
            </div>
            <InfoField label='智能体' value={job?.assistantName ?? '默认'} />
          </div>

          {/* 频率块 */}
          <div>
            <div className='text-13px text-secondary mb-2'>频率</div>
            <div className='flex items-center gap-3'>
              <Switch size='small' checked={!isPaused} onChange={(v) => void handleToggle(v)} />
              <span className='text-14px text-foreground'>
                {job?.schedule ? `${job.schedule.kind}: ${job.schedule.value}` : '—'}
              </span>
            </div>
          </div>

          {/* 会话链接 */}
          <div>
            <div className='text-13px text-secondary mb-1'>跳转到所属会话</div>
            {job?.boundSessionId || job?.lastSessionId ? (
              <span
                className='text-14px text-primary cursor-pointer hover:underline'
                onClick={() => {
                  const sid = job.boundSessionId ?? job.lastSessionId
                  if (sid) void navigate(`/conversation/${sid}`)
                }}
              >
                {String(job.boundSessionId ?? job.lastSessionId ?? '').slice(0, 16)}…
              </span>
            ) : (
              <span className='text-14px text-secondary'>—</span>
            )}
          </div>

          {id ? <CronRuns jobId={id} /> : null}
        </div>
      </div>

      {job ? (
        <CronJobFormDrawer
          visible={editOpen}
          editJob={job}
          onClose={() => setEditOpen(false)}
          onCronDisabled={() => undefined}
          onCreated={() => {
            setEditOpen(false)
            void mutate(['cron/job', id])
            void mutate('cron/jobs')
          }}
        />
      ) : null}
    </div>
  )
}

function InfoField({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div>
      <div className='text-13px text-secondary mb-1'>{label}</div>
      <div className='text-14px text-foreground break-words'>{value}</div>
    </div>
  )
}
