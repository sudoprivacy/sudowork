import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@client/features/skills/skillApi', () => ({
  skillApi: {
    listInstalled: vi.fn().mockResolvedValue([
      {
        name: 'pdf',
        displayName: 'PDF 处理',
        enabled: true,
        isHubInstalled: true,
        categories: ['精选'],
      },
      {
        name: 'search',
        displayName: '搜索',
        enabled: false,
        isHubInstalled: true,
        categories: ['创作'],
      },
      {
        name: 'local',
        displayName: '本地技能',
        enabled: true,
        isHubInstalled: false,
      },
    ]),
    setEnabled: vi.fn().mockResolvedValue({ ok: true }),
    uninstall: vi.fn().mockResolvedValue({ ok: true }),
  },
}))
vi.mock('@client/features/agents/agentApi', () => ({
  agentApi: {
    getScopes: vi.fn().mockResolvedValue({ scopes: ['admin:settings'] }),
  },
}))

import { SkillsPage } from '@client/features/skills/SkillsPage'
import { skillApi } from '@client/features/skills/skillApi'

function renderIsolated(ui: React.ReactNode): ReturnType<typeof render> {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <MemoryRouter>{ui}</MemoryRouter>
    </SWRConfig>,
  )
}

describe('SkillsPage（列表逻辑对齐 sudowork B 端）', () => {
  test('renders three store tabs with 技能库 default', () => {
    renderIsolated(<SkillsPage />)
    expect(screen.getByRole('button', { name: /技能库/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /专属技能/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /我的技能/ })).toBeTruthy()
  })

  test('技能库 tab 只渲染 moss installed 的 hub 类技能', async () => {
    renderIsolated(<SkillsPage />)
    await waitFor(() => expect(screen.getAllByTestId('skill-card')).toHaveLength(2), { timeout: 5000 })
    expect(screen.getByText('PDF 处理')).toBeTruthy()
    expect(screen.getByText('搜索')).toBeTruthy()
    expect(screen.queryByText('本地技能')).toBeNull()
  })

  test('分类 chips 来自列表数据，逐个点击均有结果（无空分类回归）', async () => {
    renderIsolated(<SkillsPage />)
    await waitFor(() => expect(screen.getAllByTestId('skill-card')).toHaveLength(2), { timeout: 5000 })
    // 首项为"全部分类"；分类为列表项 categories 并集
    expect(screen.getByText('全部分类')).toBeTruthy()
    expect(screen.getByText('精选')).toBeTruthy()
    expect(screen.getByText('创作')).toBeTruthy()
    // 不应出现第二个"精选"chip
    expect(screen.getAllByText('精选')).toHaveLength(1)

    fireEvent.click(screen.getByText('精选'))
    await waitFor(() => expect(screen.getAllByTestId('skill-card')).toHaveLength(1), { timeout: 5000 })
    expect(screen.getByText('PDF 处理')).toBeTruthy()

    fireEvent.click(screen.getByText('创作'))
    await waitFor(() => expect(screen.getAllByTestId('skill-card')).toHaveLength(1), { timeout: 5000 })
    expect(screen.getByText('搜索')).toBeTruthy()
  })

  test('renders installed skills; admin sees enable switch and uninstall', async () => {
    renderIsolated(<SkillsPage />)
    // 默认 tab 为"技能库"，切到"我的技能"后断言 installed 列表（不做 isHubInstalled 过滤）
    fireEvent.click(screen.getByRole('button', { name: /我的技能/ }))
    await waitFor(() => expect(screen.getAllByTestId('skill-card')).toHaveLength(3), { timeout: 5000 })
    expect(screen.getByText('PDF 处理')).toBeTruthy()
    expect(screen.getByText('搜索')).toBeTruthy()
    expect(screen.getByText('本地技能')).toBeTruthy()

    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(3)
    expect((switches[0] as HTMLInputElement).className).toBeDefined()

    fireEvent.click(screen.getAllByLabelText('卸载')[0]!)
    // 卸载按钮在 Popconfirm 内：先弹确认，再点确定
    const confirmBtn = (await screen.findAllByText('确定'))[0]!
    fireEvent.click(confirmBtn)
    await waitFor(() => expect(skillApi.uninstall).toHaveBeenCalledWith('pdf'), { timeout: 5000 })
  })
})
