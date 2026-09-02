import { describe, expect, test, vi } from 'vitest'
import { createMossAuthPort } from '@sudowork/moss-client'
import { MossHttpError, MossNetworkError, mossRequest } from '@sudowork/moss-client'

const BASE = 'http://moss.test'

function okTokenSet() {
  return { access_token: 'at-1', refresh_token: 'rt-1', token_type: 'Bearer', expires_in: 3600 }
}

describe('MossAuthPort request shapes (contract vs baseline)', () => {
  test('password login posts grant_type=password to /api/v1/auth/login', async () => {
    const mock = vi.fn().mockResolvedValue(okTokenSet())
    const port = createMossAuthPort(mock, BASE)

    const tokens = await port.loginWithPassword({ username: 'u1', password: 'p1' })

    expect(tokens.access_token).toBe('at-1')
    expect(mock).toHaveBeenCalledWith(
      BASE,
      {
        method: 'POST',
        path: '/api/v1/auth/login',
        body: { grant_type: 'password', username: 'u1', password: 'p1' },
      },
    )
  })

  test('api key login posts grant_type=api_key', async () => {
    const mock = vi.fn().mockResolvedValue(okTokenSet())
    const port = createMossAuthPort(mock, BASE)

    await port.loginWithApiKey('sk-xyz')

    expect(mock).toHaveBeenCalledWith(
      BASE,
      {
        method: 'POST',
        path: '/api/v1/auth/login',
        body: { grant_type: 'api_key', api_key: 'sk-xyz' },
      },
    )
  })

  test('refresh posts grant_type=refresh_token to /api/v1/auth/token', async () => {
    const mock = vi.fn().mockResolvedValue(okTokenSet())
    const port = createMossAuthPort(mock, BASE)

    await port.refresh('rt-old')

    expect(mock).toHaveBeenCalledWith(
      BASE,
      {
        method: 'POST',
        path: '/api/v1/auth/token',
        body: { grant_type: 'refresh_token', refresh_token: 'rt-old' },
      },
    )
  })

  test('me sends GET /api/v1/auth/me with the session access token', async () => {
    const mock = vi.fn().mockResolvedValue({
      user: { id: 'u', name: 'n' },
      organization: { id: 'o', name: 'O' },
      scopes: ['s'],
      role: 'user',
    })
    const port = createMossAuthPort(mock, BASE)

    const me = await port.me('at-9')
    expect(me.user.id).toBe('u')

    expect(mock).toHaveBeenCalledWith(
      BASE,
      { method: 'GET', path: '/api/v1/auth/me', accessToken: 'at-9' },
    )
  })

  test('token set missing required fields is rejected', async () => {
    const mock = vi.fn().mockResolvedValue({ access_token: 'at' })
    const port = createMossAuthPort(mock, BASE)
    await expect(port.loginWithApiKey('sk')).rejects.toThrow()
  })
})

describe('mossRequest transport behavior', () => {
  test('sends Authorization bearer and JSON content-type for authorized JSON request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await mossRequest(BASE, { method: 'POST', path: '/api/v1/x', body: { a: 1 }, accessToken: 'tk' })

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(init.headers).toMatchObject({
      authorization: 'Bearer tk',
      'content-type': 'application/json',
    })
    expect(init.body).toBe('{"a":1}')
    vi.unstubAllGlobals()
  })

  test('non-2xx response throws MossHttpError with status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(new Response('{"error":"no"}', { status: 403 }))),
    )
    await expect(mossRequest(BASE, { method: 'GET', path: '/x' })).rejects.toThrow(MossHttpError)
    await expect(mossRequest(BASE, { method: 'GET', path: '/x' })).rejects.toThrow('403')
    vi.unstubAllGlobals()
  })

  test('network failure throws MossNetworkError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(mossRequest(BASE, { method: 'GET', path: '/x' })).rejects.toThrow(
      MossNetworkError,
    )
    vi.unstubAllGlobals()
  })

  test('searchParams are appended', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await mossRequest(BASE, { method: 'GET', path: '/list', searchParams: { limit: '5' } })
    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.search).toBe('?limit=5')
    vi.unstubAllGlobals()
  })
})
