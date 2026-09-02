import React from 'react'
import useSWR from 'swr'
import { Table, Tag } from '@arco-design/web-react'
import { cronApi } from './cronApi'

interface RunRow {
  id?: string
  startedAt?: number | string | null
  finishedAt?: number | string | null
  status?: string | null
  sessionId?: string | null
  error?: string | null
  [key: string]: unknown
}

/** 运行历史（计划 Task 7）。 */
export function CronRuns({ jobId }: { jobId: string }): React.ReactElement {
  const { data } = useSWR(['cron/runs', jobId], () => cronApi.runs(jobId, 20))
  const rows: RunRow[] = Array.isArray(data)
    ? (data as RunRow[])
    : ((data as { runs?: RunRow[]; data?: RunRow[] })?.runs ??
      (data as { data?: RunRow[] })?.data ??
      [])

  return (
    <div className='flex flex-col gap-2' data-testid='cron-runs'>
      <div className='text-15px font-600'>运行历史</div>
      <Table rowKey={(record: RunRow) => String(record.id ?? Math.random())} data={rows} pagination={false} columns={[
        {
          title: '开始时间',
          render: (_v, row: RunRow) => formatTime(row.startedAt),
        },
        {
          title: '状态',
          width: 110,
          render: (_v, row: RunRow) => {
            const status = row.status ?? '—'
            return (
              <Tag size='small' color={status === 'success' ? 'green' : status === 'failed' ? 'red' : 'gray'}>
                {String(status)}
              </Tag>
            )
          },
        },
        {
          title: '关联会话',
          render: (_v, row: RunRow) =>
            row.sessionId ? String(row.sessionId).slice(0, 12) + '…' : '—',
        },
        {
          title: '错误',
          ellipsis: true,
          render: (_v, row: RunRow) => row.error ?? '—',
        },
      ]} />
    </div>
  )
}

function formatTime(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return '—'
  const date = new Date(typeof v === 'number' ? v : v)
  return Number.isNaN(date.getTime()) ? String(v) : date.toLocaleString()
}
