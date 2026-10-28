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

function setupApp(isAuthenticated = true): express.Express {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    if (!isAuthenticated) return next()
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

describe('user Vault forwarding', () => {
  test('loads the credential form definitions under the authenticated session', async () => {
    const items = [{ id: 1, name: 'Mail', scope: 'user', entries: [{ config_key: 'password' }] }]
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: items }))
    const response = await request(setupApp())
      .get('/api/v1/config/items')
      .set('Authorization', 'Bearer forged')
    expect(response.body).toEqual({ success: true, data: items })
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'http://moss.test/api/v1/config/items',
      expect.objectContaining({ headers: { Authorization: 'Bearer tok-1' } }),
    )
    expect((await request(setupApp()).put('/api/v1/config/items').send({})).status).toBe(404)
  })

  test.each(['GET', 'PUT', 'DELETE', 'POST'])(
    'uses the session credential for %s',
    async (method) => {
      const route =
        '/api/v1/me/secrets/user%3Aalice%3Amail/password' + (method === 'POST' ? '/enable' : '')
      const agent = request(setupApp())
      const response =
        method === 'GET'
          ? await agent.get(route).set('Authorization', 'Bearer forged')
          : method === 'PUT'
            ? await agent
                .put(route)
                .set('Authorization', 'Bearer forged')
                .send({ value: 'synthetic' })
            : method === 'DELETE'
              ? await agent.delete(route).set('Authorization', 'Bearer forged')
              : await agent.post(route).set('Authorization', 'Bearer forged').send({})
      expect(response.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledWith(
        `http://moss.test${route}`,
        expect.objectContaining({
          method,
          headers: expect.objectContaining({ Authorization: 'Bearer tok-1' }),
        }),
      )
      if (method === 'PUT')
        expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
          body: JSON.stringify({ value: 'synthetic' }),
        })
    },
  )

  test('keeps other user and administrative grants at Moss', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: false, error: { code: 'forbidden', message: 'Access denied' } }, 403),
    )
    const result = await request(setupApp()).get('/api/v1/me/secrets/user%3Abob%3Amail/password')
    expect(result.status).toBe(403)
    expect(result.body.error.code).toBe('forbidden')
    expect((await request(setupApp()).get('/api/v1/admin/secrets')).status).toBe(404)
  })
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

