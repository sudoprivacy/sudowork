/**
 * 技能库（Hub）技能卡片（结构对齐 Sudowork SkillCard，Apache-2.0, Copyright 2026 SudoPrivacy）。
 * 图标链：icon（COS 解析）→ emoji → 📦 兜底（见 hubIcon.ts）。
 */
import React from 'react'
import { Button } from '@arco-design/web-react'
import { Download } from 'lucide-react'
import { handleHubSkillIconError, resolveHubSkillIcon } from './hubIcon'
import type { SkillItem } from './skillApi'

/** hub 数据的 latestVersion 是 {version,...} 对象（远端注册表形状）；统一取去 v 前缀的版本号（模板统一加 v）。 */
function resolveVersionLabel(value: unknown): string | undefined {
  let label: string | undefined
  if (typeof value === 'string') {
    label = value
  } else if (typeof value === 'object' && value !== null) {
    const v = (value as { version?: unknown }).version
    if (typeof v === 'string') label = v
  }
  return label ? label.replace(/^v/i, '') : undefined
}

export function HubSkillCard({
  skill,
  canManage,
  onDetail,
  onInstall,
}: {
  skill: SkillItem
  canManage: boolean
  onDetail: () => void
  onInstall?: () => void
}): React.ReactElement {
  const displayName = String(skill.display_name ?? skill.displayName ?? skill.name)
  const version = resolveVersionLabel(skill.latestVersion)
  const resolvedIcon = resolveHubSkillIcon(skill.icon)
  return (
    <div
      className='card group flex items-start gap-3 relative overflow-hidden'
      data-testid='skill-card'
      onClick={onDetail}
    >
      <div className='w-12 flex-shrink-0'>
        <div className='size-12 rd-8px overflow-hidden f-center'>
          {resolvedIcon ? (
            <img
              src={resolvedIcon}
              alt={displayName}
              className='w-full h-full object-cover'
              onError={handleHubSkillIconError}
            />
          ) : (
            <div className='w-full h-full f-center text-22px'>{String(skill.emoji ?? '📦')}</div>
          )}
        </div>
      </div>
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-2 pr-14.5 min-w-0'>
          <span className='min-w-0 font-medium text-13px text-foreground truncate'>{displayName}</span>
          {version ? (
            <span className='px-5px py-0 bg-control text-secondary text-10px rd-3px whitespace-nowrap flex-shrink-0 leading-18px'>
              v{version}
            </span>
          ) : null}
        </div>
        <div className='mt-1 min-h-7.5'>
          <div className='text-11px text-secondary line-clamp-2 leading-15px'>
            {String(skill.description ?? '暂无描述')}
          </div>
        </div>
      </div>
      {canManage && onInstall ? (
        <div className='absolute top-1.5 right-2.5' onClick={(e) => e.stopPropagation()}>
          <Button
            shape='circle'
            className='!size-7'
            icon={<Download size={13} />}
            aria-label='安装'
            onClick={onInstall}
          />
        </div>
      ) : null}
    </div>
  )
}
