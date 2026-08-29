import React, { useState } from 'react'
import { Button, Message, Tabs } from '@arco-design/web-react'
import { useAgents } from './useAgents'
import { agentApi, type AgentItem } from './agentApi'
import { AssistantCard } from './AssistantCard'
import { AssistantDetailModal } from './AssistantDetailModal'
import { AssistantFormDrawer } from './AssistantFormDrawer'

/**
 * 智能体页面（计划 Task 6）：Installed / Hub 两个分区；
 * 管理操作仅对具备 admin:settings 的用户显示（服务端同样强制）。
 */
export function AgentsPage(): React.ReactElement {
  const { installed, isLoading, canManage, refresh } = useAgents()
  const [detail, setDetail] = useState<AgentItem | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [hubItems, setHubItems] = useState<AgentItem[]>([])
  const [hubLoading, setHubLoading] = useState(false)

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

  async function handleInstall(name: string): Promise<void> {
    try {
      await agentApi.install(name)
      Message.success(`已安装 ${name}`)
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

  return (
    <div className='size-full overflow-y-auto p-5' data-testid='agents-page'>
      <div className='max-w-5xl mx-auto flex flex-col gap-4'>
        <div className='flex items-center justify-between'>
          <h1 className='text-20px font-700 m-0'>智能体</h1>
          {canManage ? (
            <div className='flex gap-2'>
              <Button size='small' onClick={() => setFormOpen(true)}>
                创建智能体
              </Button>
              <Button
                size='small'
                onClick={() =>
                  void agentApi.sync().then(() => Message.success('已触发同步')).catch(() => Message.error('同步失败'))
                }
              >
                从 Hub 同步
              </Button>
            </div>
          ) : null}
        </div>

        <Tabs defaultActiveTab='installed'>
          <Tabs.TabPane key='installed' title={`已安装 (${installed.length})`}>
            <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-3'>
              {isLoading ? <div className='text-13px text-tertiary'>加载中…</div> : null}
              {!isLoading && installed.length === 0 ? (
                <div className='text-13px text-tertiary'>暂无已安装智能体</div>
              ) : null}
              {installed.map((agent) => (
                <AssistantCard
                  key={agent.name}
                  agent={agent}
                  canManage={canManage}
                  onDetail={() => setDetail(agent)}
                  onUninstall={() => void handleUninstall(agent.name)}
                />
              ))}
            </div>
          </Tabs.TabPane>
          <Tabs.TabPane
            key='hub'
            title='Hub'
            disabled={!canManage}
          >
            <div className='pt-3'>
              <Button size='small' loading={hubLoading} onClick={() => void loadHub()}>
                加载 Hub 列表
              </Button>
              <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-3'>
                {hubItems.map((item) => (
                  <AssistantCard
                    key={String(item.id ?? item.name)}
                    agent={item}
                    canManage={canManage}
                    onDetail={() => setDetail(item)}
                    onInstall={() => void handleInstall(String(item.name))}
                  />
                ))}
              </div>
            </div>
          </Tabs.TabPane>
        </Tabs>
      </div>

      <AssistantDetailModal agent={detail} onClose={() => setDetail(null)} />
      <AssistantFormDrawer
        visible={formOpen}
        onClose={() => setFormOpen(false)}
        onCreated={() => {
          setFormOpen(false)
          refresh()
        }}
      />
    </div>
  )
}
