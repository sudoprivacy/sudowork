import React, { useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { Button, Input, Message, Switch, Table, Tag } from '@arco-design/web-react'
import { mcpApi, type McpServer } from '@client/features/settings/settingsApi'

/**
 * MCP 服务（计划 Task 8）：
 * - own personal（scope==='user'）可测试/删除；组织级仅用户级启停
 * - mutation 后立即 refetch；列表 30s polling；不使用 SSE
 */
export function McpSettingsPage(): React.ReactElement {
  const { mutate } = useSWRConfig()
  const { data: servers } = useSWR('mcp/servers', mcpApi.servers, { refreshInterval: 30_000 })
  const { data: policy } = useSWR('mcp/policy', mcpApi.policy)
  const [jsonConfig, setJsonConfig] = useState('')
  const [installing, setInstalling] = useState(false)

  const rows = servers ?? []

  async function refresh(): Promise<void> {
    await mutate('mcp/servers')
  }

  async function handleToggle(row: McpServer, userDisabled: boolean): Promise<void> {
    try {
      if (userDisabled) {
        await mcpApi.enable(row.id)
      } else {
        await mcpApi.disable(row.id)
      }
      await refresh()
    } catch {
      Message.error('操作失败')
    }
  }

  async function handleTest(row: McpServer): Promise<void> {
    try {
      await mcpApi.test(row.id)
      Message.success(`${row.display_name ?? row.name} 连接正常`)
    } catch (err) {
      Message.error(`测试失败：${(err as Error).message}`)
    }
  }

  async function handleDelete(row: McpServer): Promise<void> {
    try {
      await mcpApi.remove(row.id)
      Message.success(`已删除 ${row.display_name ?? row.name}`)
      await refresh()
    } catch {
      Message.error('删除失败')
    }
  }

  async function handleInstallJson(): Promise<void> {
    if (!jsonConfig.trim()) {
      Message.warning('请粘贴 JSON 配置')
      return
    }
    setInstalling(true)
    try {
      await mcpApi.installJson(jsonConfig.trim())
      Message.success('已安装')
      setJsonConfig('')
      await refresh()
    } catch (err) {
      Message.error(`安装失败：${(err as Error).message}`)
    } finally {
      setInstalling(false)
    }
  }

  const allowPersonal = Boolean((policy as { allow_personal_mcp?: boolean } | undefined)?.allow_personal_mcp)

  return (
    <div className='size-full overflow-y-auto p-5' data-testid='mcp-settings-page'>
      <div className='max-w-4xl mx-auto flex flex-col gap-4'>
        <h1 className='text-20px font-700 m-0'>MCP 服务</h1>

        <Table
          rowKey='id'
          data={rows}
          pagination={false}
          columns={[
            {
              title: '名称',
              render: (_v, row: McpServer) => row.display_name ?? row.name,
            },
            {
              title: '类型',
              width: 110,
              render: (_v, row: McpServer) => (
                <Tag size='small' color={row.scope === 'user' ? 'orangered' : 'arcoblue'}>
                  {row.scope === 'user' ? '个人' : '组织'}
                </Tag>
              ),
            },
            { title: '协议', dataIndex: 'mcp_type', width: 90, render: (v: string) => v ?? '—' },
            {
              title: '启用',
              width: 80,
              render: (_v, row: McpServer) => (
                <Switch
                  size='small'
                  checked={!(row.user_disabled ?? false)}
                  onChange={(v) => void handleToggle(row, !v)}
                />
              ),
            },
            {
              title: '操作',
              width: 150,
              render: (_v, row: McpServer) => (
                <div className='flex gap-1'>
                  {row.scope === 'user' ? (
                    <>
                      <Button size='mini' onClick={() => void handleTest(row)}>测试</Button>
                      <Button size='mini' status='danger' type='outline' onClick={() => void handleDelete(row)}>
                        删除
                      </Button>
                    </>
                  ) : (
                    <span className='text-12px text-tertiary'>组织管理</span>
                  )}
                </div>
              ),
            },
          ]}
        />

        {allowPersonal ? (
          <section className='flex flex-col gap-2 border border-light rd-2 p-3'>
            <div className='text-14px font-600'>通过 JSON 安装个人 MCP</div>
            <Input.TextArea
              value={jsonConfig}
              onChange={setJsonConfig}
              rows={5}
              placeholder='粘贴 MCP JSON 配置'
            />
            <div>
              <Button size='small' type='primary' loading={installing} onClick={() => void handleInstallJson()}>
                安装
              </Button>
            </div>
          </section>
        ) : (
          <div className='text-12px text-tertiary'>当前策略未开放个人 MCP 创建。</div>
        )}
      </div>
    </div>
  )
}
