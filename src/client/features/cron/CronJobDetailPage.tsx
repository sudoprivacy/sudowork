import React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import useSWR from 'swr'
import { Button, Descriptions } from '@arco-design/web-react'
import { cronApi } from './cronApi'
import { CronRuns } from './CronRuns'

/** 任务详情 + 运行历史（计划 Task 7）。 */
export function CronJobDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: job } = useSWR(id ? ['cron/job', id] : null, () => cronApi.get(id!))

  return (
    <div className='size-full overflow-y-auto p-5' data-testid='cron-detail-page'>
      <div className='max-w-3xl mx-auto flex flex-col gap-4'>
        <div className='flex items-center gap-3'>
          <Button size='small' onClick={() => void navigate('/cron')}>返回</Button>
          <h1 className='text-18px font-700 m-0'>{job?.name ?? '任务详情'}</h1>
        </div>

        <Descriptions
          column={2}
          data={[
            { label: '调度', value: job ? `${job.schedule?.kind}: ${job.schedule?.value}` : '' },
            { label: '时区', value: job?.schedule?.tz ?? '默认' },
            { label: '模式', value: job?.conversationMode ?? '' },
            { label: '绑定会话', value: job?.boundSessionId ? String(job.boundSessionId).slice(0, 12) + '…' : '—' },
            { label: '智能体', value: job?.assistantName ?? '—' },
            { label: '状态', value: job?.enabled ? '启用' : '停用' },
          ]}
        />

        {job?.payloadMessage ? (
          <div className='text-13px text-secondary border border-light rd-2 p-3 whitespace-pre-wrap'>
            {job.payloadMessage}
          </div>
        ) : null}

        {id ? <CronRuns jobId={id} /> : null}
      </div>
    </div>
  )
}
