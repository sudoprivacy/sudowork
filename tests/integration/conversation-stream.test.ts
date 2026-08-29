import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { Pool } from 'pg'
import { WebSocket, WebSocketServer } from 'ws'
import { attachConversationWebSocket, createApp, registerApiRoutes } from '@server/app'
import type { AppConfig } from '@server/config'
import type { MossAuthPort } from '@server/moss/MossAuthClient.js'
import type { MossSessionPort } from '@server/moss/MossSessionClient.js'
import { MossHttpError } from '@server/moss/MossHttpClient.js'
import { ConversationCoordinator } from '@server/features/conversations/ConversationCoordinator.js'
import { upsertPrincipal, type Principal } from '@server/features/auth/principalRepository.js'
import { createWebSession } from '@server/features/auth/sessionRepository.js'
import { digestToken, generateSessionToken } from '@server/security/sessionToken.js'
import { encryptToken } from '@server/security/tokenCipher.js'
import { createTestDatabase, destroyTestDatabase } from './helpers'

const HMAC_KEY = Buffer.from('integration-test-hmac-key-32-bytes-ok!')
const AES_KEY = Buffer.alloc(32, 7)
const SID = 'sess-stream-1'

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : 0)
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

type WsEvent = Record<string, unknown>

/** 消息收集器：预先挂监听，避免逐条 await 丢失快速连续到达的事件。 */
function collector(ws: WebSocket): { events: WsEvent[]; waitFor: (pred: (e: WsEvent) => boolean, timeoutMs?: number) => Promise<WsEvent> } {
  const events: WsEvent[] = []
  ws.on('message', (data) => {
    try {
      events.push(JSON.parse(data.toString('utf8')) as WsEvent)
    } catch {
      // ignore non-json
    }
  })
  return {
    events,
    waitFor: (pred, timeoutMs = 8000) =>
      new Promise<WsEvent>((resolve, reject) => {
        const started = Date.now()
        const check = (): void => {
          const found = events.find(pred)
          if (found) {
            resolve(found)
            return
          }
          if (Date.now() - started > timeoutMs) {
            reject(new Error(`waitFor timeout; got ${JSON.stringify(events)}`))
            return
          }
          setTimeout(check, 20)
        }
        void check()
      }),
  }
}

