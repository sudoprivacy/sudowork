import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { listConversations } from './conversationApi'

/**
 * 会话历史（计划 Task 5）：展示当前 Moss 用户全部会话（服务端已强制过滤），
 * 不按 source 过滤（对话 Tab 全量）；scheduled Tab 由父组件传入 isScheduled 时
 * 按 source metadata 过滤（cron 创建的会话）。
 */
export function ConversationHistory({ isScheduled }: { isScheduled: boolean }): React.ReactElement {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { data } = useSWR('conversations', listConversations, {
    refreshInterval: 30_000,
  })

  const items = (data?.conversations ?? []).filter((c) => {
    if (!isScheduled) return true
    return Boolean(c.source && c.source.includes('cron'))
  })

  if (items.length === 0) {
    return (
      <div className='size-full f-center text-12px text-tertiary px-3 text-center'>
        {isScheduled ? '暂无定时任务会话' : '暂无历史会话'}
      </div>
    )
  }

  return (
    <div className='size-full overflow-y-auto scrollbar-hide flex flex-col gap-0.5 px-1' data-testid='conversation-history'>
      {items.map((c) => {
        const active = pathname === `/conversation/${c.id}`
        return (
          <button
            key={c.id}
            type='button'
            className={
              active
                ? 'rd-2 bg-active text-left px-2.5 py-2 cursor-pointer border-0 w-full'
                : 'rd-2 hover:bg-hover text-left px-2.5 py-2 cursor-pointer border-0 w-full bg-transparent'
            }
            onClick={() => void navigate(`/conversation/${c.id}`)}
          >
            <div className='text-13px text-foreground truncate'>
              {c.assistantName ?? '会话'}
            </div>
            <div className='text-11px text-tertiary truncate'>
              {formatTime(c.lastActiveAt)} · {c.status}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function formatTime(ts: number | null): string {
  if (!ts) return ''
  const date = new Date(ts)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
}
