import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { Pool } from 'pg'
import { createApp, registerApiRoutes } from '@server/app'
import type { AppConfig } from '@server/config'
import type { MossAuthPort } from '@server/moss/MossAuthClient'
import type { MossSessionPort } from '@server/moss/MossSessionClient'
import { MossHttpError } from '@server/moss/MossHttpClient'
import { ConversationCoordinator } from '@server/features/conversations/ConversationCoordinator'
import { upsertPrincipal, type Principal } from '@server/features/auth/principalRepository'
import { createWebSession } from '@server/features/auth/sessionRepository'
import { digestToken, generateSessionToken } from '@server/security/sessionToken'
import { encryptToken } from '@server/security/tokenCipher'
import { createTestDatabase, destroyTestDatabase } from './helpers'

const HMAC_KEY = Buffer.from('integration-test-hmac-key-32-bytes-ok!')
const AES_KEY = Buffer.alloc(32, 7)

const testConfig: AppConfig = {
  server: { host: '127.0.0.1', port: 26809 },
  publicOrigin: 'http://localhost:5273',
  trustProxy: false,
  moss: { baseUrl: 'http://moss.test', wsBaseUrl: 'ws://moss.test' },
  session: { ttlSeconds: 3600 },
  upload: { maxFileBytes: 1024, maxFilesPerRequest: 1, maxTotalBytes: 1024 },
  isProduction: false,
  databaseUrl: 'unused-in-test',
  sessionHmacKey: HMAC_KEY,
  tokenAesKey: AES_KEY,
  cookieSecure: false,
}

/** Moss session 桩：A 用户两个会话 + B 用户一个会话（测强制过滤）。 */
const SESSIONS = [
  { sessionId: 'sess-a1', userId: 'moss-a', orgId: 'org-1', status: 'detached', assistantName: 'helper', source: null, lastActiveAt: 1700000001000 },
  { sessionId: 'sess-a2', userId: 'moss-a', orgId: 'org-1', status: 'active', assistantName: null, source: '{"source":"cron"}', lastActiveAt: 1700000002000 },
  { sessionId: 'sess-empty', userId: 'moss-a', orgId: 'org-1', status: 'active', assistantName: null, source: null, lastActiveAt: 1700000004000 },
  { sessionId: 'sess-b1', userId: 'moss-b', orgId: 'org-1', status: 'active', assistantName: null, source: null, lastActiveAt: 1700000003000 },
]

function createFakeMossSession(): MossSessionPort {
  return {
    async list() {
      return SESSIONS
    },
    async get(_tk, sessionId) {
      return SESSIONS.find((s) => s.sessionId === sessionId) ?? null
    },
    async create(_accessToken, input) {
      return { sessionId: `created-${input.assistantName}`, wsUrl: 'ws://moss.test/ws/sessions/x' }
    },
    async context(_tk, sessionId) {
      if (sessionId === 'sess-empty') throw new MossHttpError(404, '', '')
      return {
        session: SESSIONS.find((s) => s.sessionId === sessionId),
        context: {
          customTitle: '我的会话',
          messages: [
            { type: 'user', uuid: 'u1', content: 'hi', cwd: '/home/secret' },
            { type: 'assistant', uuid: 'a1', content: [{ type: 'text', text: 'hello' }] },
            { type: 'tool_use', uuid: 't1', name: 'Read', input: '{}', cwd: '/x' },
          ],
        },
      }
    },
    async resume(_tk, sessionId) {
      const session = SESSIONS.find((s) => s.sessionId === sessionId)
      if (!session) throw new MossHttpError(404, '', '')
      return { session, wsUrl: `ws://moss.test/ws/sessions/${sessionId}` }
    },
    async terminate() {},
    async workspaceTree() {
      return {
        name: 'root',
        relativePath: '',
        isFile: false,
        isDir: true,
        fullPath: '/home/secret/root',
        children: [{ name: 'a.txt', relativePath: 'a.txt', isFile: true, isDir: false, fullPath: '/home/secret/a.txt' }],
      }
    },
    async workspaceFileGet() {
      return { kind: 'text', name: 'a.txt', relativePath: 'a.txt', content: 'abc' }
    },
    async workspaceFilePost() {
        return { relativePath: 'a.txt', size: 3 }
    },
    async sessionSkillsAvailable(): Promise<unknown> {
        return { skills: [] }
    },
  }
}

