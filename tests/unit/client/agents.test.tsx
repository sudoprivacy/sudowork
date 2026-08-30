import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@client/features/agents/agentApi', () => ({
  agentApi: {
    listInstalled: vi.fn().mockResolvedValue([
      { name: 'helper', displayName: '助手', description: '日常帮助' },
      { name: 'writer', description: '写作' },
    ]),
    getScopes: vi.fn().mockResolvedValue({ scopes: ['store:read'] }),
    hubCategories: vi.fn().mockResolvedValue([]),
    hubList: vi.fn().mockResolvedValue({ items: [] }),
    install: vi.fn(),
    create: vi.fn(),
    uploadCustom: vi.fn(),
    updateMeta: vi.fn(),
    uninstall: vi.fn().mockResolvedValue({ ok: true }),
    sync: vi.fn(),
    tenantList: vi.fn().mockResolvedValue([]),
    tenantPublish: vi.fn(),
  },
}))

import { AgentsPage } from '@client/features/agents/AgentsPage'
import { agentApi } from '@client/features/agents/agentApi'

function renderIsolated(ui: React.ReactNode): ReturnType<typeof render> {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <MemoryRouter>{ui}</MemoryRouter>
    </SWRConfig>,
  )
}

describe('AgentsPage（计划 Task 6）', () => {
  test('renders three store tabs with 智能体库 default', () => {
    renderIsolated(<AgentsPage />)
    expect(screen.getByRole('button', { name: /智能体库/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /专属智能体/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /我的智能体/ })).toBeTruthy()
  })

  test('renders installed agents and hides admin actions for plain users', async () => {
    renderIsolated(<AgentsPage />)
    // 默认 tab 为"智能体库"，切到"我的智能体"后断言 installed 列表
    fireEvent.click(screen.getByRole('button', { name: /我的智能体/ }))
    await waitFor(() => expect(screen.getAllByTestId('assistant-card')).toHaveLength(2), { timeout: 5000 })
    expect(screen.getByText('助手')).toBeTruthy()
    // 普通用户（无 admin:settings）看不到创建/卸载
    expect(screen.queryByText('创建智能体')).toBeNull()
    expect(screen.queryByLabelText('卸载')).toBeNull()
  })

  test('uninstall button visible for admins', async () => {
    vi.mocked(agentApi.getScopes).mockResolvedValue({ scopes: ['admin:settings'] })
    renderIsolated(<AgentsPage />)
    fireEvent.click(screen.getByRole('button', { name: /我的智能体/ }))
    await waitFor(
      () => expect(screen.getAllByLabelText('卸载').length).toBeGreaterThanOrEqual(1),
      { timeout: 5000 },
    )
    vi.mocked(agentApi.getScopes).mockResolvedValue({ scopes: ['store:read'] })
  })
})
