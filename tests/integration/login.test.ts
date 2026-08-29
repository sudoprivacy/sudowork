import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { Pool } from 'pg'
import { createApp, registerApiRoutes } from '@server/app'
import type { AppConfig } from '@server/config'
import type { MossAuthPort } from '@server/moss/MossAuthClient'
import { MossHttpError } from '@server/moss/MossHttpClient'
import { createTestDatabase, destroyTestDatabase } from './helpers'

const TOKENS_A = { access_token: 'at-a', refresh_token: 'rt-a', token_type: 'Bearer' as const, expires_in: 3600 }
const TOKENS_B = { access_token: 'at-b', refresh_token: 'rt-b', token_type: 'Bearer' as const, expires_in: 3600 }
const ME_A = {
  user: { id: 'moss-a', name: 'user_a' },
  organization: { id: 'org-1', name: 'Org One' },
  scopes: ['cron:list'],
  role: 'user',
}
const ME_B = {
  user: { id: 'moss-b', name: 'user_b' },
  organization: { id: 'org-1', name: 'Org One' },
  scopes: [] as string[],
  role: 'user',
}

function createFakeMossAuth(): MossAuthPort {
  return {
    async loginWithPassword(input) {
      if (input.username === 'user_a' && input.password === 'right') return TOKENS_A
      throw new MossHttpError(401, '{"error":"invalid"}', '/api/v1/auth/login')
    },
    async loginWithApiKey(apiKey) {
      if (apiKey === 'sk-good') return TOKENS_B
      throw new MossHttpError(401, '{"error":"invalid"}', '/api/v1/auth/login')
    },
    async refresh() {
      throw new MossHttpError(401, '', '/api/v1/auth/token')
    },
    async me(at) {
      if (at === 'at-a') return ME_A
      if (at === 'at-b') return ME_B
      throw new MossHttpError(401, '', '/api/v1/auth/me')
    },
  }
}

const testConfig: AppConfig = {
  server: { host: '127.0.0.1', port: 26809 },
  publicOrigin: 'http://localhost:5273',
  trustProxy: false,
  moss: { baseUrl: 'http://moss.test', wsBaseUrl: 'ws://moss.test' },
  session: { ttlSeconds: 3600 },
  upload: { maxFileBytes: 1024, maxFilesPerRequest: 1, maxTotalBytes: 1024 },
  isProduction: false,
  databaseUrl: 'unused-in-test',
  sessionHmacKey: Buffer.from('integration-test-hmac-key-32-bytes-ok!'),
  tokenAesKey: Buffer.alloc(32, 7),
  cookieSecure: false,
}

