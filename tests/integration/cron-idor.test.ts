import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { Pool } from 'pg'
import { createApp, registerApiRoutes } from '@server/app'
import type { AppConfig } from '@server/config'
import type { MossAuthPort } from '@server/moss/MossAuthClient'
import type { MossCronPort } from '@server/moss/MossCronClient'
import type { MossSessionPort } from '@server/moss/MossSessionClient'
import { MossHttpError } from '@server/moss/MossHttpClient'
import { upsertPrincipal, type Principal } from '@server/features/auth/principalRepository'
import { createWebSession } from '@server/features/auth/sessionRepository'
import { digestToken, generateSessionToken } from '@server/security/sessionToken'
import { encryptToken } from '@server/security/tokenCipher'
import { createTestDatabase, destroyTestDatabase } from './helpers'

const HMAC_KEY = Buffer.from('integration-test-hmac-key-32-bytes-ok!')
const AES_KEY = Buffer.alloc(32, 7)

const testConfig: AppConfig = {
  server: { host: '127.0.0.1', port: 0 },
  publicOrigin: 'http://localhost:5273',
  trustProxy: false,
  moss: { baseUrl: 'http://moss.test', wsBaseUrl: 'ws://moss.test' },
  session: { ttlSeconds: 3600 },
  upload: { maxFileBytes: 1024, maxFilesPerRequest: 1, maxTotalBytes: 1024 },
  isProduction: false,
  databaseUrl: 'unused',
  sessionHmacKey: HMAC_KEY,
  tokenAesKey: AES_KEY,
  cookieSecure: false,
}

/** A 的 job：job-a1；B 的 job：job-b1（同一 org）。 */
const JOBS: Record<string, Record<string, unknown>[]> = {
  'at-a': [{ id: 'job-a1', userId: 'moss-a', name: 'A 任务', enabled: true, schedule: { kind: 'every', value: '10m' } }],
  'at-b': [{ id: 'job-b1', userId: 'moss-b', name: 'B 任务', enabled: true, schedule: { kind: 'cron', value: '0 9 * * *' } }],
}

function createFakeAuth(): MossAuthPort {
  return {
    async loginWithPassword() {
      throw new MossHttpError(401, '', '')
    },
    async loginWithApiKey() {
      throw new MossHttpError(401, '', '')
    },
    async refresh() {
      throw new MossHttpError(401, '', '')
    },
    async me(at) {
      return {
        user: { id: 'u', name: 'n' },
        organization: { id: 'org-1', name: 'O' },
        scopes: at === 'at-admin' ? ['admin:cron', 'cron:list:any'] : ['cron:self'],
        role: 'user',
      }
    },
  }
}

function createFakeCron(): MossCronPort {
  const store = new Map<string, Record<string, unknown>>()
  return {
    async list(tk) {
      return { jobs: JOBS[tk] ?? [] }
    },
    async adminList() {
      return { jobs: [...JOBS['at-a']!, ...JOBS['at-b']!] }
    },
    async get(_tk, id) {
      const row = store.get(id) ?? [...JOBS['at-a']!, ...JOBS['at-b']!].find((j) => j.id === id)
      if (!row) throw new MossHttpError(404, '', '')
      return { ...row, success: true, data: row }
    },
    async create(_tk, body) {
      const id = `job-new-${store.size}`
      const row = { id, userId: 'moss-a', ...(body as Record<string, unknown>) }
      store.set(id, row)
      return row
    },
    async update(_tk, id, body) {
      const row = store.get(id)
      if (!row) throw new MossHttpError(404, '', '')
      Object.assign(row, body)
      return row
    },
    async remove(_tk, id) {
      if (!store.has(id) && ![...JOBS['at-a']!, ...JOBS['at-b']!].some((j) => j.id === id)) {
        throw new MossHttpError(404, '', '')
      }
      store.delete(id)
      return { success: true }
    },
    async trigger(_tk, id) {
      if (!store.has(id) && ![...JOBS['at-a']!, ...JOBS['at-b']!].some((j) => j.id === id)) {
        throw new MossHttpError(404, '', '')
      }
      return { success: true }
    },
    async runs(_tk, id) {
      if (![...JOBS['at-a']!, ...JOBS['at-b']!].some((j) => j.id === id) && !store.has(id)) {
        throw new MossHttpError(404, '', '')
      }
      return { runs: [{ id: 'r1', status: 'success' }] }
    },
  }
}

function createFakeSessions(): MossSessionPort {
  return {
    async list() {
      return []
    },
    async get(_tk, id) {
      if (id === 'sess-a1') return { sessionId: id, userId: 'moss-a', orgId: 'org-1', status: 'active' }
      if (id === 'sess-b1') return { sessionId: id, userId: 'moss-b', orgId: 'org-1', status: 'active' }
      return null
    },
    async create() {
      return { sessionId: 'x', wsUrl: '' }
    },
    async context() {
      return { context: { messages: [] } }
    },
    async resume(_tk, id) {
      return { session: { sessionId: id, userId: 'moss-a', orgId: 'org-1', status: 'active' }, wsUrl: '' }
    },
    async terminate() {},
    async workspaceTree() {
      return null
    },
    async workspaceFileGet() {
      return null
    },
    async workspaceFilePost() {
      return {}
    },
  }
}

