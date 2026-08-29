import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { LoginPage } from '@client/features/auth/LoginPage'

vi.mock('@client/features/auth/authApi', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
    ) {
      super(code)
      this.name = 'ApiError'
    }
  },
  fetchSession: vi.fn(),
  logout: vi.fn(),
  loginPassword: vi.fn(),
  loginApiKey: vi.fn(),
}))

import { ApiError, loginApiKey, loginPassword } from '@client/features/auth/authApi'

const loginPasswordMock = vi.mocked(loginPassword)
const loginApiKeyMock = vi.mocked(loginApiKey)

describe('LoginPage', () => {
  beforeEach(() => {
    loginPasswordMock.mockReset()
    loginApiKeyMock.mockReset()
  })

  test('renders password fields by default; apiKey field after switching', () => {
    render(<LoginPage />)
    expect(screen.getByLabelText('用户名')).toBeTruthy()
    expect(screen.getByLabelText('密码')).toBeTruthy()
    expect(screen.queryByLabelText('API Key')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'API Key' }))
    expect(screen.getByLabelText('API Key')).toBeTruthy()
    expect(screen.queryByLabelText('用户名')).toBeNull()
  })

  test('submits password login and reports success', async () => {
    loginPasswordMock.mockResolvedValue({ ok: true })
    const onSuccess = vi.fn()
    render(<LoginPage onSuccess={onSuccess} />)

    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'test_1' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ ok: true }))
    expect(loginPasswordMock).toHaveBeenCalledWith({ username: 'test_1', password: 'secret' })
  })

  test('submits api key login in apiKey mode', async () => {
    loginApiKeyMock.mockResolvedValue({ ok: true })
    const onSuccess = vi.fn()
    render(<LoginPage onSuccess={onSuccess} />)

    fireEvent.click(screen.getByRole('tab', { name: 'API Key' }))
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'moss_sk_x' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ ok: true }))
    expect(loginApiKeyMock).toHaveBeenCalledWith('moss_sk_x')
  })

  test('shows a friendly message for INVALID_CREDENTIALS', async () => {
    loginPasswordMock.mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS'))
    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'u' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'p' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByRole('alert').textContent).toBe('用户名或密码错误')
  })

  test('shows a friendly message for MOSS_UNAVAILABLE', async () => {
    loginApiKeyMock.mockRejectedValue(new ApiError(503, 'MOSS_UNAVAILABLE'))
    render(<LoginPage />)

    fireEvent.click(screen.getByRole('tab', { name: 'API Key' }))
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'k' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByRole('alert').textContent).toBe('服务暂不可用，请稍后重试')
  })
})
