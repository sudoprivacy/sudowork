import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { AppLayout } from '@client/layouts/AppLayout'

/** 测试专用路由出口（真实页面带数据依赖，不适合轻量导航断言） */
function TestOutlet({ title }: { title: string }) {
  return <div data-testid='test-outlet'>{title}</div>
}

vi.mock('@client/features/auth/useAuth', () => ({
  useSession: vi.fn(),
}))
vi.mock('@client/features/auth/authApi', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  logout: vi.fn().mockResolvedValue({ ok: true }),
}))

import { useSession } from '@client/features/auth/useAuth'
const useSessionMock = vi.mocked(useSession)

function renderShellAt(path: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path='/'
          element={<AppLayout />}
        >
          <Route path='guid' element={<TestOutlet title='新会话页' />} />
          <Route path='agents' element={<TestOutlet title='智能体页' />} />
          <Route path='skills' element={<TestOutlet title='技能库页' />} />
          <Route path='cron' element={<TestOutlet title='定时任务页' />} />
          <Route
            path='settings/profile'
            element={<TestOutlet title='用户中心页' />}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useSessionMock.mockReturnValue({
    session: {
      user: { id: 'u1', name: 'tester' },
      organization: { id: 'o1', name: 'Org One' },
      role: 'user',
      scopes: [],
    },
    isLoading: false,
    isValidating: false,
    unauthorized: false,
    unavailable: false,
    refresh: vi.fn(),
  })
})

describe('MainSider navigation (计划 Task 4)', () => {
  test('renders exactly Agent/Skill/Cron menu items plus new conversation', () => {
    renderShellAt('/guid')
    expect(screen.getByText('CTWork')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'CTWork' })).toBeTruthy()
    expect(screen.getByTestId('new-conversation')).toBeTruthy()
    const ids = Array.from(document.querySelectorAll('[data-menu-id]')).map(
      (el) => el.getAttribute('data-menu-id') as string,
    )
    expect(ids.sort()).toEqual(['agent', 'cron', 'skills'])
    expect(
      document.querySelector('[data-menu-id="agent"]')?.textContent ?? '',
    ).toContain('智能体')
    expect(
      document.querySelector('[data-menu-id="skills"]')?.textContent ?? '',
    ).toContain('技能商店')
    expect(
      document.querySelector('[data-menu-id="cron"]')?.textContent ?? '',
    ).toContain('定时任务')
    expect(screen.queryByText('本地知识库')).toBeNull()
    expect(screen.queryByText('安全中心')).toBeNull()
    expect(screen.queryByText('团队')).toBeNull()
  })

  test('menu click navigates to the feature route', async () => {
    renderShellAt('/guid')
    fireEvent.click(document.querySelector('[data-menu-id="agent"]')!)
    await waitFor(() => expect(screen.getByText('智能体页')).toBeTruthy())

    fireEvent.click(document.querySelector('[data-menu-id="skills"]')!)
    await waitFor(() => expect(screen.getByText('技能库页')).toBeTruthy())

    fireEvent.click(document.querySelector('[data-menu-id="cron"]')!)
    await waitFor(() => expect(screen.getByText('定时任务页')).toBeTruthy())
  })

  test('history tabs show 对话/定时任务 and no batch actions', () => {
    renderShellAt('/guid')
    expect(screen.getByText('对话')).toBeTruthy()
    // "定时任务" 同时出现在功能菜单与历史 Tab，至少 2 处
    expect(screen.getAllByText('定时任务').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByTestId('batch-mode-trigger')).toBeNull()
  })

  test('settings routes render exactly four items', () => {
    renderShellAt('/settings/profile')
    const ids = Array.from(document.querySelectorAll('[data-settings-id]')).map(
      (el) => el.getAttribute('data-settings-id') as string,
    )
    expect(ids.sort()).toEqual(['about', 'display', 'mcp', 'profile'])
    expect(screen.getByText('用户中心')).toBeTruthy()
    expect(screen.getByText('MCP 服务')).toBeTruthy()
    expect(screen.getByText('显示')).toBeTruthy()
    expect(screen.getByText('关于')).toBeTruthy()
    expect(screen.queryByText('充值中心')).toBeNull()
    expect(screen.queryByText('成员管理')).toBeNull()
    expect(screen.queryByText('模型设置')).toBeNull()
    expect(screen.queryByText('安全中心')).toBeNull()
  })

  test('user area shows current session user name and org', () => {
    renderShellAt('/guid')
    expect(screen.getByText('tester')).toBeTruthy()
    expect(screen.getByText('Org One')).toBeTruthy()
  })
})
