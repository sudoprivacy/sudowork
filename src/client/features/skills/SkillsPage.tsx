/**
 * 技能商店页（布局对齐 Sudowork skills 页，Apache-2.0, Copyright 2026 SudoPrivacy）。
 * Tabs（技能库/专属技能/我的技能）+ 搜索 + 分类 chips + 2 列卡片网格。
 */
import React, { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { Button, Input, Message, Popconfirm, Spin, Switch } from '@arco-design/web-react'
import { Search, Shield, Trash2, Zap } from 'lucide-react'
import { useSkills } from './useSkills'
import { skillApi, type SkillItem } from './skillApi'
import { HubSkillCard } from './HubSkillCard'
import { handleHubSkillIconError, resolveHubSkillIcon } from './hubIcon'
import { SkillDetailModal } from './SkillDetailModal'

type TabKey = 'store' | 'exclusive' | 'installed'

export function SkillsPage(): React.ReactElement {
  const { installed, isLoading, canManage, refresh } = useSkills()
  const [tab, setTab] = useState<TabKey>('store')
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<SkillItem | null>(null)
  const [hubItems, setHubItems] = useState<SkillItem[]>([])
  const [hubLoading, setHubLoading] = useState(false)
  const [tenantItems, setTenantItems] = useState<SkillItem[]>([])
  const [tenantLoading, setTenantLoading] = useState(false)
  const [category, setCategory] = useState('all')

  const { data: categories } = useSWR('skills/hub/categories', skillApi.hubCategories)
  const categoryList = Array.isArray(categories) ? (categories as string[]) : []

  async function loadHub(): Promise<void> {
    setHubLoading(true)
    try {
      const res = await skillApi.hubList({ limit: '50' })
      setHubItems(res.items ?? [])
    } catch {
      Message.error('Hub 列表加载失败')
    } finally {
      setHubLoading(false)
    }
  }

  async function loadTenant(): Promise<void> {
    setTenantLoading(true)
    try {
      const rows = await skillApi.tenantList()
      setTenantItems(rows as SkillItem[])
    } catch {
      Message.error('专属技能加载失败')
    } finally {
      setTenantLoading(false)
    }
  }

  // 默认 tab 即"技能库"：挂载时触发首次加载（switchTab 不经过初始渲染）
  useEffect(() => {
    void loadHub()
  }, [])

  function switchTab(next: TabKey): void {
    setTab(next)
    if (next === 'store' && hubItems.length === 0 && !hubLoading) void loadHub()
    if (next === 'exclusive' && tenantItems.length === 0 && !tenantLoading) void loadTenant()
  }

  async function handleInstall(name: string): Promise<void> {
    try {
      await skillApi.install(name)
      Message.success(`已安装 ${name}`)
      void loadHub()
      refresh()
    } catch (err) {
      Message.error(`安装失败：${(err as Error).message}`)
    }
  }

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

  const filtered = useMemo(
    () =>
      installed.filter(
        (s) =>
          !search ||
          String(s.display_name ?? s.displayName ?? s.name).toLowerCase().includes(search.toLowerCase()),
      ),
    [installed, search],
  )

  const filteredHub = useMemo(
    () =>
      hubItems.filter(
        (s) =>
          (category === 'all' || category === s.category) &&
          (!search || String(s.display_name ?? s.name).toLowerCase().includes(search.toLowerCase())),
      ),
    [hubItems, category, search],
  )

  const filteredTenant = useMemo(
    () =>
      tenantItems.filter(
        (s) => !search || String(s.display_name ?? s.name).toLowerCase().includes(search.toLowerCase()),
      ),
    [tenantItems, search],
  )

  return (
    <div className='page-wrapper w-full min-h-full box-border overflow-y-auto px-10 pb-4' data-testid='skills-page'>
      <div className='page-content mx-auto w-full max-w-240 flex flex-col h-full'>
        {/* 顶部：Tabs + 搜索 */}
        <div className='flex items-center gap-6 mb-3'>
          <div className='flex flex-wrap items-end gap-5 border-b border-fill-3 flex-shrink-0'>
            {(
              [
                { key: 'store', label: '技能库' },
                { key: 'exclusive', label: '专属技能' },
                { key: 'installed', label: '我的技能', count: installed.length },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type='button'
                className={`relative h-9 px-0 text-sm bg-transparent border-none inline-flex items-center gap-1.5 transition-all cursor-pointer ${
                  tab === t.key ? 'text-primary font-medium' : 'text-secondary hover:text-foreground'
                }`}
                onClick={() => switchTab(t.key)}
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

        {/* 分类 chips（store / exclusive tab，首项"精选"对齐 sudowork） */}
        {tab !== 'installed' && categoryList.length > 0 ? (
          <div className='flex gap-1.5 mb-3.5 overflow-x-auto pb-0.5 flex-shrink-0 scrollbar-hide'>
            {['all', ...categoryList].map((c) => (
              <span
                key={c}
                className={`category-chip ${category === c ? 'category-chip-active' : 'category-chip-idle'}`}
                onClick={() => setCategory(c)}
              >
                {c === 'all' ? '精选' : c}
              </span>
            ))}
          </div>
        ) : null}

        {/* 内容滚动区 */}
        <div className='flex-1 min-h-0 overflow-y-auto'>
          {tab === 'store' ? (
            <>
              {hubLoading ? (
                <div className='flex justify-center items-center py-12'>
                  <Spin size={28} />
                </div>
              ) : filteredHub.length === 0 ? (
                <div className='flex flex-col items-center justify-center py-12 text-secondary gap-2'>
                  <Zap size={32} className='text-tertiary' />
                  <span className='text-13px'>暂无技能</span>
                </div>
              ) : (
                <div className='grid gap-4 pb-4' style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                  {filteredHub.map((s) => (
                    <HubSkillCard
                      key={String(s.id ?? s.name)}
                      skill={s}
                      canManage={canManage}
                      onDetail={() => setDetail(s)}
                      onInstall={() => void handleInstall(String(s.name))}
                    />
                  ))}
                </div>
              )}
            </>
          ) : tab === 'exclusive' ? (
            <>
              {tenantLoading ? (
                <div className='flex justify-center items-center py-12'>
                  <Spin size={28} />
                </div>
              ) : filteredTenant.length === 0 ? (
                <div className='flex flex-col items-center justify-center py-12 text-secondary gap-2'>
                  <Shield size={32} className='text-tertiary' />
                  <span className='text-13px'>暂无专属技能</span>
                </div>
              ) : (
                <div className='grid gap-4 pb-4' style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                  {filteredTenant.map((s) => (
                    <SkillCardAligned
                      key={String(s.id ?? s.name)}
                      skill={s}
                      canManage={false}
                      onDetail={() => setDetail(s)}
                      onToggle={() => undefined}
                      onUninstall={() => undefined}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
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
              )}
            </>
          )}
        </div>
      </div>
      <SkillDetailModal skill={detail} onClose={() => setDetail(null)} />
    </div>
  )
}

/** 技能卡片（结构对齐 InstalledSkillCard）。图标链：icon（COS 解析）→ emoji → Zap 兜底。 */
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
          ) : skill.emoji ? (
            <div className='w-full h-full f-center text-22px'>{skill.emoji}</div>
          ) : (
            <Zap size={22} className='text-primary' />
          )}
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
