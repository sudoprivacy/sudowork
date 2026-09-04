import type { SessionResponse } from '@sudowork/contracts/auth'

/**
 * WebUI 后端 API 客户端：同源 fetch + HttpOnly Cookie（计划 3.2）。
 * 浏览器永远接触不到 Moss token。
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
    this.name = 'ApiError'
  }
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }
  if (!res.ok) {
    const code =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'UNKNOWN'
    throw new ApiError(res.status, code)
  }
  return body as T
}

export function fetchSession(): Promise<SessionResponse> {
  return apiRequest<SessionResponse>('/api/auth/session')
}

export function loginPassword(input: { username: string; password: string }): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>('/api/auth/login/password', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function loginApiKey(apiKey: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>('/api/auth/login/api-key', {
    method: 'POST',
    body: JSON.stringify({ apiKey }),
  })
}

export function logout(): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>('/api/auth/logout', { method: 'POST' })
}
