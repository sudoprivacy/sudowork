import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { Pool } from 'pg'
import { WebSocket, WebSocketServer } from 'ws'
import { attachConversationWebSocket, createApp, registerApiRoutes } from '@server/app'
import type { AppConfig } from '@server/config'
import type { MossAuthPort } from '@sudowork/moss-client'
import type { MossSessionPort } from '@sudowork/moss-client'
import { MossHttpError } from '@sudowork/moss-client'
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

    const mkCookie = async (accessToken: string): Promise<string> => {
      const token = generateSessionToken()
      await createWebSession(pool, {
        principalId: principal.id,
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
    cookie1 = await mkCookie('at-stream')
    cookie2 = await mkCookie('at-stream-2')

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
      async setUserModel() {},
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
      async sessionSkillsAvailable(): Promise<unknown> {
          return { skills: [] }
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
    'writer streams a full turn; observer receives output and takes over writer on idle',
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

      // observer 在 idle 期发送 → 抢占成为新 writer（idle 乐观可写，先发先得）
      ws2.send(JSON.stringify({ kind: 'send', text: 'hack', images: [] }))
      await c2.waitFor((e) => e.kind === 'lock' && e.state === 'running')
      await c2.waitFor((e) => e.kind === 'writer' && e.isWriter === true)
      // 旧 writer 被切为观察者
      await c1.waitFor((e) => e.kind === 'writer' && e.isWriter === false)

      // upstream 收到抢占者的消息，且以新 writer 的 Bearer 重建连接
      // （waitFor 的事件在 broadcastLockState 同步发出，而抢占接管需 resume+握手后
      // 才 send——轮询等待 'hack' 真正到达 upstream 再断言）
      const hackArrived = async (): Promise<boolean> => {
        const received = upstreamReceived.some(
          (m) =>
            (m as { message?: { content?: { text?: string }[] } })?.message?.content?.some(
              (c) => c?.text === 'hack',
            ),
        )
        if (received) return true
        await sleep(50)
        return false
      }
      for (let i = 0; i < 100 && !(await hackArrived()); i++) {
        // 轮询
      }
      expect(upstreamReceived.at(-1)).toMatchObject({
        type: 'user',
        message: { content: [{ type: 'text', text: 'hack' }] },
      })
      expect(upstreamAuthHeaders.at(-1)).toBe('Bearer at-stream-2')

      ws1.close()
      ws2.close()
      await sleep(150)
    },
    20_000,
  )

  test(
    'stop (writer) forwards interrupt control_request to upstream; non-writer rejected',
    async () => {
      // 前置：清掉历史运行可能残留的 uncertain/running 锁，保证起点 idle
      await request(app)
        .post(`/api/conversations/${SID}/terminate`)
        .set('Cookie', cookie1)
        .set('Origin', 'http://localhost:5273')
      await sleep(150)

      upstreamMode = 'hold'
      const ws1 = await browserWs(cookie1)
      const ws2 = await browserWs(cookie2)
      const c1 = collector(ws1)
      const c2 = collector(ws2)
      try {
        await c1.waitFor((e) => e.kind === 'lock')
        // ws1 成为 writer 并 running
        ws1.send(JSON.stringify({ kind: 'send', text: 'long task', images: [] }))
        await c1.waitFor((e) => e.kind === 'lock' && e.state === 'running')
        await c2.waitFor((e) => e.kind === 'lock' && e.state === 'running')

        // 非 writer 发 stop → NOT_WRITER
        ws2.send(JSON.stringify({ kind: 'stop' }))
        await c2.waitFor((e) => e.kind === 'error' && e.code === 'NOT_WRITER')

        // writer 发 stop → 上游收到 interrupt control_request（request_id 存在且唯一）
        const before = upstreamReceived.length
        ws1.send(JSON.stringify({ kind: 'stop' }))
        await sleep(300)
        const interruptFrames = upstreamReceived
          .slice(before)
          .filter((e) => (e as { type?: string }).type === 'control_request')
        expect(interruptFrames.length).toBe(1)
        const frame = interruptFrames[0] as {
          type: string
          request_id: string
          request: { subtype: string }
        }
        expect(frame.request_id).toBeTruthy()
        expect(frame.request).toEqual({ subtype: 'interrupt' })
      } finally {
        ws1.close()
        ws2.close()
        upstreamMode = 'auto'
        // 结束后清锁，避免 running 断线给后续用例留下 uncertain 残留
        await request(app)
          .post(`/api/conversations/${SID}/terminate`)
          .set('Cookie', cookie1)
          .set('Origin', 'http://localhost:5273')
        await sleep(150)
      }
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