const fakeMossAuth: MossAuthPort = {
  async loginWithPassword() {
    throw new MossHttpError(401, '', '')
  },
  async loginWithApiKey() {
    throw new MossHttpError(401, '', '')
  },
  async refresh() {
    throw new MossHttpError(401, '', '')
  },
  async me() {
    throw new MossHttpError(401, '', '')
  },
}

describe('conversation REST (real PostgreSQL + fake moss)', () => {
  let pool: Pool
  let principalA: Principal
  let principalB: Principal
  let cookieA = ''
  let cookieB = ''

  async function buildApp(): Promise<Express> {
    const app = createApp({ publicOrigin: testConfig.publicOrigin })
    const moss = createFakeMossSession()
    const auth = { pool, config: testConfig, mossAuth: fakeMossAuth }
    const coordinator = new ConversationCoordinator({ pool, config: testConfig, auth, moss })
    const mossFetch = async (_base: string, req: { path: string }): Promise<unknown> => {
      if (req.path === '/api/v1/agents/installed')
        return [{ name: 'helper' }, { name: 'builtin-agent', isBuiltin: true }]
      if (req.path === '/api/v1/skills/installed') return [{ name: 'known-skill' }]
      if (req.path === '/api/v1/models/available') return { data: [{ id: 'm1', name: 'Model One' }] }
      throw new Error(`unexpected moss path in test: ${req.path}`)
    }
    registerApiRoutes(app, {
      config: testConfig,
      pool,
      mossAuth: fakeMossAuth,
      mossSession: moss,
      mossFetch: mossFetch as never,
      coordinator,
    })
    return app
  }

  beforeAll(async () => {
    pool = await createTestDatabase()
    principalA = await upsertPrincipal(pool, { mossUserId: 'moss-a', orgId: 'org-1', username: 'user_a' })
    principalB = await upsertPrincipal(pool, { mossUserId: 'moss-b', orgId: 'org-1', username: 'user_b' })

    const mkCookie = async (principalId: string): Promise<string> => {
      const token = generateSessionToken()
      await createWebSession(pool, {
        principalId,
        tokenDigest: digestToken(token, HMAC_KEY),
        encrypted: encryptToken(JSON.stringify({ accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600_000 }), AES_KEY),
        accessExpiresAt: new Date(Date.now() + 3600_000),
        expiresAt: new Date(Date.now() + 86400_000),
      })
      return `sudowork_session=${token}`
    }
    cookieA = await mkCookie(principalA.id)
    cookieB = await mkCookie(principalB.id)
  })

  afterAll(async () => {
    await destroyTestDatabase(pool)
  })

  test('GET /api/conversations forces userId filter (A sees only own sessions)', async () => {
    const res = await request(await buildApp()).get('/api/conversations').set('Cookie', cookieA)
    expect(res.status).toBe(200)
    const ids = (res.body.conversations as { id: string }[]).map((c) => c.id)
    expect(ids.sort()).toEqual(['sess-a1', 'sess-a2', 'sess-empty'])
    const a2 = (res.body.conversations as { id: string; source: string | null }[]).find((c) => c.id === 'sess-a2')!
    expect(a2.source).toBe('{"source":"cron"}')
  })

  test('GET /api/conversations for user B sees only B sessions', async () => {
    const res = await request(await buildApp()).get('/api/conversations').set('Cookie', cookieB)
    expect(res.status).toBe(200)
    expect((res.body.conversations as { id: string }[]).map((c) => c.id)).toEqual(['sess-b1'])
  })

  test('GET context sanitizes cwd and enforces ownership', async () => {
    const app = await buildApp()
    const own = await request(app).get('/api/conversations/sess-a1/context').set('Cookie', cookieA)
    expect(own.status).toBe(200)
    expect(own.body.customTitle).toBe('我的会话')
    const messages = own.body.messages as Record<string, unknown>[]
    expect(messages.length).toBe(3)
    for (const msg of messages) {
      expect(msg.cwd).toBeUndefined()
      expect(msg.workDir).toBeUndefined()
    }

    // B 访问 A 的会话 → 403（即使同 org）
    const cross = await request(app).get('/api/conversations/sess-a1/context').set('Cookie', cookieB)
    expect(cross.status).toBe(403)
    expect(cross.body).toEqual({ error: 'SESSION_FORBIDDEN' })

    // 不存在的会话 → 404；空 transcript → 空消息
    const missing = await request(app).get('/api/conversations/nope/context').set('Cookie', cookieA)
    expect(missing.status).toBe(404)
    const empty = await request(app).get('/api/conversations/sess-empty/context').set('Cookie', cookieA)
    expect(empty.status).toBe(200)
    expect(empty.body).toEqual({ customTitle: null, title: null, messages: [] })
  })

  test('POST create validates agent/skill names against fresh visible lists', async () => {
    const app = await buildApp()
    const ok = await request(app)
      .post('/api/conversations')
      .set('Cookie', cookieA)
      .set('Origin', testConfig.publicOrigin)
      .send({ assistantName: 'helper', enabledSkills: ['known-skill'] })
    expect(ok.status).toBe(201)
    expect(ok.body).toEqual({ id: 'created-helper' })

    const badAgent = await request(app)
      .post('/api/conversations')
      .set('Cookie', cookieA)
      .set('Origin', testConfig.publicOrigin)
      .send({ assistantName: 'ghost-agent', enabledSkills: [] })
    expect(badAgent.status).toBe(400)
    expect(badAgent.body.error).toBe('SELECTION_NOT_AVAILABLE')

    const badSkill = await request(app)
      .post('/api/conversations')
      .set('Cookie', cookieA)
      .set('Origin', testConfig.publicOrigin)
      .send({ assistantName: 'helper', enabledSkills: ['ghost-skill'] })
    expect(badSkill.status).toBe(400)
    expect(badSkill.body.field).toBe('enabledSkills')
  })

  test('terminate enforces ownership and returns ok', async () => {
    const app = await buildApp()
    const ok = await request(app).post('/api/conversations/sess-a2/terminate').set('Cookie', cookieA).set('Origin', testConfig.publicOrigin)
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ ok: true })

    const cross = await request(app).post('/api/conversations/sess-a2/terminate').set('Cookie', cookieB).set('Origin', testConfig.publicOrigin)
    expect(cross.status).toBe(403)
  })

  test('workspace tree strips fullPath from nodes', async () => {
    const res = await request(await buildApp())
      .get('/api/conversations/sess-a1/workspace/tree')
      .set('Cookie', cookieA)
    expect(res.status).toBe(200)
    expect(res.body.fullPath).toBeUndefined()
    expect(res.body.children[0].fullPath).toBeUndefined()
    expect(res.body.children[0].relativePath).toBe('a.txt')
  })

  test('options returns models/agents/skills name lists', async () => {
    const res = await request(await buildApp()).get('/api/conversations/options').set('Cookie', cookieA)
    expect(res.status).toBe(200)
    // agents/skills 含列表展示所需字段（displayName/emoji/description/icon；fake 上游只提供 name，其余兜底）；
    // fake 上游的 isBuiltin 条目（builtin-agent）应被过滤——与智能体页"我的智能体"一致
    expect(res.body.agents).toEqual([
      { name: 'helper', displayName: 'helper', emoji: '', description: '' },
    ])
    expect(res.body.skills).toEqual([
      { name: 'known-skill', displayName: 'known-skill', description: '', icon: '', emoji: '' },
    ])
    expect(Array.isArray(res.body.models)).toBe(true)
  })

  test('unauthenticated requests are rejected', async () => {
    const app = await buildApp()
    expect((await request(app).get('/api/conversations')).status).toBe(401)
    // 带 Origin 的 POST 走到认证层被拒；不带 Origin 的 POST 先被 origin guard 拦 403
    expect(
      (
        await request(app)
          .post('/api/conversations')
          .set('Origin', testConfig.publicOrigin)
          .send({})
      ).status,
    ).toBe(401)
  })
})
