/**
 * 智能体页（布局对齐 Sudowork agents 页，Apache-2.0, Copyright 2026 SudoPrivacy）。
 * PageWrapper(px-10/max-w-240) + 线型 Tabs + 搜索 + 分类 chips + 2 列卡片网格。
 */
import React, { useMemo, useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { Button, Input, Message, Popconfirm, Spin } from '@arco-design/web-react'
import { Bot, Download, Search, SquarePen, Trash2 } from 'lucide-react'
import { useAgents } from './useAgents'
import { agentApi, type AgentItem } from './agentApi'
import { AssistantDetailModal } from './AssistantDetailModal'
import { AssistantFormDrawer } from './AssistantFormDrawer'

type TabKey = 'store' | 'installed'

export function AgentsPage(): React.ReactElement {
  const { installed, isLoading, canManage, refresh } = useAgents()
  const { mutate } = useSWRConfig()
  const [tab, setTab] = useState<TabKey>('installed')
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<AgentItem | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [hubItems, setHubItems] = useState<AgentItem[]>([])
  const [hubLoading, setHubLoading] = useState(false)
  const [category, setCategory] = useState('all')

  const { data: categories } = useSWR(canManage ? 'agents/hub/categories' : null, agentApi.hubCategories)
  const categoryList = Array.isArray(categories) ? (categories as string[]) : []

  async function loadHub(): Promise<void> {
    setHubLoading(true)
    try {
      const res = await agentApi.hubList({ limit: '50' })
      setHubItems(res.items ?? [])
    } catch {
      Message.error('Hub 列表加载失败')
    } finally {
      setHubLoading(false)
    }
  }

  function switchTab(next: TabKey): void {
    setTab(next)
    if (next === 'store' && hubItems.length === 0 && !hubLoading) void loadHub()
  }

  async function handleInstall(name: string): Promise<void> {
    try {
      await agentApi.install(name)
      Message.success(`已安装 ${name}`)
      void loadHub()
      refresh()
    } catch (err) {
      Message.error(`安装失败：${(err as Error).message}`)
    }
  }

  async function handleUninstall(name: string): Promise<void> {
    try {
      await agentApi.uninstall(name)
      Message.success(`已卸载 ${name}`)
      refresh()
    } catch (err) {
      Message.error(`卸载失败：${(err as Error).message}`)
    }
  }

  const filteredInstalled = useMemo(
    () =>
      installed.filter(
        (a) => !search || String(a.displayName ?? a.name).toLowerCase().includes(search.toLowerCase()),
      ),
    [installed, search],
  )

  const filteredHub = useMemo(
    () =>
      hubItems.filter(
        (a) =>
          (category === 'all' || category === a.category) &&
          (!search || String(a.display_name ?? a.name).toLowerCase().includes(search.toLowerCase())),
      ),
    [hubItems, category, search],
  )

  return (
    <div className='page-wrapper w-full min-h-full box-border overflow-y-auto px-10 pb-4' data-testid='agents-page'>
      <div className='page-content mx-auto w-full max-w-240 flex flex-col h-full'>
        {/* 顶部：Tabs + 搜索 + 创建 */}
        <div className='flex items-center gap-6 mb-3'>
          <div className='flex flex-wrap items-end gap-5 border-b border-fill-3 flex-shrink-0'>
            {(
              [
                { key: 'store', label: '智能体库' },
                { key: 'installed', label: '我的智能体', count: installed.length },
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
                {t.label}
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
            className={`flex-1 min-w-0 ${tab === 'installed' ? 'invisible' : ''}`}
            value={search}
            onChange={setSearch}
          />
          {tab === 'installed' && canManage ? (
            <Button
              icon={<SquarePen size={13} />}
              className='rd-full flex-shrink-0'
              onClick={() => setFormOpen(true)}
            >
              创建
            </Button>
          ) : null}
        </div>

        {/* 分类 chips（store tab） */}
        {tab === 'store' && categoryList.length > 0 ? (
          <div className='flex gap-1.5 mb-3.5 overflow-x-auto pb-0.5 flex-shrink-0 scrollbar-hide'>
            {['all', ...categoryList].map((c) => (
              <span
                key={c}
                className={`category-chip ${category === c ? 'category-chip-active' : 'category-chip-idle'}`}
                onClick={() => setCategory(c)}
              >
                {c === 'all' ? '全部分类' : c}
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
                  <Bot size={32} className='text-tertiary' />
                  <span className='text-13px'>暂无智能体</span>
                </div>
              ) : (
                <div className='grid gap-4 pb-4' style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                  {filteredHub.map((a) => (
                    <AgentCard
                      key={String(a.id ?? a.name)}
                      agent={a}
                      onDetail={() => setDetail(a)}
                      right={
                        canManage ? (
                          <Button
                            shape='circle'
                            className='!size-7'
                            icon={<Download size={13} />}
                            onClick={() => void handleInstall(String(a.name))}
                          />
                        ) : null
                      }
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
              ) : filteredInstalled.length === 0 ? (
                <div className='flex flex-col items-center justify-center py-12 gap-2'>
                  <Bot size={32} className='text-tertiary' />
                  <div className='text-13px text-secondary'>暂无智能体</div>
                  {canManage ? (
                    <Button size='small' type='outline' className='mt-1' onClick={() => setFormOpen(true)}>
                      创建智能体
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className='pb-4 space-y-5'>
                  <section>
                    <div className='flex items-center justify-between gap-2 mb-2.5'>
                      <div className='text-13px font-medium text-foreground'>智能体</div>
                      <span className='px-1.5 py-0 bg-control text-secondary text-11px rd-full leading-18px'>
                        {filteredInstalled.length}
                      </span>
                    </div>
                    <div className='grid gap-4' style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                      {filteredInstalled.map((a) => (
                        <AgentCard
                          key={a.name}
                          agent={a}
                          onDetail={() => setDetail(a)}
                          right={
                            canManage ? (
                              <Popconfirm title='确定卸载该智能体吗？' onOk={() => void handleUninstall(a.name)}>
                                <Button
                                  shape='circle'
                                  status='danger'
                                  className='!size-7'
                                  icon={<Trash2 size={13} />}
                                  aria-label='卸载'
                                />
                              </Popconfirm>
                            ) : null
                          }
                        />
                      ))}
                    </div>
                  </section>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <AssistantDetailModal agent={detail} onClose={() => setDetail(null)} />
      <AssistantFormDrawer
        visible={formOpen}
        onClose={() => setFormOpen(false)}
        onCreated={() => {
          setFormOpen(false)
          void mutate('agents/installed')
        }}
      />
    </div>
  )
}

/** 卡片（结构对齐 InstalledAssistantCard/HubAssistantCard）。 */
function AgentCard({
  agent,
  onDetail,
  right,
}: {
  agent: AgentItem
  onDetail: () => void
  right?: React.ReactNode
}): React.ReactElement {
  const displayName = String(agent.displayName ?? agent.display_name ?? agent.name ?? '')
  const version = (agent as { latestVersion?: string }).latestVersion
  return (
    <div className='card group flex items-start gap-3 relative overflow-hidden' data-testid='assistant-card' onClick={onDetail}>
      <div className='w-48px flex-shrink-0'>
        <div className='size-12 rd-8px overflow-hidden bg-control f-center'>
          <Bot size={22} className='text-primary' />
        </div>
      </div>
      <div className='flex-1 min-w-0'>
        <div className='h-5 flex items-center gap-1.5 pr-32 min-w-0'>
          <span className='font-medium text-13px text-foreground truncate'>{displayName}</span>
          {version ? (
            <span className='px-5px py-0 bg-control text-secondary text-10px rd-3px whitespace-nowrap flex-shrink-0 leading-18px'>
              v{version}
            </span>
          ) : null}
        </div>
        <div className='my-1'>
          <div className='text-11px text-secondary line-clamp-2 leading-15px'>
            {String(agent.description ?? '暂无描述')}
          </div>
        </div>
      </div>
      {right ? (
        <div
          className='absolute top-2.5 right-2.5 flex items-center gap-1.5'
          onClick={(e) => e.stopPropagation()}
        >
          {right}
        </div>
      ) : null}
    </div>
  )
}