describe('conversation stream (browser WS ⇄ coordinator ⇄ upstream moss WS)', () => {
  let pool: Pool
  let principal: Principal
  let cookie1 = ''
  let cookie2 = ''
  let app: Express
  let browserServer: Server
  let browserPort = 0
  let upstreamServer: Server
  let upstreamPort = 0
  let coordinator: ConversationCoordinator

  /** upstream 行为：auto=收到消息立即回完整 turn；hold=保持 running */
  let upstreamMode: 'auto' | 'hold' = 'auto'
  const upstreamReceived: WsEvent[] = []
  const upstreamAuthHeaders: string[] = []

  function browserWs(cookie: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${browserPort}/ws/conversations/${SID}`, {
        headers: { cookie, origin: 'http://localhost:5273' },
      })
      ws.once('open', () => resolve(ws))
      ws.once('error', reject)
    })
  }

  beforeAll(async () => {
    pool = await createTestDatabase()
    principal = await upsertPrincipal(pool, { mossUserId: 'moss-a', orgId: 'org-1', username: 'user_a' })

    const mkCookie = async (): Promise<string> => {
      const token = generateSessionToken()
      await createWebSession(pool, {
        principalId: principal.id,
        tokenDigest: digestToken(token, HMAC_KEY),
        encrypted: encryptToken(
          JSON.stringify({ accessToken: 'at-stream', refreshToken: 'rt', expiresAt: Date.now() + 3600_000 }),
          AES_KEY,
        ),
        accessExpiresAt: new Date(Date.now() + 3600_000),
        expiresAt: new Date(Date.now() + 86400_000),
      })
      return `sudowork_session=${token}`
    }
    cookie1 = await mkCookie()
    cookie2 = await mkCookie()

    // ---- fake upstream moss WS ----
    const upstreamWss = new WebSocketServer({ noServer: true })
    upstreamServer = createServer()
    upstreamServer.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://upstream.invalid')
      if (!/^\/ws\/sessions\/[^/]+$/.test(url.pathname)) {
        socket.destroy()
        return
      }
      upstreamAuthHeaders.push(String(req.headers.authorization ?? ''))
      upstreamWss.handleUpgrade(req, socket, head, (ws) => {
        ws.on('message', (data) => {
          upstreamReceived.push(JSON.parse(data.toString('utf8')) as WsEvent)
          if (upstreamMode === 'auto') {
            ws.send(JSON.stringify({ type: 'hello', session_id: SID, runtimeType: 'host' }))
            ws.send(
              JSON.stringify({
                type: 'assistant',
                message: { role: 'assistant', content: [{ type: 'text', text: '你好' }] },
                uuid: 'turn-1',
                delta: true,
              }),
            )
            ws.send(
              JSON.stringify({ type: 'result', session_id: SID, status: 'success', usage: { input_tokens: 1 } }),
            )
          }
        })
      })
    })
    upstreamPort = await listen(upstreamServer)

    // ---- WebUI app ----
    const testConfig: AppConfig = {
      server: { host: '127.0.0.1', port: 0 },
      publicOrigin: 'http://localhost:5273',
      trustProxy: false,
      moss: { baseUrl: 'http://moss.test', wsBaseUrl: `ws://127.0.0.1:${upstreamPort}` },
      session: { ttlSeconds: 3600 },
      upload: { maxFileBytes: 1024, maxFilesPerRequest: 1, maxTotalBytes: 1024 },
      isProduction: false,
      databaseUrl: 'unused',
      sessionHmacKey: HMAC_KEY,
      tokenAesKey: AES_KEY,
      cookieSecure: false,
    }

    const fakeAuth: MossAuthPort = {
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
    const fakeSessionPort: MossSessionPort = {
      async list() {
        return []
      },
      async get(_tk, id) {
        return { sessionId: id, userId: 'moss-a', orgId: 'org-1', status: 'active' }
      },
      async create(_input) {
        return { sessionId: 'new', wsUrl: '' }
      },
      async context() {
        return { context: { messages: [] } }
      },
      async resume(_tk, id) {
        return {
          session: { sessionId: id, userId: 'moss-a', orgId: 'org-1', status: 'active' },
          wsUrl: `ws://127.0.0.1:${upstreamPort}/ws/sessions/${id}`,
        }
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

    app = createApp({ publicOrigin: testConfig.publicOrigin })
    const auth = { pool, config: testConfig, mossAuth: fakeAuth }
    coordinator = new ConversationCoordinator({ pool, config: testConfig, auth, moss: fakeSessionPort })
    registerApiRoutes(app, {
      config: testConfig,
      pool,
      mossAuth: fakeAuth,
      mossSession: fakeSessionPort,
      coordinator,
    })

    browserServer = createServer(app)
    attachConversationWebSocket(browserServer, { config: testConfig, pool, coordinator })
    browserPort = await listen(browserServer)
  })

  afterAll(async () => {
    browserServer?.close()
    upstreamServer?.close()
    await destroyTestDatabase(pool)
  })

  test(
    'writer streams a full turn; observer receives output but cannot write',
    async () => {
      const ws1 = await browserWs(cookie1)
      const ws2 = await browserWs(cookie2)
      const c1 = collector(ws1)
      const c2 = collector(ws2)

      ws1.send(JSON.stringify({ kind: 'send', text: 'ping', images: [] }))

      await c1.waitFor((e) => e.kind === 'lock' && e.state === 'running')
      await c1.waitFor((e) => e.kind === 'writer' && e.isWriter === true)
      await c1.waitFor((e) => e.kind === 'upstream' && (e.event as { type?: string })?.type === 'hello')
      await c1.waitFor((e) => e.kind === 'upstream' && (e.event as { type?: string })?.type === 'assistant')
      await c1.waitFor((e) => e.kind === 'upstream' && (e.event as { type?: string })?.type === 'result')
      await c1.waitFor((e) => e.kind === 'lock' && e.state === 'idle')

      // observer 看到输出与 writer:false
      await c2.waitFor((e) => e.kind === 'upstream' && (e.event as { type?: string })?.type === 'assistant')
      await c2.waitFor((e) => e.kind === 'writer' && e.isWriter === false)

      // observer 尝试写 → BUSY（idle 期间 writer 保留）
      ws2.send(JSON.stringify({ kind: 'send', text: 'hack', images: [] }))
      await c2.waitFor((e) => e.kind === 'error' && e.code === 'CONVERSATION_BUSY')

      // upstream 收到转换后的 Moss user 消息，且带 writer 的 Bearer
      expect(upstreamReceived.at(-1)).toMatchObject({ type: 'user' })
      expect(upstreamAuthHeaders.at(-1)).toBe('Bearer at-stream')

      ws1.close()
      ws2.close()
      await sleep(150)
    },
    20_000,
  )

  test(
    'writer disconnect during running marks uncertain and blocks other writers',
    async () => {
      upstreamMode = 'hold'
      const ws1 = await browserWs(cookie1)
      const ws2 = await browserWs(cookie2)
      const c1 = collector(ws1)
      const c2 = collector(ws2)

      ws1.send(JSON.stringify({ kind: 'send', text: 'long task', images: [] }))
      await c1.waitFor((e) => e.kind === 'lock' && e.state === 'running')
      await c1.waitFor((e) => e.kind === 'writer' && e.isWriter === true)
      await c2.waitFor((e) => e.kind === 'lock' && e.state === 'running')

      // writer 断线 → uncertain 广播给 observer
      ws1.close()
      await c2.waitFor((e) => e.kind === 'lock' && e.state === 'uncertain')

      // observer 在 uncertain 下写入被拒
      ws2.send(JSON.stringify({ kind: 'send', text: 'try again', images: [] }))
      await c2.waitFor((e) => e.kind === 'error' && e.code === 'LOCK_UNCERTAIN')

      ws2.close()
      upstreamMode = 'auto'
      await sleep(150)
    },
    20_000,
  )

  test(
    'REST terminate notifies subscribers and clears the lock',
    async () => {
      const ws = await browserWs(cookie1)
      const c = collector(ws)
      await c.waitFor((e) => e.kind === 'lock')

      const res = await request(app)
        .post(`/api/conversations/${SID}/terminate`)
        .set('Cookie', cookie1)
        .set('Origin', 'http://localhost:5273')
      expect(res.status).toBe(200)

      await c.waitFor((e) => e.kind === 'error' && e.code === 'SESSION_TERMINATED')
      ws.close()
      await sleep(100)
    },
    15_000,
  )

  test('WS upgrade rejects bad origin and missing cookie', async () => {
    await expect(
      new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${browserPort}/ws/conversations/${SID}`, {
          headers: { cookie: cookie1, origin: 'https://evil.example' },
        })
        ws.once('open', () => resolve(ws))
        ws.once('error', (err) => reject(err))
      }),
    ).rejects.toThrow()

    await expect(
      new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${browserPort}/ws/conversations/${SID}`, {
          headers: { origin: 'http://localhost:5273' },
        })
        ws.once('open', () => resolve(ws))
        ws.once('error', (err) => reject(err))
      }),
    ).rejects.toThrow()
  })
})
