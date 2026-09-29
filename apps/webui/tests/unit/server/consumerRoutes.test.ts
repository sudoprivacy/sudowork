// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import type { AuthedRequest } from '@server/features/auth/sessionMiddleware'

vi.mock('@server/features/auth/authService', () => ({
  getMossContext: vi.fn(async () => ({ baseUrl: 'http://moss.test', accessToken: 'tok-1' })),
}))

const { createConsumerRouter } = await import('@server/features/consumer/consumerRoutes')

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
  app.use('/api/v1', createConsumerRouter({ auth: {} as never }))
  return app
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }))
  vi.stubGlobal('fetch', fetchMock)
})

describe('consumer 转发：recharge 路径', () => {
  test('套餐列表转发到 moss 并透传响应', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: [{ points: 5 }] }))
    const res = await request(setupApp()).get('/api/v1/recharge/packages')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, data: [{ points: 5 }] })
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'http://moss.test/api/v1/recharge/packages',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer tok-1' },
      }),
    )
  })

  test('订单列表携带 query 透传', async () => {
    await request(setupApp()).get('/api/v1/recharge/list?page=1&pageSize=100')
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'http://moss.test/api/v1/recharge/list?page=1&pageSize=100',
      expect.anything(),
    )
  })

  test.each([
    { method: 'get', path: '/api/v1/recharge/query/ORDER-9' },
    { method: 'post', path: '/api/v1/recharge/cancel/ORDER-9' },
  ])('$method 参数路径用真实订单号重建上游 URL', async ({ method, path }) => {
    const app = setupApp()
    await (method === 'get' ? request(app).get(path) : request(app).post(path).send({}))
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `http://moss.test${path}`,
      expect.objectContaining({ method: method.toUpperCase() }),
    )
  })

  test('创建订单与支付 POST 透传 body 和 token', async () => {
    const app = setupApp()
    await request(app).post('/api/v1/recharge/create').send({ amount: 5, payment_method: 'ALIPAY' })
    await request(app).post('/api/v1/recharge/pay').send({ order_no: 'ORDER-9' })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://moss.test/api/v1/recharge/create',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer tok-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 5, payment_method: 'ALIPAY' }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://moss.test/api/v1/recharge/pay',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ order_no: 'ORDER-9' }),
      }),
    )
  })

  test('上游非 2xx 的状态码与响应体原样透传', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false, msg: '订单已过期' }, 409))
    const res = await request(setupApp()).get('/api/v1/recharge/query/ORDER-9')
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ success: false, msg: '订单已过期' })
  })
})

describe('consumer 转发：既有路径回归', () => {
  test('GET /user/dashboard 转发目标不变', async () => {
    await request(setupApp()).get('/api/v1/user/dashboard')
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'http://moss.test/api/v1/user/dashboard',
      expect.anything(),
    )
  })

  test('POST /credit-applications 的 query 与 body 透传不变', async () => {
    await request(setupApp())
      .post('/api/v1/credit-applications?page=2')
      .send({ points: 100, reason: 'test' })
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'http://moss.test/api/v1/credit-applications?page=2',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ points: 100, reason: 'test' }),
      }),
    )
  })

  test('未登录请求仍被 requireSession 拦截为 401', async () => {
    const app = express()
    app.use(express.json())
    app.use('/api/v1', createConsumerRouter({ auth: {} as never }))
    const res = await request(app).get('/api/v1/recharge/packages')
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'SESSION_REQUIRED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
