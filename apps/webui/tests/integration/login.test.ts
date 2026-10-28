import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { Pool } from 'pg'
import { createApp, registerApiRoutes } from '@server/app'
import type { AppConfig } from '@server/config'
import type { MossAuthPort, MossSessionPort } from '@sudowork/moss-client'
import { MossHttpError, createMossSessionPort } from '@sudowork/moss-client'
import { createTestDatabase, destroyTestDatabase } from './helpers'

const TOKENS_A = {
  access_token: 'at-a',
  refresh_token: 'rt-a',
  token_type: 'Bearer' as const,
  expires_in: 3600,
}
const TOKENS_B = {
  access_token: 'at-b',
  refresh_token: 'rt-b',
  token_type: 'Bearer' as const,
  expires_in: 3600,
}
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
    async sendPhoneCode() {
      throw new Error('sendPhoneCode not stubbed in this test')
    },
    async loginWithPhone() {
      throw new Error('loginWithPhone not stubbed in this test')
    },
    async registerWithPhone() {
      throw new Error('registerWithPhone not stubbed in this test')
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
  moss: { baseUrl: 'http://moss.test', wsBaseUrl: 'ws://moss.test', allowedOrigins: [] },
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

  function buildApp(
    mossAuth: MossAuthPort = createFakeMossAuth(),
    mossSession?: MossSessionPort,
  ): Express {
    const app = createApp({ publicOrigin: testConfig.publicOrigin })
    registerApiRoutes(app, { config: testConfig, pool, mossAuth, mossSession })
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

  test('phone login rejects an unregistered number instead of entering registration', async () => {
    const mossAuth = createFakeMossAuth()
    mossAuth.loginWithPhone = async () => {
      throw new MossHttpError(
        404,
        JSON.stringify({ code: 'phone_not_registered' }),
        '/api/v1/auth/login',
      )
    }

    const res = await request(buildApp(mossAuth))
      .post('/api/auth/login/phone')
      .set('Origin', testConfig.publicOrigin)
      .send({ phone: '13800138000', code: '123456' })

    expect(res.status).toBe(404)
    expect(res.body).toEqual({
      error: 'PHONE_NOT_REGISTERED',
      message: '手机号未注册，请使用注册入口',
    })
  })

  test('phone registration sends the code and enterprise invitation to Moss', async () => {
    let received: unknown
    const mossAuth = createFakeMossAuth()
    mossAuth.registerWithPhone = async (input) => {
      received = input
      return TOKENS_B
    }

    const res = await request(buildApp(mossAuth))
      .post('/api/auth/register/phone')
      .set('Origin', testConfig.publicOrigin)
      .send({
        phone: '13800138000',
        code: '123456',
        nickname: 'Alice',
        invitationCode: 'JOINME',
      })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(received).toEqual({
      phone: '13800138000',
      code: '123456',
      nickname: 'Alice',
      invitationCode: 'JOINME',
    })
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
    const res = await request(buildApp()).get('/api/auth/session').set('Cookie', cookieA)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      user: { id: 'moss-a', name: 'user_a' },
      organization: { id: 'org-1', name: 'Org One' },
      role: 'user',
      scopes: ['cron:list'],
    })
  })

  test('user B session resolves to B, not A', async () => {
    const res = await request(buildApp()).get('/api/auth/session').set('Cookie', cookieB)
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
    await pool.query("UPDATE web_sessions SET expires_at = now() - interval '1 second'")
    const res = await request(buildApp()).get('/api/auth/session').set('Cookie', cookieA)
    expect(res.status).toBe(401)
    // 恢复，避免影响后续用例
    await pool.query("UPDATE web_sessions SET expires_at = now() + interval '1 hour'")
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

  function workspaceApp(
    options: { actorId?: string; sessionOrgId?: string; switchedUserId?: string } = {},
  ) {
    let switches = 0
    const auth: MossAuthPort = {
      ...createFakeMossAuth(),
      async loginWithPassword(input, baseUrl) {
        if (input.username === 'root') return { ...TOKENS_A, access_token: 'root-home' }
        return createFakeMossAuth().loginWithPassword(input, baseUrl)
      },
      async switchOrg(_accessToken, orgId) {
        switches += 1
        if (orgId !== 'org-2') throw new MossHttpError(400, '', '/api/v1/auth/switch-org')
        return { ...TOKENS_A, access_token: 'root-scoped' }
      },
      async me(accessToken, baseUrl) {
        if (accessToken === 'root-home' || accessToken === 'root-scoped')
          return {
            user: {
              id:
                accessToken === 'root-scoped'
                  ? (options.switchedUserId ?? 'root-user')
                  : 'root-user',
              name: 'Root',
            },
            organization: {
              id: accessToken === 'root-scoped' ? 'org-2' : 'org-1',
              name: 'Selected organization',
            },
            scopes: ['sessions:attach:any'],
            role: 'super_admin',
            isSuperAdmin: true,
          }
        return createFakeMossAuth().me(accessToken, baseUrl)
      },
    }
    const sessions = createMossSessionPort(async (_baseUrl, input) => {
      if (input.path === '/api/v1/sessions/owned-home')
        return {
          session: { sessionId: 'owned-home', userId: 'moss-a', orgId: 'org-1', status: 'active' },
        }
      if (input.path !== '/api/v1/sessions/managed-scoped')
        throw new MossHttpError(404, '', input.path)
      if (input.accessToken !== 'root-scoped') throw new MossHttpError(403, '', input.path)
      return {
        session: {
          sessionId: 'managed-scoped',
          userId: 'owner-two',
          orgId: options.sessionOrgId ?? 'org-2',
          status: 'active',
          source: 'agent-manager',
          clientMetadata: { agent_manager_actor_id: options.actorId ?? 'root-user' },
        },
      }
    })
    return { app: buildApp(auth, sessions), switches: () => switches }
  }

  async function workspaceLogin(app: Express, username = 'root') {
    const response = await request(app)
      .post('/api/auth/login/password')
      .set('Origin', testConfig.publicOrigin)
      .send({ username, password: 'right' })
    expect(response.status).toBe(200)
    return parseCookie(response.headers['set-cookie'])
  }

  function memberApp(options: { selectedUserId?: string; isDenied?: boolean } = {}) {
    const auth: MossAuthPort = {
      ...createFakeMossAuth(),
      async organizations() {
        if (options.isDenied) throw new MossHttpError(403, '', '/api/v1/auth/organizations')
        return {
          organizations: [
            { id: 'org-1', name: 'OPC', userId: 'moss-a', role: 'admin' },
            { id: 'org-2', name: 'Company', userId: 'company-member', role: 'user' },
          ],
        }
      },
      async switchOrg(_token, orgId) {
        if (orgId !== 'org-2')
          throw new Error('Foreign organization must be rejected before minting a token')
        return { ...TOKENS_A, access_token: 'member-selected' }
      },
      async me(token, baseUrl) {
        if (token === 'member-selected')
          return {
            ...ME_A,
            user: { id: options.selectedUserId ?? 'company-member', name: 'Human' },
            organization: { id: 'org-2', name: 'Company' },
            role: 'user',
          }
        return createFakeMossAuth().me(token, baseUrl)
      },
    }
    return buildApp(
      auth,
      createMossSessionPort(async () => ({
        session: {
          sessionId: 'company-session',
          orgId: 'org-2',
          userId: 'company-member',
          status: 'active',
        },
      })),
    )
  }

  test('one human selects a company membership through a new HttpOnly cookie with its actual owner identity', async () => {
    const app = memberApp()
    const original = await workspaceLogin(app, 'user_a')
    const available = await request(app).get('/api/auth/organizations').set('Cookie', original)
    expect(available.status).toBe(200)
    expect(available.body.organizations.map((org: { id: string }) => org.id)).toEqual([
      'org-1',
      'org-2',
    ])
    const selected = await request(app)
      .post('/api/auth/switch-org')
      .set('Origin', testConfig.publicOrigin)
      .set('Cookie', original)
      .send({ orgId: 'org-2' })
    expect(selected.status).toBe(200)
    expect(selected.body).toEqual({ ok: true })
    expect(JSON.stringify(selected.body)).not.toContain('member-selected')
    const cookie = parseCookie(selected.headers['set-cookie'])
    expect(cookie).not.toBe(original)
    const me = await request(app).get('/api/auth/session').set('Cookie', cookie)
    expect(me.body).toMatchObject({
      user: { id: 'company-member' },
      organization: { id: 'org-2' },
      role: 'user',
    })
    expect((await request(app).get('/api/auth/session').set('Cookie', original)).status).toBe(401)
  })

  test('a member workspace handoff verifies the selected membership owner', async () => {
    const app = memberApp()
    const original = await workspaceLogin(app, 'user_a')
    const response = await request(app)
      .post('/api/auth/agent-workspace')
      .set('Origin', testConfig.publicOrigin)
      .set('Cookie', original)
      .send({ orgId: 'org-2', sessionId: 'company-session' })
    expect(response.status).toBe(200)
    expect(
      (
        await request(app)
          .get('/api/auth/session')
          .set('Cookie', parseCookie(response.headers['set-cookie']))
      ).body.user.id,
    ).toBe('company-member')
  })

  test.each([
    { orgId: 'foreign' },
    { orgId: 'org-2', selectedUserId: 'another-human' },
    { orgId: 'org-2', isDenied: true },
  ])(
    'enterprise selection rejects unavailable membership and preserves the existing cookie: %j',
    async (options) => {
      const app = memberApp(options)
      const original = await workspaceLogin(app, 'user_a')
      const response = await request(app)
        .post('/api/auth/switch-org')
        .set('Origin', testConfig.publicOrigin)
        .set('Cookie', original)
        .send({ orgId: options.orgId })
      expect(response.status).toBe(403)
      expect(response.headers['set-cookie']).toBeUndefined()
      expect(
        (await request(app).get('/api/auth/session').set('Cookie', original)).body.user.id,
      ).toBe('moss-a')
    },
  )

  test('a verified manager handoff rotates the cookie into the selected organization', async () => {
    const { app, switches } = workspaceApp()
    const original = await workspaceLogin(app)
    const opened = await request(app)
      .post('/api/auth/agent-workspace')
      .set('Origin', testConfig.publicOrigin)
      .set('Cookie', original)
      .send({ orgId: 'org-2', sessionId: 'managed-scoped' })
    expect(opened.status).toBe(200)
    expect(opened.body).toEqual({ ok: true })
    const next = parseCookie(opened.headers['set-cookie'])
    expect(next).not.toBe(original)
    const me = await request(app).get('/api/auth/session').set('Cookie', next)
    expect(me.body.user.id).toBe('root-user')
    expect(me.body.organization.id).toBe('org-2')
    expect((await request(app).get('/api/auth/session').set('Cookie', original)).status).toBe(401)
    expect(switches()).toBe(1)
    expect(JSON.stringify(opened.body)).not.toContain('root-scoped')
  })

  test('ordinary users cannot turn a public organization hint into switch authority', async () => {
    const { app, switches } = workspaceApp()
    const cookie = await workspaceLogin(app, 'user_a')
    const response = await request(app)
      .post('/api/auth/agent-workspace')
      .set('Origin', testConfig.publicOrigin)
      .set('Cookie', cookie)
      .send({ orgId: 'org-2', sessionId: 'managed-scoped' })
    expect(response.status).toBe(403)
    expect(switches()).toBe(0)
    expect(
      (await request(app).get('/api/auth/session').set('Cookie', cookie)).body.organization.id,
    ).toBe('org-1')
  })

  test.each([
    { actorId: 'another-manager' },
    { sessionOrgId: 'org-3' },
    { switchedUserId: 'another-user' },
  ])('a rejected handoff retains the original cookie identity: %j', async (options) => {
    const { app } = workspaceApp(options)
    const cookie = await workspaceLogin(app)
    const response = await request(app)
      .post('/api/auth/agent-workspace')
      .set('Origin', testConfig.publicOrigin)
      .set('Cookie', cookie)
      .send({ orgId: 'org-2', sessionId: 'managed-scoped' })
    expect(response.status).toBe(403)
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(
      (await request(app).get('/api/auth/session').set('Cookie', cookie)).body.organization.id,
    ).toBe('org-1')
  })

  test('same-organization owner handoffs verify access without rotating the cookie', async () => {
    const { app, switches } = workspaceApp()
    const cookie = await workspaceLogin(app, 'user_a')
    const response = await request(app)
      .post('/api/auth/agent-workspace')
      .set('Origin', testConfig.publicOrigin)
      .set('Cookie', cookie)
      .send({ orgId: 'org-1', sessionId: 'owned-home' })
    expect(response.status).toBe(200)
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(switches()).toBe(0)
  })

  test('workspace handoffs require authentication and same-origin POST', async () => {
    const { app } = workspaceApp()
    const input = { orgId: 'org-2', sessionId: 'managed-scoped' }
    expect(
      (
        await request(app)
          .post('/api/auth/agent-workspace')
          .set('Origin', testConfig.publicOrigin)
          .send(input)
      ).status,
    ).toBe(401)
    const cookie = await workspaceLogin(app)
    expect(
      (
        await request(app)
          .post('/api/auth/agent-workspace')
          .set('Origin', 'https://evil.example')
          .set('Cookie', cookie)
          .send(input)
      ).status,
    ).toBe(403)
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
