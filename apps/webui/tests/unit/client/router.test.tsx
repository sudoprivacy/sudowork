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
    await waitFor(() => expect(screen.getByTestId('new-conversation-page')).toBeTruthy())
  })

  test('each settings route renders its real page', async () => {
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
    for (const [path, testid] of [
      ['/settings/profile', 'profile-page'],
      ['/settings/mcp', 'mcp-settings-page'],
      ['/settings/display', 'display-page'],
      ['/settings/about', 'about-page'],
    ] as const) {
      const { unmount } = renderAt(path)
      await waitFor(() => expect(screen.getByTestId(testid)).toBeTruthy(), { timeout: 5000 })
      unmount()
    }
  })
})
