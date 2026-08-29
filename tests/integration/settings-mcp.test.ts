import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { Pool } from 'pg'
import { createApp, registerApiRoutes } from '@server/app'
import type { AppConfig } from '@server/config'
import type { MossAuthPort } from '@server/moss/MossAuthClient'
import type { MossMcpPort } from '@server/moss/MossMcpClient'
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

/** MCP servers：s-personal（scope=user 本人）、s-org（组织级）。 */
function createFakeMcp(): MossMcpPort {
  return {
    async servers() {
      return [
        { id: 's-personal', name: 'my-mcp', scope: 'user', user_disabled: false },
        { id: 's-org', name: 'org-mcp', scope: 'org', user_disabled: false },
      ]
    },
    async templates() {
      return [{ id: 'tpl-1', name: 'T1' }]
    },
    async installTemplate() {
      return { ok: true }
    },
    async installJson() {
      return { ok: true }
    },
    async createServer() {
      return { ok: true }
    },
    async setEnabled() {
      return { ok: true }
    },
    async test() {
      return { ok: true }
    },
    async getUserConfig() {
      return { config_values: {} }
    },
    async putUserConfig() {
      return { ok: true }
    },
    async updateServer(_tk, id) {
      if (id === 's-org') throw new MossHttpError(403, '', '')
      return { ok: true }
    },
    async deleteServer(_tk, id) {
      if (id === 's-org') throw new MossHttpError(403, '', '')
      return { ok: true }
    },
    async policy() {
      return { allow_personal_mcp: true }
    },
    async userProfile() {
      return { user: { id: 'u', name: 'tester', role: 'user' }, totalTokens: 12345, sessionCount: 6 }
    },
    async tenantConfig() {
      return { app_name: 'Acme Moss', logo: null }
    },
  }
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
    async me() {
      throw new MossHttpError(401, '', '')
    },
  }
}

describe('settings + mcp routes (real PostgreSQL + fake moss)', () => {
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

    const mkCookie = async (principalId: string): Promise<string> => {
      const token = generateSessionToken()
      await createWebSession(pool, {
        principalId,
        tokenDigest: digestToken(token, HMAC_KEY),
        encrypted: encryptToken(
          JSON.stringify({ accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600_000 }),
          AES_KEY,
        ),
        accessExpiresAt: new Date(Date.now() + 3600_000),
        expiresAt: new Date(Date.now() + 86400_000),
      })
      return `sudowork_session=${token}`
    }
    cookieA = await mkCookie(principalA.id)
    cookieB = await mkCookie(principalB.id)

    app = createApp({ publicOrigin: testConfig.publicOrigin })
    registerApiRoutes(app, {
      config: testConfig,
      pool,
      mossAuth: createFakeAuth(),
      mcp: createFakeMcp(),
    })
  })

  afterAll(async () => {
    await destroyTestDatabase(pool)
  })

  const ORIGIN = testConfig.publicOrigin

  test('profile returns moss user profile projection', async () => {
    const res = await request(app).get('/api/settings/profile').set('Cookie', cookieA)
    expect(res.status).toBe(200)
    expect(res.body.user.name).toBe('tester')
    expect(res.body.totalTokens).toBe(12345)
  })

  test('display preferences are isolated per principal', async () => {
    const put = await request(app)
      .put('/api/settings/display')
      .set('Cookie', cookieA)
      .set('Origin', ORIGIN)
      .send({ theme: 'dark', fontScale: 1.2 })
    expect(put.status).toBe(200)

    const mine = await request(app).get('/api/settings/display').set('Cookie', cookieA)
    expect(mine.body).toEqual({ theme: 'dark', fontScale: 1.2 })

    const other = await request(app).get('/api/settings/display').set('Cookie', cookieB)
    expect(other.body).toEqual({ theme: 'system', fontScale: 1 })

    const invalid = await request(app)
      .put('/api/settings/display')
      .set('Cookie', cookieA)
      .set('Origin', ORIGIN)
      .send({ theme: 'neon', fontScale: 9 })
    expect(invalid.status).toBe(400)
  })

  test('about includes webui metadata and moss base url', async () => {
    const res = await request(app).get('/api/settings/about').set('Cookie', cookieA)
    expect(res.status).toBe(200)
    expect(res.body.branding.appName).toBe('Acme Moss')
    expect(res.body.webui.name).toBe('sudowork-webui')
    expect(res.body.mossBaseUrl).toBe('http://moss.test')
  })

  test('mcp servers list returns visible rows', async () => {
    const res = await request(app).get('/api/mcp/servers').set('Cookie', cookieA)
    expect(res.status).toBe(200)
    expect(res.body.map((s: { id: string }) => s.id).sort()).toEqual(['s-org', 's-personal'])
  })

  test('own-personal-only operations enforced (scope check)', async () => {
    // 个人 MCP：测试/删除允许
    expect(
      (await request(app).post('/api/mcp/servers/s-personal/test').set('Cookie', cookieA).set('Origin', ORIGIN))
        .status,
    ).toBe(200)
    expect(
      (await request(app).delete('/api/mcp/servers/s-personal').set('Cookie', cookieA).set('Origin', ORIGIN))
        .status,
    ).toBe(200)

    // 组织级 MCP：测试/删除 → 403（scope !== 'user'）
    expect(
      (await request(app).post('/api/mcp/servers/s-org/test').set('Cookie', cookieA).set('Origin', ORIGIN))
        .status,
    ).toBe(403)
    expect(
      (await request(app).delete('/api/mcp/servers/s-org').set('Cookie', cookieA).set('Origin', ORIGIN))
        .status,
    ).toBe(403)

    // 未知 MCP → 404
    expect(
      (await request(app).post('/api/mcp/servers/s-ghost/test').set('Cookie', cookieA).set('Origin', ORIGIN))
        .status,
    ).toBe(404)
  })

  test('install-json accepts json_config', async () => {
    const res = await request(app)
      .post('/api/mcp/install-json')
      .set('Cookie', cookieA)
      .set('Origin', ORIGIN)
      .send({ json_config: '{"mcpServers":{}}' })
    expect(res.status).toBe(201)
  })

  test('policy is read-only projection', async () => {
    const res = await request(app).get('/api/mcp/policy').set('Cookie', cookieA)
    expect(res.status).toBe(200)
    expect(res.body.allow_personal_mcp).toBe(true)
  })
})
