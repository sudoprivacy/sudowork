import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'
import { AppRoutes, ROUTE_PATHS } from '@client/router'

vi.mock('@client/features/auth/useAuth', () => ({
  useSession: vi.fn(),
}))

import { useSession } from '@client/features/auth/useAuth'
const useSessionMock = vi.mocked(useSession)

function renderAt(path: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

describe('route table scope (计划 Task 4)', () => {
  test('registers exactly the 10 in-scope routes', () => {
    expect([...ROUTE_PATHS].sort()).toEqual(
      [
        '/login',
        '/guid',
        '/conversation/:id',
        '/agents',
        '/skills',
        '/cron',
        '/settings/profile',
        '/settings/mcp',
        '/settings/display',
        '/settings/about',
      ].sort(),
    )
  })

  test('contains no out-of-scope routes', () => {
    const joined = ROUTE_PATHS.join(' ')
    for (const banned of [
      'local-knowledge-base',
      'local-kb',
      'security',
      'channels',
      'recharge',
      'members',
      'model',
      'enterprise',
      'runtime',
      'system',
      'tools',
    ]) {
      expect(joined).not.toContain(banned)
    }
  })

  test('unauthenticated visit to / redirects to /login', async () => {
    useSessionMock.mockReturnValue({
      session: undefined,
      isLoading: false,
      isValidating: false,
      unauthorized: true,
      unavailable: false,
      refresh: vi.fn(),
    })
    renderAt('/')
    await waitFor(() => expect(screen.getByRole('heading', { name: /sudowork webui/i })).toBeTruthy())
  })

  test('authenticated visit to / redirects to /guid placeholder', async () => {
    useSessionMock.mockReturnValue({
      session: {
        user: { id: 'u1', name: 'tester' },
        organization: { id: 'o1', name: 'Org' },
        role: 'user',
        scopes: [],
      },
      isLoading: false,
      isValidating: false,
      unauthorized: false,
      unavailable: false,
      refresh: vi.fn(),
    })
    renderAt('/')
    await waitFor(() => expect(screen.getByTestId('placeholder-page')).toBeTruthy())
    expect(screen.getByTestId('placeholder-page')?.textContent).toContain('新会话')
  })

  test('each settings route renders its own placeholder', async () => {
    useSessionMock.mockReturnValue({
      session: {
        user: { id: 'u1', name: 'tester' },
        organization: { id: 'o1', name: 'Org' },
        role: 'user',
        scopes: [],
      },
      isLoading: false,
      isValidating: false,
      unauthorized: false,
      unavailable: false,
      refresh: vi.fn(),
    })
    for (const [path, title] of [
      ['/settings/profile', '用户中心'],
      ['/settings/mcp', 'MCP 服务'],
      ['/settings/display', '显示'],
      ['/settings/about', '关于'],
    ] as const) {
      const { unmount } = renderAt(path)
      await waitFor(() =>
        // 标题同时出现在 SettingsSider 菜单与占位页，至少 2 处
        expect(screen.getAllByText(title).length).toBeGreaterThanOrEqual(2),
      )
      unmount()
    }
  })
})
