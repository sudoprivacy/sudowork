import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@client/features/skills/skillApi', () => ({
  skillApi: {
    listInstalled: vi.fn().mockResolvedValue([
      { name: 'pdf', description: 'PDF 处理', enabled: true },
      { name: 'search', description: '搜索', enabled: false },
    ]),
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
  test('renders installed skills; admin sees enable switch and uninstall', async () => {
    render(
      <MemoryRouter>
        <SkillsPage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getAllByTestId('skill-card')).toHaveLength(2), { timeout: 5000 })
    expect(screen.getByText('pdf')).toBeTruthy()
    expect(screen.getByText('search')).toBeTruthy()

    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(2)
    expect((switches[0] as HTMLInputElement).className).toBeDefined()

    fireEvent.click(screen.getAllByText('卸载')[0]!)
    await waitFor(() => expect(skillApi.uninstall).toHaveBeenCalledWith('pdf'), { timeout: 5000 })
  })
})
