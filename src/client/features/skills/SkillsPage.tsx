/**
 * 技能库页（布局对齐 Sudowork skills 页）：Tabs + 搜索 + 2 列卡片网格。
 */
import React, { useMemo, useState } from 'react'
import { Button, Input, Message, Popconfirm, Spin, Switch } from '@arco-design/web-react'
import { Search, Trash2, Zap } from 'lucide-react'
import { useSkills } from './useSkills'
import { skillApi, type SkillItem } from './skillApi'
import { SkillDetailModal } from './SkillDetailModal'

type TabKey = 'store' | 'installed'

export function SkillsPage(): React.ReactElement {
  const { installed, isLoading, canManage, refresh } = useSkills()
  const [tab, setTab] = useState<TabKey>('installed')
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<SkillItem | null>(null)

  const filtered = useMemo(
    () =>
      installed.filter(
        (s) =>
          !search ||
          String(s.display_name ?? s.displayName ?? s.name).toLowerCase().includes(search.toLowerCase()),
      ),
    [installed, search],
  )

  async function handleToggle(skill: SkillItem, enabled: boolean): Promise<void> {
    try {
      await skillApi.setEnabled(skill.name, enabled)
      Message.success(`${skill.name} 已${enabled ? '启用' : '停用'}`)
      refresh()
    } catch (err) {
      Message.error(`操作失败：${(err as Error).message}`)
    }
  }

  async function handleUninstall(name: string): Promise<void> {
    try {
      await skillApi.uninstall(name)
      Message.success(`已卸载 ${name}`)
      refresh()
    } catch (err) {
      Message.error(`卸载失败：${(err as Error).message}`)
    }
  }

  return (
    <div className='page-wrapper w-full min-h-full box-border overflow-y-auto px-10 pb-4' data-testid='skills-page'>
      <div className='page-content mx-auto w-full max-w-240 flex flex-col h-full'>
        {/* 顶部：Tabs + 搜索 */}
        <div className='flex items-center gap-6 mb-3'>
          <div className='flex flex-wrap items-end gap-5 border-b border-fill-3 flex-shrink-0'>
            {(
              [
                { key: 'store', label: '技能库' },
                { key: 'installed', label: '我的技能', count: installed.length },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type='button'
                className={`relative h-9 px-0 text-sm bg-transparent border-none inline-flex items-center gap-1.5 transition-all cursor-pointer ${
                  tab === t.key ? 'text-primary font-medium' : 'text-secondary hover:text-foreground'
                }`}
                onClick={() => setTab(t.key)}
              >
                <span className='f-center'>{t.label}</span>
                {t.key === 'installed' ? (
                  <span className='f-center min-w-4 h-4 ml-5px px-1 rd-full bg-primary text-white text-10px leading-4 font-medium'>
                    {t.count}
                  </span>
                ) : null}
                {tab === t.key ? (
                  <span className='absolute bottom-0 left-0 right-0 h-0.5 rd-t-full bg-primary' />
                ) : null}
              </button>
            ))}
          </div>
          <Input
            placeholder='搜索...'
            prefix={<Search size={14} className='text-tertiary' />}
            className='flex-1 min-w-0'
            value={search}
            onChange={setSearch}
          />
        </div>

        {/* 内容滚动区（installed 列表） */}
        <div className='flex-1 min-h-0 overflow-y-auto'>
          {isLoading ? (
            <div className='flex justify-center items-center py-12'>
              <Spin size={28} />
            </div>
          ) : filtered.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-12 gap-2'>
              <Zap size={32} className='text-tertiary' />
              <div className='text-13px text-secondary'>暂无已安装的技能</div>
              <div className='text-12px text-tertiary'>前往技能库安装你需要的技能</div>
            </div>
          ) : (
            <div className='pb-4 space-y-5'>
              <section>
                <div className='flex items-center justify-between gap-2 mb-2.5'>
                  <div className='text-13px font-medium text-foreground'>技能</div>
                  <span className='px-1.5 py-0 bg-fill-2 text-secondary text-11px rd-full leading-18px'>
                    {filtered.length}
                  </span>
                </div>
                <div className='grid gap-4' style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                  {filtered.map((skill) => (
                    <SkillCardAligned
                      key={skill.name}
                      skill={skill}
                      canManage={canManage}
                      onDetail={() => setDetail(skill)}
                      onToggle={(enabled) => void handleToggle(skill, enabled)}
                      onUninstall={() => void handleUninstall(skill.name)}
                    />
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
      <SkillDetailModal skill={detail} onClose={() => setDetail(null)} />
    </div>
  )
}

/** 技能卡片（结构对齐 InstalledSkillCard）。 */
function SkillCardAligned({
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
  const displayName = String(skill.display_name ?? skill.displayName ?? skill.name)
  return (
    <div
      className='card group flex items-start gap-3 relative overflow-hidden'
      data-testid='skill-card'
      onClick={onDetail}
    >
      <div className='w-12 flex-shrink-0'>
        <div className='size-12 rd-8px overflow-hidden f-center'>
          <Zap size={22} className='text-primary' />
        </div>
      </div>
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-2 pr-14.5 min-w-0'>
          <span className='min-w-0 font-medium text-13px text-foreground truncate'>{displayName}</span>
        </div>
        <div className='mt-1 min-h-7.5'>
          <div className='text-11px text-secondary line-clamp-2 leading-15px'>
            {String(skill.description ?? skill.name)}
          </div>
        </div>
      </div>
      <div className='absolute top-1.5 right-2.5 flex items-center gap-3' onClick={(e) => e.stopPropagation()}>
        {canManage ? (
          <>
            <Switch
              size='small'
              checked={enabled}
              onChange={(v) => onToggle(v)}
              className={enabled ? '!bg-primary !border-[var(--ui-accent-orange)]' : ''}
            />
            <Popconfirm title='确定卸载该技能吗？' onOk={onUninstall}>
              <Button shape='circle' status='danger' className='!size-7' icon={<Trash2 size={13} />} aria-label='卸载' />
            </Popconfirm>
          </>
        ) : null}
      </div>
    </div>
  )
}
