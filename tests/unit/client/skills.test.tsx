import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@client/features/skills/skillApi', () => ({
  skillApi: {
    listInstalled: vi.fn().mockResolvedValue([
      { name: 'pdf', description: 'PDF 处理', enabled: true },
      { name: 'search', description: '搜索', enabled: false },
    ]),
    hubCategories: vi.fn().mockResolvedValue([]),
    hubList: vi.fn().mockResolvedValue({ items: [] }),
    install: vi.fn(),
    setEnabled: vi.fn().mockResolvedValue({ ok: true }),
    uninstall: vi.fn().mockResolvedValue({ ok: true }),
    tenantList: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('@client/features/agents/agentApi', () => ({
  agentApi: {
    getScopes: vi.fn().mockResolvedValue({ scopes: ['admin:settings'] }),
  },
}))

import { SkillsPage } from '@client/features/skills/SkillsPage'
import { skillApi } from '@client/features/skills/skillApi'

describe('SkillsPage（计划 Task 6）', () => {
  test('renders three store tabs with 技能库 default', () => {
    render(
      <MemoryRouter>
        <SkillsPage />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: /技能库/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /专属技能/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /我的技能/ })).toBeTruthy()
  })

  test('renders installed skills; admin sees enable switch and uninstall', async () => {
    render(
      <MemoryRouter>
        <SkillsPage />
      </MemoryRouter>,
    )
    // 默认 tab 为"技能库"，切到"我的技能"后断言 installed 列表
    fireEvent.click(screen.getByRole('button', { name: /我的技能/ }))
    await waitFor(() => expect(screen.getAllByTestId('skill-card')).toHaveLength(2), { timeout: 5000 })
    expect(screen.getByText('pdf')).toBeTruthy()
    expect(screen.getByText('search')).toBeTruthy()

    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(2)
    expect((switches[0] as HTMLInputElement).className).toBeDefined()

    fireEvent.click(screen.getAllByLabelText('卸载')[0]!)
    // 卸载按钮在 Popconfirm 内：先弹确认，再点确定
    const confirmBtn = (await screen.findAllByText('确定'))[0]!
    fireEvent.click(confirmBtn)
    await waitFor(() => expect(skillApi.uninstall).toHaveBeenCalledWith('pdf'), { timeout: 5000 })
  })
})
