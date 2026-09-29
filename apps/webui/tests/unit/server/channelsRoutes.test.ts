// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import type { AuthedRequest } from '@server/features/auth/sessionMiddleware'

vi.mock('@server/features/auth/authService', () => ({
  getMossContext: vi.fn(async () => ({ baseUrl: 'http://moss.test', accessToken: 'tok-1' })),
}))

const { createChannelsRouter } = await import('@server/features/channels/channelsRoutes')

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function setupApp(): express.Express {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    ;(req as AuthedRequest).webSession = {
      id: 1,
      principalId: 'p-1',
    } as unknown as AuthedRequest['webSession']
    next()
  })
  app.use('/api/channels', createChannelsRouter({ auth: {} as never }))
  return app
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
  vi.stubGlobal('fetch', fetchMock)
})

describe('channels 转发：前缀 /api/channels → moss /api/v1/channels', () => {
  test('GET 列表转发并透传响应', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ plugins: [{ id: 'lark_default' }] }))
    const res = await request(setupApp()).get('/api/channels/plugins')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ plugins: [{ id: 'lark_default' }] })
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'http://moss.test/api/v1/channels/plugins',
      expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer tok-1' } }),
    )
  })

  test.each([
    { method: 'post', path: '/api/channels/plugins/lark_default/test' },
    { method: 'put', path: '/api/channels/plugins/lark_default/agents/default' },
    { method: 'delete', path: '/api/channels/users/u-1' },
  ])('$method 带参数路径原样映射到 moss', async ({ method, path }) => {
    const app = setupApp()
    const req =
      method === 'post'
        ? request(app).post(path).send({ appId: 'a' })
        : method === 'put'
          ? request(app).put(path).send({ agentName: 'x' })
          : request(app).delete(path)
    await req
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `http://moss.test${path.replace('/api/channels', '/api/v1/channels')}`,
      expect.objectContaining({ method: method.toUpperCase() }),
    )
  })

  test('POST body 与 PUT body 透传，GET 不带 Content-Type', async () => {
    const app = setupApp()
    await request(app).post('/api/channels/plugins/create').send({ type: 'lark' })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://moss.test/api/v1/channels/plugins/create',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer tok-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'lark' }),
      }),
    )
    await request(app).get('/api/channels/wechat/qr-poll?qrcode=QR-1')
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://moss.test/api/v1/channels/wechat/qr-poll?qrcode=QR-1',
      expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer tok-1' } }),
    )
  })

  test('上游状态码与响应体原样透传（enable 的 409 语义）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, message: '已被其他用户配置' }, 409))
    const res = await request(setupApp()).post('/api/channels/plugins/lark_default/enable').send({})
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ ok: false, message: '已被其他用户配置' })
  })

  test('未登录请求被 requireSession 拦截为 401', async () => {
    const app = express()
    app.use(express.json())
    app.use('/api/channels', createChannelsRouter({ auth: {} as never }))
    const res = await request(app).get('/api/channels/plugins')
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'SESSION_REQUIRED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