describe('auth routes (real PostgreSQL + fake moss)', () => {
  let pool: Pool

  function buildApp(): Express {
    const app = createApp({ publicOrigin: testConfig.publicOrigin })
    registerApiRoutes(app, { config: testConfig, pool, mossAuth: createFakeMossAuth() })
    return app
  }

  beforeAll(async () => {
    pool = await createTestDatabase()
  })

  afterAll(async () => {
    await destroyTestDatabase(pool)
  })

  let cookieA = ''
  let cookieB = ''

  test('password login sets HttpOnly SameSite=Strict cookie and never returns tokens', async () => {
    const res = await request(buildApp())
      .post('/api/auth/login/password')
      .set('Origin', testConfig.publicOrigin)
      .send({ username: 'user_a', password: 'right' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    const setCookie = res.headers['set-cookie']
    expect(setCookie).toBeDefined()
    const cookieStr = toArray(setCookie).join('\n')
    expect(cookieStr).toContain('sudowork_session=')
    expect(cookieStr.toLowerCase()).toContain('httponly')
    expect(cookieStr.toLowerCase()).toContain('samesite=strict')
    // body 与 cookie 都不包含 moss token
    expect(JSON.stringify(res.body)).not.toContain('at-a')
    expect(JSON.stringify(res.body)).not.toContain('rt-a')
    cookieA = parseCookie(setCookie)
  })

  test('wrong password and unknown user return the same 401 error', async () => {
    const app = buildApp()
    const wrong = await request(app)
      .post('/api/auth/login/password')
      .set('Origin', testConfig.publicOrigin)
      .send({ username: 'user_a', password: 'wrong' })
    expect(wrong.status).toBe(401)
    expect(wrong.body).toEqual({ error: 'INVALID_CREDENTIALS' })

    const unknown = await request(app)
      .post('/api/auth/login/password')
      .set('Origin', testConfig.publicOrigin)
      .send({ username: 'nobody', password: 'whatever' })
    expect(unknown.status).toBe(401)
    expect(unknown.body).toEqual({ error: 'INVALID_CREDENTIALS' })
  })

  test('api key login works and yields a separate session', async () => {
    const res = await request(buildApp())
      .post('/api/auth/login/api-key')
      .set('Origin', testConfig.publicOrigin)
      .send({ apiKey: 'sk-good' })

    expect(res.status).toBe(200)
    cookieB = parseCookie(res.headers['set-cookie'])
    expect(cookieB).toContain('sudowork_session=')
    expect(cookieB).not.toBe(cookieA)
  })

  test('GET /api/auth/session returns whitelist DTO for user A', async () => {
    const res = await request(buildApp())
      .get('/api/auth/session')
      .set('Cookie', cookieA)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      user: { id: 'moss-a', name: 'user_a' },
      organization: { id: 'org-1', name: 'Org One' },
      role: 'user',
      scopes: ['cron:list'],
    })
  })

  test('user B session resolves to B, not A', async () => {
    const res = await request(buildApp())
      .get('/api/auth/session')
      .set('Cookie', cookieB)
    expect(res.status).toBe(200)
    expect(res.body.user.id).toBe('moss-b')
    expect(res.body.scopes).toEqual([])
  })

  test('missing/invalid cookie returns 401', async () => {
    const app = buildApp()
    const noCookie = await request(app).get('/api/auth/session')
    expect(noCookie.status).toBe(401)
    expect(noCookie.body).toEqual({ error: 'SESSION_REQUIRED' })

    const garbage = await request(app)
      .get('/api/auth/session')
      .set('Cookie', 'sudowork_session=not-a-real-token')
    expect(garbage.status).toBe(401)
  })

  test('expired web session is rejected', async () => {
    // 直接将 A 的 session 置为过期
    await pool.query('UPDATE web_sessions SET expires_at = now() - interval \'1 second\'')
    const res = await request(buildApp())
      .get('/api/auth/session')
      .set('Cookie', cookieA)
    expect(res.status).toBe(401)
    // 恢复，避免影响后续用例
    await pool.query('UPDATE web_sessions SET expires_at = now() + interval \'1 hour\'')
  })

  test('logout clears cookie and invalidates the session', async () => {
    const app = buildApp()
    const out = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookieB)
      .set('Origin', testConfig.publicOrigin)
    expect(out.status).toBe(200)
    const cleared = Array.isArray(out.headers['set-cookie'])
      ? (out.headers['set-cookie'] as string[]).join('\n')
      : (out.headers['set-cookie'] ?? '')
    expect(cleared).toContain('sudowork_session=;')
    expect(cleared).toContain('Expires=Thu, 01 Jan 1970')

    const after = await request(app).get('/api/auth/session').set('Cookie', cookieB)
    expect(after.status).toBe(401)
  })

  test('login rate limit kicks in after repeated failures', async () => {
    // 独立 app 实例 → 独立 limiter 计数
    const app = buildApp()
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post('/api/auth/login/password')
        .set('Origin', testConfig.publicOrigin)
        .send({ username: 'user_a', password: 'wrong' })
      expect(res.status).toBe(401)
    }
    const blocked = await request(app)
      .post('/api/auth/login/password')
      .set('Origin', testConfig.publicOrigin)
      .send({ username: 'user_a', password: 'right' })
    expect(blocked.status).toBe(429)
  })

  test('login endpoints reject cross-origin requests', async () => {
    const res = await request(buildApp())
      .post('/api/auth/login/password')
      .set('Origin', 'https://evil.example')
      .send({ username: 'user_a', password: 'right' })
    expect(res.status).toBe(403)
  })
})

function toArray(setCookie: string | string[] | undefined): string[] {
  if (setCookie === undefined) return []
  return Array.isArray(setCookie) ? setCookie : [setCookie]
}

function parseCookie(setCookie: string | string[] | undefined): string {
  const first = toArray(setCookie)[0]
  return first?.split(';')[0]?.trim() ?? ''
}
