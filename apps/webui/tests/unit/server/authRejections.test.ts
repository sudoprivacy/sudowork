// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { MossHttpError, MossNetworkError, SmsRateLimitedError } from '@sudowork/moss-client'
import type { Pool } from 'pg'
import { createAuthRouter } from '@server/features/auth/authRoutes'
import type { AuthDeps } from '@server/features/auth/authService'

function setup(error: Error) {
  const reject = vi.fn().mockRejectedValue(error)
  const query = vi.fn()
  const me = vi.fn()
  const deps: AuthDeps = {
    pool: { query } as unknown as Pool,
    config: {
      server: { host: '127.0.0.1', port: 26809 },
      publicOrigin: 'http://localhost:5273',
      trustProxy: false,
      moss: { baseUrl: 'http://moss.test', wsBaseUrl: 'ws://moss.test', allowedOrigins: [] },
      session: { ttlSeconds: 3600 },
      upload: { maxFileBytes: 1024, maxFilesPerRequest: 1, maxTotalBytes: 1024 },
      isProduction: false,
      databaseUrl: 'unused',
      sessionHmacKey: Buffer.alloc(32, 3),
      tokenAesKey: Buffer.alloc(32, 7),
      cookieSecure: false,
    },
    mossAuth: {
      loginWithPassword: reject,
      loginWithApiKey: reject,
      loginWithPhone: reject,
      registerWithPhone: reject,
      sendPhoneCode: reject,
      refresh: vi.fn(),
      me,
    },
  }
  const app = express()
  app.use(express.json())
  app.use('/api/auth', createAuthRouter(deps))
  return { app, query, me }
}

const attempts = [
  { path: '/login/password', body: { username: 'user', password: 'password' } },
  { path: '/login/api-key', body: { apiKey: 'test-key' } },
  { path: '/login/phone', body: { phone: '13800138000', code: '123456' } },
  {
    path: '/register/phone',
    body: { phone: '13800138000', code: '123456', nickname: 'User', invitationCode: 'INVITE' },
  },
] as const

describe('authentication rejection responses', () => {
  test.each(attempts)(
    'preserves organization policy rejection at $path',
    async ({ path, body }) => {
      const message = 'Current organization does not allow phone code login'
      const { app, query, me } = setup(
        new MossHttpError(403, JSON.stringify({ error: message }), '/api/v1/auth/login'),
      )
      const response = await request(app).post(`/api/auth${path}`).send(body)
      expect(response.status).toBe(403)
      expect(response.body).toEqual({ error: 'AUTH_REQUEST_REJECTED', message })
      expect(response.headers['set-cookie']).toBeUndefined()
      expect(query).not.toHaveBeenCalled()
      expect(me).not.toHaveBeenCalled()
    },
  )

  test.each(['msg', 'message'])('accepts the compatibility %s error field', async (field) => {
    const message = '当前企业未开启用户名密码登录'
    const { app } = setup(
      new MossHttpError(403, JSON.stringify({ [field]: message }), '/api/v1/auth/login'),
    )
    const response = await request(app).post('/api/auth/login/password').send(attempts[0].body)
    expect(response.body).toEqual({ error: 'AUTH_REQUEST_REJECTED', message })
  })

  test.each([
    { status: 401, body: { error: 'Unknown username' } },
    { status: 401, body: { error: 'Wrong password' } },
    { status: 403, body: null },
    { status: 403, body: { error: { internal: 'detail' } } },
  ])(
    'keeps invalid credentials and malformed errors generic: $status $body',
    async ({ status, body }) => {
      const { app } = setup(new MossHttpError(status, JSON.stringify(body), '/api/v1/auth/login'))
      const response = await request(app).post('/api/auth/login/password').send(attempts[0].body)
      expect(response.status).toBe(401)
      expect(response.body).toEqual({ error: 'INVALID_CREDENTIALS' })
    },
  )

  test('preserves the registration hint for an unknown phone number', async () => {
    const { app } = setup(
      new MossHttpError(
        404,
        JSON.stringify({ code: 'phone_not_registered' }),
        '/api/v1/auth/login',
      ),
    )
    const response = await request(app).post('/api/auth/login/phone').send(attempts[2].body)
    expect(response.status).toBe(404)
    expect(response.body).toEqual({
      error: 'PHONE_NOT_REGISTERED',
      message: '手机号未注册，请使用注册入口',
    })
  })

  test.each([400, 403, 404])('preserves SMS delivery rejection with status %s', async (status) => {
    const message = 'Phone login is not enabled on this server'
    const { app } = setup(
      new MossHttpError(status, JSON.stringify({ error: message }), '/api/v1/auth/send-code'),
    )
    const response = await request(app).post('/api/auth/send-code').send({ phone: '13800138000' })
    expect(response.status).toBe(status)
    expect(response.body).toEqual({ error: 'AUTH_REQUEST_REJECTED', message })
  })

  test('preserves the SMS cooldown', async () => {
    const { app } = setup(new SmsRateLimitedError(45, 'Wait before retrying'))
    const response = await request(app).post('/api/auth/send-code').send({ phone: '13800138000' })
    expect(response.status).toBe(429)
    expect(response.body).toEqual({
      error: 'RATE_LIMITED',
      nextSendIn: 45,
      message: 'Wait before retrying',
    })
  })

  test('maps an unavailable SMS upstream to a network error', async () => {
    const { app } = setup(new MossNetworkError('/api/v1/auth/send-code', new Error('offline')))
    const response = await request(app).post('/api/auth/send-code').send({ phone: '13800138000' })
    expect(response.status).toBe(503)
    expect(response.body).toEqual({ error: 'MOSS_UNAVAILABLE' })
  })
})
