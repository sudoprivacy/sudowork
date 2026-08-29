import express, { type Express } from 'express'
import type { Server } from 'node:http'
import type { Pool } from 'pg'
import { WebSocketServer } from 'ws'
import type { AppConfig } from './config.js'
import type { MossAuthPort } from './moss/MossAuthClient.js'
import { createMossSessionPort, type MossSessionPort } from './moss/MossSessionClient.js'
import { type MossFetch, mossRequest } from './moss/MossHttpClient.js'
import { createOriginGuard, noStore, securityHeaders } from './security/requestSecurity.js'
import { createAuthRouter } from './features/auth/authRoutes.js'
import {
  createSessionMiddleware,
  findSessionByCookie,
  requireSession,
  SESSION_COOKIE_NAME,
  type AuthedRequest,
} from './features/auth/sessionMiddleware.js'
import { ConversationCoordinator } from './features/conversations/ConversationCoordinator.js'
import { createConversationRouter } from './features/conversations/conversationRoutes.js'
import { createMossAgentPort, type MossAgentPort } from './moss/MossAgentClient.js'
import { createMossSkillPort, type MossSkillPort } from './moss/MossSkillClient.js'
import { createMossCronPort } from './moss/MossCronClient.js'
import { createAgentRouter } from './features/agents/agentRoutes.js'
import { createSkillRouter } from './features/skills/skillRoutes.js'
import { createCronRouter } from './features/cron/cronRoutes.js'

/**
 * Express 应用工厂（计划 3.6 注册顺序）：
 *   1. /health 存活探针（最先注册，不吞 API/WS）
 *   2. 安全中间件（Helmet / no-store / Origin+Fetch-Metadata）
 *   3. JSON body 解析
 *   4. /api 路由（session middleware + 各 feature router）
 *   5. WebSocket /ws upgrade（attachConversationWebSocket）
 *   6. express.static(dist/client) 与 SPA fallback（Task 9 生产模式）
 */

export interface AppDeps {
  publicOrigin: string
}

export function createApp(deps: AppDeps): Express {
  const app = express()

  app.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' })
  })

  app.use(securityHeaders)
  app.use(noStore)
  app.use(createOriginGuard(deps.publicOrigin))
  app.use(express.json({ limit: '1mb' }))

  return app
}

export interface ApiDeps {
  config: AppConfig
  pool: Pool
  mossAuth: MossAuthPort
  /** 测试注入桩；缺省用真实 mossRequest */
  mossFetch?: MossFetch
  /** 测试注入桩；缺省用真实 MossSessionPort */
  mossSession?: MossSessionPort
  /** 测试注入桩 */
  coordinator?: ConversationCoordinator
  /** 测试注入桩 */
  agents?: MossAgentPort
  /** 测试注入桩 */
  skills?: MossSkillPort
  /** 测试注入桩 */
  cron?: import('./moss/MossCronClient.js').MossCronPort
  /** 测试注入桩 */
  fetchVisibleAgentNames?: (accessToken: string) => Promise<Set<string>>
}

export interface ApiHandles {
  coordinator: ConversationCoordinator
  mossSession: MossSessionPort
}

/** 挂载 /api 路由（登录后全部走 session middleware，计划 3.2）。 */
export function registerApiRoutes(app: Express, deps: ApiDeps): ApiHandles {
  const { config, pool } = deps

  app.use('/api', createSessionMiddleware(pool, config.sessionHmacKey))
  app.use('/api/auth', createAuthRouter({ pool, config, mossAuth: deps.mossAuth }))

  const mossFetch = deps.mossFetch ?? mossRequest
  const auth = { pool, config, mossAuth: deps.mossAuth }
  const mossSession = deps.mossSession ?? createMossSessionPort(mossFetch, config.moss.baseUrl)
  const coordinator =
    deps.coordinator ?? new ConversationCoordinator({ pool, config, auth, moss: mossSession })
  const agents = deps.agents ?? createMossAgentPort(mossFetch, config.moss.baseUrl)
  const skills = deps.skills ?? createMossSkillPort(mossFetch, config.moss.baseUrl)

  app.use(
    '/api/conversations',
    createConversationRouter({ pool, config, auth, moss: mossSession, mossFetch, coordinator }),
  )
  app.use('/api/agents', createAgentRouter({ pool, config, auth, agents }))
  app.use('/api/skills', createSkillRouter({ pool, config, auth, skills }))

  const fetchVisibleAgentNames =
    deps.fetchVisibleAgentNames ??
    (async (accessToken: string): Promise<Set<string>> => {
      const list = (await mossFetch(config.moss.baseUrl, {
        method: 'GET',
        path: '/api/v1/agents/installed',
        accessToken,
      })) as { name?: string }[]
      const names = new Set<string>()
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item && typeof item.name === 'string') names.add(item.name)
        }
      }
      return names
    })
  app.use(
    '/api/cron',
    createCronRouter({
      pool,
      config,
      auth,
      cron: deps.cron ?? createMossCronPort(mossFetch, config.moss.baseUrl),
      sessions: mossSession,
      fetchVisibleAgentNames,
    }),
  )

  return { coordinator, mossSession }
}

export interface WsDeps {
  config: AppConfig
  pool: Pool
  coordinator: ConversationCoordinator
}

/** 浏览器 WS：/ws/conversations/:mossSessionId（Cookie 认证，计划 3.5 upgrade 校验）。 */
export function attachConversationWebSocket(server: Server, deps: WsDeps): void {
  const wss = new WebSocketServer({ noServer: true })
  const { config, pool, coordinator } = deps

  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://internal.invalid')
      const match = url.pathname.match(/^\/ws\/conversations\/([^/]+)$/)
      if (!match) {
        socket.destroy()
        return
      }

      const origin = req.headers.origin
      if (origin !== config.publicOrigin) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }

      const webSession = await findSessionByCookie(pool, req.headers.cookie, config.sessionHmacKey)
      if (!webSession) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        const conn = {
          ws,
          webSession,
          principalId: webSession.principalId,
          mossSessionId: decodeURIComponent(match[1] ?? ''),
        }
        coordinator.subscribe(conn)
        ws.on('message', (data) => {
          let parsed: unknown
          try {
            parsed = JSON.parse(data.toString('utf8'))
          } catch {
            return
          }
          void coordinator.handleClientMessage(conn, parsed)
        })
        ws.on('close', () => void coordinator.unsubscribe(conn))
        ws.on('error', () => void coordinator.unsubscribe(conn))
      })
    })().catch(() => {
      socket.destroy()
    })
  })
}

export { requireSession, SESSION_COOKIE_NAME, type AuthedRequest }
