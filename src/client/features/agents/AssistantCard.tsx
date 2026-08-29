import React from 'react'
import { Button, Tag } from '@arco-design/web-react'
import type { AgentItem } from './agentApi'

export function AssistantCard({
  agent,
  canManage,
  onDetail,
  onInstall,
  onUninstall,
}: {
  agent: AgentItem
  canManage: boolean
  onDetail: () => void
  onInstall?: () => void
  onUninstall?: () => void
}): React.ReactElement {
  const displayName = String(agent.displayName ?? agent.name ?? '')
  return (
    <div className='card flex flex-col gap-2' data-testid='assistant-card'>
      <div className='flex items-start justify-between gap-2'>
        <div className='text-15px font-600 text-foreground truncate' title={displayName}>
          {displayName}
        </div>
        {agent.meta?.feature ? <Tag size='small'>{String(agent.meta.feature)}</Tag> : null}
      </div>
      <div className='text-13px text-secondary line-clamp-2 min-h-9'>
        {String(agent.description ?? '暂无描述')}
      </div>
      <div className='flex gap-2 mt-auto pt-1'>
        <Button size='mini' type='outline' onClick={onDetail}>
          详情
        </Button>
        {onInstall && canManage ? (
          <Button size='mini' type='primary' onClick={onInstall}>
            安装
          </Button>
        ) : null}
        {onUninstall && canManage ? (
          <Button size='mini' status='danger' type='outline' onClick={onUninstall}>
            卸载
          </Button>
        ) : null}
      </div>
    </div>
  )
}