describe('model account and organization billing forwarding', () => {
  test.each([
    '/model-account/access',
    '/model-account',
    '/model-account/logs?page=2&page_size=10',
    '/model-billing/packages',
    '/model-billing/orders?page=2&page_size=10',
  ])('loads %s using the session credential and preserves query parameters', async (path) => {
    const body = { success: true, data: { items: [], total: 0 } }
    fetchMock.mockResolvedValueOnce(jsonResponse(body))
    const response = await request(setupApp())
      .get(`/api/v1${path}`)
      .set('Authorization', 'Bearer forged')
      .set('Idempotency-Key', 'not-for-reads')
    expect(response.status).toBe(200)
    expect(response.type).toBe('application/json')
    expect(response.body).toEqual(body)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`http://moss.test/api/v1${path}`, {
      method: 'GET',
      headers: { Authorization: 'Bearer tok-1' },
    })
  })

  test.each([
    {
      path: '/model-billing/orders',
      body: { purchase_amount_usd: '5.00', payment_method: 'WECHAT' },
    },
    { path: '/model-billing/orders/ORDER-9/pay', body: {} },
    { path: '/model-billing/orders/ORDER-9/sync', body: {} },
    { path: '/model-billing/orders/ORDER-9/cancel', body: {} },
  ])('forwards POST $path with its body and actual order number', async ({ path, body }) => {
    const response = await request(setupApp())
      .post(`/api/v1${path}`)
      .set('Authorization', 'Bearer forged')
      .send(body)
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`http://moss.test/api/v1${path}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-1', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  })

  test('preserves the order creation idempotency key across retries', async () => {
    const app = setupApp()
    const body = { purchase_amount_usd: '5.00', payment_method: 'WECHAT' }
    for (let attempt = 0; attempt < 2; attempt++) {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ success: true, data: { order_no: 'ORDER-9' } }),
      )
      const response = await request(app)
        .post('/api/v1/model-billing/orders')
        .set('Idempotency-Key', 'purchase-9')
        .send(body)
      expect(response.body.data.order_no).toBe('ORDER-9')
      expect(fetchMock).toHaveBeenNthCalledWith(
        attempt + 1,
        'http://moss.test/api/v1/model-billing/orders',
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer tok-1',
            'Content-Type': 'application/json',
            'Idempotency-Key': 'purchase-9',
          },
          body: JSON.stringify(body),
        }),
      )
    }
  })

  test.each([401, 403, 409])(
    'preserves Moss authorization and billing errors (%s)',
    async (status) => {
      const body = { success: false, error: { code: 'billing_rejected', message: 'Not allowed' } }
      fetchMock.mockResolvedValueOnce(jsonResponse(body, status))
      const response = await request(setupApp()).post('/api/v1/model-billing/orders').send({})
      expect(response.status).toBe(status)
      expect(response.body).toEqual(body)
    },
  )

  test('rejects unauthenticated account reads and order writes before contacting Moss', async () => {
    const app = setupApp(false)
    for (const response of [
      await request(app).get('/api/v1/model-account/access'),
      await request(app).post('/api/v1/model-billing/orders').send({}),
    ]) {
      expect(response.status).toBe(401)
      expect(response.body).toEqual({ error: 'SESSION_REQUIRED' })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('does not expose model administration, callbacks or unsupported methods', async () => {
    const app = setupApp()
    const responses = [
      await request(app).get('/api/v1/model-account/members'),
      await request(app).patch('/api/v1/model-account/status').send({ status: 'disabled' }),
      await request(app).get('/api/v1/model-billing/admin/orders'),
      await request(app).post('/api/v1/model-billing/admin/credits').send({}),
      await request(app).post('/api/v1/model-billing/callback').send({}),
      await request(app).delete('/api/v1/model-billing/orders/ORDER-9'),
    ]
    expect(responses.map((response) => response.status)).toEqual(responses.map(() => 404))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('personal Agent forwarding', () => {
  test.each(['/agents/mine', '/user-agents'])(
    'forwards only the current session token for %s',
    async (path) => {
      const response = await request(setupApp()).get(`/api/v1${path}`)
      expect(response.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        `http://moss.test/api/v1${path}`,
        expect.objectContaining({ headers: { Authorization: 'Bearer tok-1' } }),
      )
    },
  )

  test('creates a personal Agent using a validated display name', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { id: 'agent-1', displayName: 'Project' } }, 201),
    )
    const response = await request(setupApp())
      .post('/api/v1/user-agents')
      .send({ displayName: ' Project ' })
    expect(response.status).toBe(201)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'http://moss.test/api/v1/user-agents',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ displayName: 'Project' }) }),
    )
  })

  test.each([
    {},
    { displayName: '' },
    { displayName: '   ' },
    { displayName: 'x'.repeat(61) },
    { displayName: 'Project', userId: 'other' },
    { displayName: 'Project', orgId: 'other' },
    { displayName: 'Project', executionType: 'server' },
    { displayName: 'Project', executionType: 'local' },
  ])('rejects invalid names and caller-supplied ownership: %j', async (body) => {
    const response = await request(setupApp()).post('/api/v1/user-agents').send(body)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('does not expose other Agent administration paths', async () => {
    expect((await request(setupApp()).post('/api/v1/agents').send({})).status).toBe(404)
    expect((await request(setupApp()).get('/api/v1/user-agents/foreign')).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
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

describe('account profile forwarding', () => {
  test.each(['/user/update-profile', '/user/avatar', '/auth/change-password'])(
    'requires a session and uses its identity for %s',
    async (path) => {
      expect((await request(setupApp(false)).post(`/api/v1${path}`).send({})).status).toBe(401)
      expect(fetchMock).not.toHaveBeenCalled()
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ success: false, msg: 'old password invalid' }, 403),
      )
      const response = await request(setupApp())
        .post(`/api/v1${path}`)
        .set('Authorization', 'Bearer forged')
        .send({ nickname: 'Display' })
      expect(response.status).toBe(403)
      expect(response.body.msg).toBe('old password invalid')
      expect(fetchMock).toHaveBeenCalledWith(
        `http://moss.test/api/v1${path}`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer tok-1' }),
        }),
      )
      expect((await request(setupApp()).post(`/api/v1${path}/other-user`).send({})).status).toBe(
        404,
      )
    },
  )
})
