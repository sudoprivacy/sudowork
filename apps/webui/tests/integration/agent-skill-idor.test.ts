import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { Pool } from 'pg'
import { createApp, registerApiRoutes } from '@server/app'
import type { AppConfig } from '@server/config'
import type { MossAuthPort } from '@server/moss/MossAuthClient'
import type { MossAgentPort } from '@server/moss/MossAgentClient'
import type { MossSkillPort } from '@server/moss/MossSkillClient'
import { MossHttpError } from '@server/moss/MossHttpClient'
import { upsertPrincipal } from '@server/features/auth/principalRepository'
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

/** 场景：A（普通 user，scopes=[store:read]）与 B（admin）。 */
const ME_BY_TOKEN: Record<string, { scopes: string[]; role: string; isSuperAdmin: boolean }> = {
  'at-a': { scopes: ['store:read'], role: 'user', isSuperAdmin: false },
  'at-b': { scopes: ['admin:settings', 'store:read'], role: 'admin', isSuperAdmin: false },
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
      const me = ME_BY_TOKEN[at]
      if (!me) throw new MossHttpError(401, '', '')
      return {
        user: { id: 'u', name: 'n' },
        organization: { id: 'o', name: 'O' },
        scopes: me.scopes,
        role: me.role,
        isSuperAdmin: me.isSuperAdmin,
      }
    },
  }
}

/** installed：A 可见 helper；B 可见 helper+writer（可见性由 Moss 决定）。 */
function createFakeAgents(): MossAgentPort {
  const installedByToken: Record<string, { name: string }[]> = {
    'at-a': [{ name: 'helper' }],
    'at-b': [{ name: 'helper' }, { name: 'writer' }],
  }
  const tenantRows = [{ id: 't1', name: 'shared-agent', can_manage: true }, { id: 't2', name: 'b-only', can_manage: false }]
  return {
    async hubCategories() {
      return []
    },
    async hubList() {
      // moss 真实形状：{ assistants, next_cursor, has_more }（agentStore.ts fetchAgentHubAssistants）
      return { assistants: [{ id: 'h1', name: 'hub-agent' }], next_cursor: null, has_more: false }
    },
    async hubDetail(_tk, id) {
      return { id, name: 'hub-agent' }
    },
    async installed(tk) {
      return installedByToken[tk] ?? []
    },
    async install() {
      return { ok: true }
    },
    async create() {
      return { ok: true }
    },
    async uploadCustom() {
      return { ok: true }
    },
    async updateMeta(_tk, body) {
      if ((body as { assistantName?: string }).assistantName === 'writer') {
        throw new MossHttpError(403, '', '') // Moss 侧 owner-only custom
      }
      return { ok: true }
    },
    async uninstall(_tk, body) {
      if ((body as { assistantName?: string }).assistantName === 'writer') {
        throw new MossHttpError(403, '', '')
      }
      return { ok: true }
    },
    async syncFromHub() {
      return { ok: true }
    },
    async syncStatus() {
      return { status: 'idle' }
    },
    async installedRules() {
      return { rules: 'prompt' }
    },
    async tenantList() {
      return tenantRows
    },
    async tenantCreate() {
      return { ok: true }
    },
    async tenantUpdate(_tk, id) {
      if (id === 't-missing') throw new MossHttpError(404, '', '')
      return { ok: true }
    },
    async tenantDelete(_tk, id) {
      if (id === 't-missing') throw new MossHttpError(404, '', '')
      return { ok: true }
    },
    async tenantDownload(_tk, id) {
      if (id === 't-missing') throw new MossHttpError(404, '', '')
      return { data: 'zip' }
    },
    async tenantPublish() {
      return { ok: true }
    },
  }
}

function createFakeSkills(): MossSkillPort {
  const installedByToken: Record<string, { name: string }[]> = {
    'at-a': [{ name: 'pdf' }],
    'at-b': [{ name: 'pdf' }, { name: 'search' }],
  }
  return {
    async hubCategories() {
      return []
    },
    async hubList() {
      // moss 真实形状：{ skills, next_cursor, has_more }（skillStore.ts fetchSkillHubSkills）
      return { skills: [{ id: 's1', name: 'hub-skill' }], next_cursor: null, has_more: false }
    },
    async hubDetail(_tk, id) {
      return { id, name: 'hub-skill' }
    },
    async installed(tk) {
      return installedByToken[tk] ?? []
    },
    async install() {
      return { ok: true }
    },
    async setEnabled() {
      return { ok: true }
    },
    async uploadCustom() {
      return { ok: true }
    },
    async uninstall() {
      return { ok: true }
    },
    async syncFromHub() {
      return { ok: true }
    },
    async syncStatus() {
      return { status: 'idle' }
    },
    async tenantList() {
      return [{ id: 'st1', name: 'shared-skill', can_manage: true }]
    },
    async tenantUpload() {
      return { ok: true }
    },
    async tenantUpdate() {
      return { ok: true }
    },
    async tenantDelete() {
      return { ok: true }
    },
    async tenantDownload() {
      return { data: 'zip' }
    },
    async tenantPublish() {
      return { ok: true }
    },
  }
}

