import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useSWR, { useSWRConfig } from 'swr'
import { Button, Message, Switch, Table } from '@arco-design/web-react'
import { cronApi, type CronJob } from './cronApi'
import { CronJobFormDrawer } from './CronJobFormDrawer'

/**
 * 定时任务列表（计划 Task 7）：
 * canCreate 投影；创建收到 CRON_DISABLED_BY_ORG 时降级隐藏创建入口。
 */
export function CronPage(): React.ReactElement {
  const navigate = useNavigate()
  const { mutate } = useSWRConfig()
  const { data } = useSWR('cron/jobs', cronApi.list)
  const [formOpen, setFormOpen] = useState(false)
  const [cronDisabled, setCronDisabled] = useState(false)

  const jobs = data?.jobs ?? []
  const canCreate = (data?.canCreate ?? false) && !cronDisabled

  async function handleToggle(job: CronJob, enabled: boolean): Promise<void> {
    try {
      await cronApi.update(job.id, { enabled })
      void mutate('cron/jobs')
    } catch {
      Message.error('操作失败')
    }
  }

  async function handleTrigger(job: CronJob): Promise<void> {
    try {
      await cronApi.trigger(job.id)
      Message.success(`已触发 ${job.name}`)
    } catch (err) {
      Message.error(`触发失败：${(err as Error).message}`)
    }
  }

  async function handleDelete(job: CronJob): Promise<void> {
    try {
      await cronApi.remove(job.id)
      Message.success(`已删除 ${job.name}`)
      void mutate('cron/jobs')
    } catch {
      Message.error('删除失败')
    }
  }

  return (
    <div className='size-full overflow-y-auto p-5' data-testid='cron-page'>
      <div className='max-w-5xl mx-auto flex flex-col gap-4'>
        <div className='flex items-center justify-between'>
          <h1 className='text-20px font-700 m-0'>定时任务</h1>
          {canCreate ? <Button size='small' type='primary' onClick={() => setFormOpen(true)}>新建任务</Button> : null}
        </div>

        <Table
          rowKey='id'
          data={jobs}
          pagination={false}
          columns={[
            { title: '名称', dataIndex: 'name', render: (_v, row: CronJob) => (
              <span
                className='cursor-pointer text-[var(--primary)]'
                onClick={() => void navigate(`/cron/${row.id}`)}
              >
                {row.name}
              </span>
            ) },
            {
              title: '调度',
              render: (_v, row: CronJob) =>
                `${row.schedule?.kind ?? ''}: ${row.schedule?.value ?? ''}`,
            },
            { title: '模式', dataIndex: 'conversationMode', width: 90 },
            {
              title: '上次状态',
              dataIndex: 'lastStatus',
              width: 100,
              render: (v: string | null) => v ?? '—',
            },
            {
              title: '启用',
              width: 80,
              render: (_v, row: CronJob) => (
                <Switch size='small' checked={row.enabled} onChange={(v) => void handleToggle(row, v)} />
              ),
            },
            {
              title: '操作',
              width: 150,
              render: (_v, row: CronJob) => (
                <div className='flex gap-1'>
                  <Button size='mini' onClick={() => void handleTrigger(row)}>触发</Button>
                  <Button size='mini' status='danger' type='outline' onClick={() => void handleDelete(row)}>
                    删除
                  </Button>
                </div>
              ),
            },
          ]}
        />
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