describe('cron routes (real PostgreSQL + fake moss)', () => {
  let pool: Pool
  let principalA: Principal
  let principalB: Principal
  let cookieA = ''
  let cookieB = ''
  let app: Express

  beforeAll(async () => {
    pool = await createTestDatabase()
    principalA = await upsertPrincipal(pool, { mossUserId: 'moss-a', orgId: 'org-1', username: 'a' })
    principalB = await upsertPrincipal(pool, { mossUserId: 'moss-b', orgId: 'org-1', username: 'b' })

    const mkCookie = async (principalId: string, accessToken: string): Promise<string> => {
      const token = generateSessionToken()
      await createWebSession(pool, {
        principalId,
        tokenDigest: digestToken(token, HMAC_KEY),
        encrypted: encryptToken(
          JSON.stringify({ accessToken, refreshToken: 'rt', expiresAt: Date.now() + 3600_000 }),
          AES_KEY,
        ),
        accessExpiresAt: new Date(Date.now() + 3600_000),
        expiresAt: new Date(Date.now() + 86400_000),
      })
      return `sudowork_session=${token}`
    }
    cookieA = await mkCookie(principalA.id, 'at-a')
    cookieB = await mkCookie(principalB.id, 'at-b')

    app = createApp({ publicOrigin: testConfig.publicOrigin })
    const agentsNames = new Set(['helper'])
    registerApiRoutes(app, {
      config: testConfig,
      pool,
      mossAuth: createFakeAuth(),
      mossSession: createFakeSessions(),
      cron: createFakeCron(),
      fetchVisibleAgentNames: async () => agentsNames,
    })
  })

  afterAll(async () => {
    await destroyTestDatabase(pool)
  })

  const ORIGIN = testConfig.publicOrigin

  test('list returns only own jobs even via admin-capable token', async () => {
    const res = await request(app).get('/api/cron').set('Cookie', cookieA)
    expect(res.status).toBe(200)
    expect(res.body.jobs.map((j: { id: string }) => j.id)).toEqual(['job-a1'])
    expect(res.body.canCreate).toBe(true)
  })

  test('cross-user job operations are 404 (IDOR)', async () => {
    const patch = await request(app)
      .patch('/api/cron/job-a1')
      .set('Cookie', cookieB)
      .set('Origin', ORIGIN)
      .send({ enabled: false })
    expect(patch.status).toBe(404)

    const del = await request(app)
      .delete('/api/cron/job-a1')
      .set('Cookie', cookieB)
      .set('Origin', ORIGIN)
    expect(del.status).toBe(404)

    const trigger = await request(app)
      .post('/api/cron/job-a1/trigger')
      .set('Cookie', cookieB)
      .set('Origin', ORIGIN)
    expect(trigger.status).toBe(404)

    const runs = await request(app).get('/api/cron/job-a1/runs').set('Cookie', cookieB)
    expect(runs.status).toBe(404)
  })

  test('owner can trigger own job and read runs', async () => {
    const trigger = await request(app)
      .post('/api/cron/job-a1/trigger')
      .set('Cookie', cookieA)
      .set('Origin', ORIGIN)
    expect(trigger.status).toBe(200)

    const runs = await request(app).get('/api/cron/job-a1/runs').set('Cookie', cookieA)
    expect(runs.status).toBe(200)
  })

  test('boundSessionId of another user session is rejected', async () => {
    const res = await request(app)
      .post('/api/cron')
      .set('Cookie', cookieA)
      .set('Origin', ORIGIN)
      .send({
        name: 'bad-bind',
        schedule: { kind: 'every', value: '10m' },
        conversationMode: 'reuse',
        boundSessionId: 'sess-b1',
      })
    expect(res.status).toBe(403)
  })

  test('boundSessionId of own session passes', async () => {
    const res = await request(app)
      .post('/api/cron')
      .set('Cookie', cookieA)
      .set('Origin', ORIGIN)
      .send({
        name: 'good-bind',
        schedule: { kind: 'every', value: '10m' },
        conversationMode: 'reuse',
        boundSessionId: 'sess-a1',
      })
    expect(res.status).toBe(201)
  })

  test('assistant name must be in fresh visible list', async () => {
    const bad = await request(app)
      .post('/api/cron')
      .set('Cookie', cookieA)
      .set('Origin', ORIGIN)
      .send({
        name: 'with-agent',
        schedule: { kind: 'cron', value: '0 9 * * *' },
        conversationMode: 'new',
        assistantName: 'ghost-agent',
      })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('SELECTION_NOT_AVAILABLE')

    const ok = await request(app)
      .post('/api/cron')
      .set('Cookie', cookieA)
      .set('Origin', ORIGIN)
      .send({
        name: 'with-agent-ok',
        schedule: { kind: 'cron', value: '0 9 * * *' },
        conversationMode: 'new',
        assistantName: 'helper',
      })
    expect(ok.status).toBe(201)
  })

  test('create rejects legacy expr schedule field', async () => {
    const res = await request(app)
      .post('/api/cron')
      .set('Cookie', cookieA)
      .set('Origin', ORIGIN)
      .send({ name: 'x', schedule: { kind: 'cron', expr: '0 9 * * *' } })
    expect(res.status).toBe(400)
  })
})