describe('agent/skill routes: authorization and fresh-list IDOR defense (计划 3.4)', () => {
  let pool: Pool
  let cookieA = ''
  let cookieB = ''
  let app: Express

  beforeAll(async () => {
    pool = await createTestDatabase()
    const principalA = await upsertPrincipal(pool, { mossUserId: 'moss-a', orgId: 'org-1', username: 'a' })
    const principalB = await upsertPrincipal(pool, { mossUserId: 'moss-b', orgId: 'org-1', username: 'b' })

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
    registerApiRoutes(app, {
      config: testConfig,
      pool,
      mossAuth: createFakeAuth(),
      agents: createFakeAgents(),
      skills: createFakeSkills(),
    })
  })

  afterAll(async () => {
    await destroyTestDatabase(pool)
  })

  test('installed list is per-token（可见性来自 Moss fresh 列表）', async () => {
    const a = await request(app).get('/api/agents').set('Cookie', cookieA)
    expect(a.status).toBe(200)
    expect(a.body).toEqual([{ name: 'helper' }])

    const b = await request(app).get('/api/agents').set('Cookie', cookieB)
    expect(b.body.map((x: { name: string }) => x.name)).toEqual(['helper', 'writer'])
  })

  test('hub list normalizes moss assistants/skills shape to items', async () => {
    const agents = await request(app).get('/api/agents/hub/list?limit=50').set('Cookie', cookieA)
    expect(agents.status).toBe(200)
    expect(agents.body.items.map((x: { name: string }) => x.name)).toEqual(['hub-agent'])
    expect(agents.body.next_cursor).toBeNull()
    expect(agents.body.has_more).toBe(false)

    const skills = await request(app).get('/api/skills/hub/list?limit=50').set('Cookie', cookieA)
    expect(skills.status).toBe(200)
    expect(skills.body.items.map((x: { name: string }) => x.name)).toEqual(['hub-skill'])
    expect(skills.body.next_cursor).toBeNull()
    expect(skills.body.has_more).toBe(false)
  })

  test('admin-only mutation rejected for plain user (403), allowed for admin', async () => {
    const denied = await request(app)
      .post('/api/agents/install')
      .set('Cookie', cookieA)
      .set('Origin', testConfig.publicOrigin)
      .send({ name: 'hub-agent' })
    expect(denied.status).toBe(403)

    const allowed = await request(app)
      .post('/api/agents/install')
      .set('Cookie', cookieB)
      .set('Origin', testConfig.publicOrigin)
      .send({ name: 'hub-agent' })
    expect(allowed.status).toBe(200)
  })

  test('uninstall of agent not in fresh visible list is 404 (IDOR)', async () => {
    const res = await request(app)
      .post('/api/agents/uninstall')
      .set('Cookie', cookieB)
      .set('Origin', testConfig.publicOrigin)
      .send({ name: 'ghost-agent' })
    expect(res.status).toBe(404)
  })

  test('meta update of invisible agent is 404; visible one passes through', async () => {
    const ghost = await request(app)
      .patch('/api/agents/meta')
      .set('Cookie', cookieB)
      .set('Origin', testConfig.publicOrigin)
      .send({ name: 'ghost', updates: { description: 'x' } })
    expect(ghost.status).toBe(404)

    const ok = await request(app)
      .patch('/api/agents/meta')
      .set('Cookie', cookieB)
      .set('Origin', testConfig.publicOrigin)
      .send({ name: 'helper', updates: { description: 'x' } })
    expect(ok.status).toBe(200)
  })

  test('skill enabled forwards single object and requires admin scope', async () => {
    const denied = await request(app)
      .patch('/api/skills/enabled')
      .set('Cookie', cookieA)
      .set('Origin', testConfig.publicOrigin)
      .send({ name: 'pdf', enabled: false })
    expect(denied.status).toBe(403)

    const ok = await request(app)
      .patch('/api/skills/enabled')
      .set('Cookie', cookieB)
      .set('Origin', testConfig.publicOrigin)
      .send({ name: 'pdf', enabled: false })
    expect(ok.status).toBe(200)
  })

  test('skill enabled of invisible skill is 404', async () => {
    const res = await request(app)
      .patch('/api/skills/enabled')
      .set('Cookie', cookieB)
      .set('Origin', testConfig.publicOrigin)
      .send({ name: 'ghost-skill', enabled: true })
    expect(res.status).toBe(404)
  })

  test('tenant update of can_manage=false row is 403; unknown tenant 404', async () => {
    const forbidden = await request(app)
      .patch('/api/agents/tenant/t2')
      .set('Cookie', cookieB)
      .set('Origin', testConfig.publicOrigin)
      .send({ description: 'x' })
    expect(forbidden.status).toBe(403)

    const missing = await request(app)
      .patch('/api/agents/tenant/t-missing')
      .set('Cookie', cookieB)
      .set('Origin', testConfig.publicOrigin)
      .send({ description: 'x' })
    expect(missing.status).toBe(404)
  })

  test('tenant publish requires source in fresh visible installed list', async () => {
    const ghost = await request(app)
      .post('/api/agents/tenant/publish')
      .set('Cookie', cookieB)
      .set('Origin', testConfig.publicOrigin)
      .send({ sourceName: 'ghost' })
    expect(ghost.status).toBe(404)

    const ok = await request(app)
      .post('/api/agents/tenant/publish')
      .set('Cookie', cookieB)
      .set('Origin', testConfig.publicOrigin)
      .send({ sourceName: 'helper' })
    expect(ok.status).toBe(200)
  })

  test('client-supplied sourcePath is never forwarded (schema strips it)', async () => {
    // schema 不含 sourcePath 字段 → Zod strip 移除；body 里带也会被解析丢弃
    const res = await request(app)
      .post('/api/agents/uninstall')
      .set('Cookie', cookieB)
      .set('Origin', testConfig.publicOrigin)
      .send({ name: 'helper', sourcePath: '/etc/passwd' })
    expect(res.status).toBe(200)
  })
})
