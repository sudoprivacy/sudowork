import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@client/features/agents/agentApi', () => ({
  agentApi: {
    listInstalled: vi.fn().mockResolvedValue([
      {
        name: 'helper',
        displayName: '助手',
        description: '日常帮助',
        tag: 'hub',
        isBuiltin: false,
        categories: ['效率'],
      },
      { name: 'sys-agent', displayName: '内置', tag: 'system', isBuiltin: true },
      { name: 'tenant-a', displayName: '专属A', tag: 'tenant', isBuiltin: false },
      { name: 'mine', displayName: '自建', tag: 'custom', isBuiltin: false },
    ]),
    getScopes: vi.fn().mockResolvedValue({ scopes: ['store:read'] }),
    create: vi.fn(),
    uninstall: vi.fn().mockResolvedValue({ ok: true }),
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

describe('AgentsPage（列表逻辑对齐 sudowork B 端）', () => {
  test('renders three store tabs with 智能体库 default', () => {
    renderIsolated(<AgentsPage />)
    expect(screen.getByRole('button', { name: /智能体库/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /专属智能体/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /我的智能体/ })).toBeTruthy()
  })

  test('智能体库 tab 只渲染 moss installed 的 hub 类智能体，分类点击有结果', async () => {
    renderIsolated(<AgentsPage />)
    await waitFor(() => expect(screen.getAllByTestId('assistant-card')).toHaveLength(1), {
      timeout: 5000,
    })
    expect(screen.getByText('助手')).toBeTruthy()
    expect(screen.queryByText('内置')).toBeNull()
    expect(screen.queryByText('专属A')).toBeNull()

    // 分类从列表数据收集，首项"全部分类"
    expect(screen.getByText('全部分类')).toBeTruthy()
    fireEvent.click(screen.getByText('效率'))
    await waitFor(() => expect(screen.getAllByTestId('assistant-card')).toHaveLength(1), {
      timeout: 5000,
    })
    expect(screen.getByText('助手')).toBeTruthy()
  })

  test('专属智能体 tab 渲染 tenant 类智能体', async () => {
    renderIsolated(<AgentsPage />)
    await waitFor(() => expect(screen.getAllByTestId('assistant-card')).toHaveLength(1), {
      timeout: 5000,
    })
    fireEvent.click(screen.getByRole('button', { name: /专属智能体/ }))
    await waitFor(() => expect(screen.getAllByTestId('assistant-card')).toHaveLength(1), {
      timeout: 5000,
    })
    expect(screen.getByText('专属A')).toBeTruthy()
  })

  test('我的智能体过滤 moss 系统内置并按 自定义/专属/智能体库 分组', async () => {
    renderIsolated(<AgentsPage />)
    await waitFor(() => expect(screen.getAllByTestId('assistant-card')).toHaveLength(1), {
      timeout: 5000,
    })
    fireEvent.click(screen.getByRole('button', { name: /我的智能体/ }))
    await waitFor(() => expect(screen.getAllByTestId('assistant-card')).toHaveLength(3), {
      timeout: 5000,
    })
    // isBuiltin 的 moss 系统内置不显示，计数为 3
    expect(screen.queryByText('内置')).toBeNull()
    // 分组标题存在（"专属智能体"/"智能体库"与顶部 tab 同文案，各出现 2 次）
    expect(screen.getAllByText('自定义智能体')).toHaveLength(1)
    expect(screen.getAllByText('专属智能体')).toHaveLength(2)
    expect(screen.getAllByText('智能体库')).toHaveLength(2)
    expect(screen.getByText('自建')).toBeTruthy()
    expect(screen.getByText('专属A')).toBeTruthy()
    expect(screen.getByText('助手')).toBeTruthy()
  })

  test('hides admin actions for plain users', async () => {
    renderIsolated(<AgentsPage />)
    fireEvent.click(screen.getByRole('button', { name: /我的智能体/ }))
    await waitFor(() => expect(screen.getAllByTestId('assistant-card')).toHaveLength(3), {
      timeout: 5000,
    })
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
