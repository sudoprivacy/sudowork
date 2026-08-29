import React from 'react'
import { Button, Switch } from '@arco-design/web-react'
import type { SkillItem } from './skillApi'

export function SkillCard({
  skill,
  canManage,
  onDetail,
  onToggle,
  onUninstall,
}: {
  skill: SkillItem
  canManage: boolean
  onDetail: () => void
  onToggle: (enabled: boolean) => void
  onUninstall: () => void
}): React.ReactElement {
  const enabled = skill.enabled !== false
  return (
    <div className='card flex flex-col gap-2' data-testid='skill-card'>
      <div className='flex items-start justify-between gap-2'>
        <div className='text-15px font-600 text-foreground truncate' title={skill.name}>
          {skill.name}
        </div>
        {canManage ? (
          <Switch size='small' checked={enabled} onChange={(v) => onToggle(v)} />
        ) : null}
      </div>
      <div className='text-13px text-secondary line-clamp-2 min-h-9'>
        {String(skill.description ?? '暂无描述')}
      </div>
      <div className='flex gap-2 mt-auto pt-1'>
        <Button size='mini' type='outline' onClick={onDetail}>
          详情
        </Button>
        {canManage ? (
          <Button size='mini' status='danger' type='outline' onClick={onUninstall}>
            卸载
          </Button>
        ) : null}
      </div>
    </div>
  )
}
