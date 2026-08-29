import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'
import { App } from '@client/App'

vi.mock('@client/features/auth/useAuth', () => ({
  useSession: vi.fn().mockReturnValue({
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
  }),
}))

describe('App root', () => {
  test('renders the application shell with router', () => {
    render(
      <MemoryRouter initialEntries={['/guid']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('new-conversation-page')).toBeTruthy()
    expect(screen.getByTestId('new-conversation')).toBeTruthy()
  })
})
