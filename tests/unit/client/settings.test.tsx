import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@client/features/settings/settingsApi', () => ({
  settingsApi: {
    profile: vi.fn().mockResolvedValue({
      user: { id: 'u1', name: 'tester', role: 'user', departmentName: '研发部' },
      totalTokens: 999,
      sessionCount: 3,
    }),
    getDisplay: vi.fn().mockResolvedValue({ theme: 'system', fontScale: 1 }),
    putDisplay: vi.fn().mockResolvedValue({ ok: true }),
    about: vi.fn().mockResolvedValue({
      branding: { appName: 'Acme' },
      webui: { name: 'CTWork', version: '0.1.0' },
      mossBaseUrl: 'http://moss.test',
    }),
  },
}))

import { ProfilePage } from '@client/features/settings/ProfilePage'
import { DisplayPage } from '@client/features/settings/DisplayPage'
import { AboutPage } from '@client/features/settings/AboutPage'
import { settingsApi } from '@client/features/settings/settingsApi'

function isolated(ui: React.ReactNode): ReturnType<typeof render> {
  return render(<SWRConfig value={{ provider: () => new Map() }}>{ui}</SWRConfig>)
}

describe('settings pages（计划 Task 8：四项设置）', () => {
  test('ProfilePage shows identity/role/usage without password change', async () => {
    isolated(<ProfilePage />)
    await waitFor(() => expect(screen.getByText('用户名')).toBeTruthy(), { timeout: 5000 })
    expect(screen.getByText('tester')).toBeTruthy()
    expect(screen.getByText('999')).toBeTruthy()
    expect(screen.getByText(/密码修改由管理员在 Moss 侧管理/)).toBeTruthy()
    expect(screen.queryByText('修改密码')).toBeNull()
  })

  test('DisplayPage saves theme and font scale', async () => {
    isolated(<DisplayPage />)
    await waitFor(() => expect(screen.getByText('浅色')).toBeTruthy(), { timeout: 5000 })
    fireEvent.click(screen.getByText('深色'))
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(settingsApi.putDisplay).toHaveBeenCalled(), { timeout: 5000 })
    expect(settingsApi.putDisplay).toHaveBeenCalledWith({ theme: 'dark', fontScale: 1 })
  })

  test('AboutPage keeps tenant app name and shows CTWork webui name', async () => {
    isolated(<AboutPage />)
    await waitFor(() => expect(screen.getByText('0.1.0')).toBeTruthy(), { timeout: 5000 })
    expect(screen.getByText('Acme')).toBeTruthy()
    expect(screen.getByText('CTWork')).toBeTruthy()
    expect(screen.getByText('http://moss.test')).toBeTruthy()
    expect(screen.queryByText('检查更新')).toBeNull()
  })

  test('AboutPage falls back to CTWork for missing branding and webui names', async () => {
    vi.mocked(settingsApi.about).mockResolvedValueOnce({})
    isolated(<AboutPage />)
    await waitFor(() => expect(screen.getAllByText('CTWork')).toHaveLength(2), { timeout: 5000 })
  })
})
