import express, { type Express } from 'express'
import type { Server } from 'node:http'
import { join } from 'node:path'
import type { Pool } from 'pg'
import { WebSocketServer } from 'ws'
import type { AppConfig } from './config.js'
import type { MossAuthPort } from '@sudowork/moss-client'
import { createMossSessionPort, type MossSessionPort } from '@sudowork/moss-client'
import { type MossFetch, MossHttpError, MossNetworkError, mossFetchAsset, mossRequest } from '@sudowork/moss-client'
import { createOriginGuard, isOriginAllowed, noStore, securityHeaders } from './security/requestSecurity.js'
import { createAuthRouter } from './features/auth/authRoutes.js'
import { MossUnauthorizedError } from './features/auth/authService.js'
import {
  createSessionMiddleware,
  findSessionByCookie,
  requireSession,
  SESSION_COOKIE_NAME,
  type AuthedRequest,
} from './features/auth/sessionMiddleware.js'
import { ConversationCoordinator } from './features/conversations/ConversationCoordinator.js'
import { createConversationRouter } from './features/conversations/conversationRoutes.js'
import { createMossAgentPort, type MossAgentPort } from '@sudowork/moss-client'
import { createMossSkillPort, type MossSkillPort } from '@sudowork/moss-client'
import { createMossCronPort } from '@sudowork/moss-client'
import { createMossMcpPort, type MossMcpPort } from '@sudowork/moss-client'
import { createAgentRouter } from './features/agents/agentRoutes.js'
import { createSkillRouter } from './features/skills/skillRoutes.js'
import { createCronRouter } from './features/cron/cronRoutes.js'
import { createSettingsRouter } from './features/settings/settingsRoutes.js'
import { createMcpRouter } from './features/mcp/mcpRoutes.js'
import { TerminalManager, TerminalLimitError, type TerminalSession } from './features/terminal/terminalManager.js'

/** 全局共享终端管理器（webui 单进程；DELETE 会话时按会话关闭其全部 pty） */
export const globalTerminalManager = new TerminalManager()

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
  // body 上限按路径分流：工作区文件上传（base64 编码，maxFileBytes 10MB × 4/3 + 余量）放宽到 16mb，
  // 其余维持 1mb。必须在全局挂载点分流——Express 中间件严格按注册顺序，路由级再挂更大的
  // 解析器永远不生效（≤1mb 时 body 已被读、解析器被跳过；>1mb 时在读取阶段即抛 413）。
  const uploadJsonParser = express.json({ limit: '16mb' })
  const defaultJsonParser = express.json({ limit: '1mb' })
  app.use((req, res, next) => {
    if (
      req.method === 'POST' &&
      /^\/api\/conversations\/[^/]+\/workspace\/file$/.test(req.path)
    ) {
      uploadJsonParser(req, res, next)
      return
    }
    defaultJsonParser(req, res, next)
  })

  return app
}

/** 生产模式静态 SPA（计划 3.6）：/health、/api、/ws 之外的非 GET fallback 到 index.html。 */
export function registerStaticSpa(app: Express, distClientDir: string): void {
  app.use(express.static(distClientDir, { index: false, fallthrough: true }))
  app.use((req, _res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      next()
      return
    }
    _res.sendFile(join(distClientDir, 'index.html'))
  })
}

export interface ApiDeps {
  config: AppConfig
  pool: Pool
  mossAuth: MossAuthPort
  /** 测试注入桩；缺省用真实 mossRequest */
  mossFetch?: MossFetch
  /** 测试注入桩；缺省用真实 mossFetchAsset（tenant 头像代理） */
  mossFetchAsset?: typeof mossFetchAsset
  /** 测试注入桩；缺省用真实 MossSessionPort */
  mossSession?: MossSessionPort
  /** 测试注入桩 */
  coordinator?: ConversationCoordinator
  /** 测试注入桩 */
  agents?: MossAgentPort
  /** 测试注入桩 */
  skills?: MossSkillPort
  /** 测试注入桩 */
  cron?: import('@sudowork/moss-client').MossCronPort
  /** 测试注入桩 */
  fetchVisibleAgentNames?: (accessToken: string) => Promise<Set<string>>
  /** 测试注入桩 */
  mcp?: MossMcpPort
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
    createConversationRouter({
      pool,
      config,
      auth,
      moss: mossSession,
      mossFetch,
      mossFetchAsset: deps.mossFetchAsset,
      coordinator,
      closeTerminals: (conversationId) => globalTerminalManager.closeByConversation(conversationId),
    }),
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

  const mcp = deps.mcp ?? createMossMcpPort(mossFetch, config.moss.baseUrl)
  app.use('/api/settings', createSettingsRouter({ pool, config, auth, mcp }))
  app.use('/api/mcp', createMcpRouter({ pool, config, auth, mcp }))

  // 全局错误中间件：兜住各路由 next(err) 的未识别错误，统一返回 JSON（杜绝 Express 默认
  // HTML 错误页——前端对非 {error} JSON 只能显示 UNKNOWN）。必须注册在全部 /api 路由之后。
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) {
      _next(err)
      return
    }
    if (err instanceof MossUnauthorizedError) {
      res.status(401).json({ error: 'MOSS_UNAUTHORIZED' })
      return
    }
    if (err instanceof MossNetworkError) {
      res.status(503).json({ error: 'MOSS_UNAVAILABLE' })
      return
    }
    if (err instanceof MossHttpError) {
      if (err.status === 401 || err.status === 403) {
        res.status(401).json({ error: 'MOSS_UNAUTHORIZED' })
      } else {
        res.status(502).json({ error: 'MOSS_ERROR' })
      }
      return
    }
    // body-parser 超限（raw-body 的 413 entity.too.large）→ 明确的上传超限语义
    if (
      err !== null && typeof err === 'object' &&
      (err as { type?: unknown }).type === 'entity.too.large'
    ) {
      res.status(413).json({ error: 'FILE_TOO_LARGE' })
      return
    }
    res.status(500).json({ error: 'INTERNAL' })
  })

  return { coordinator, mossSession }
}

export interface WsDeps {
  config: AppConfig
  pool: Pool
  coordinator: ConversationCoordinator
  /** 终端管理器（可选注入便于测试；缺省全局共享一个实例） */
  terminals?: TerminalManager
}

/**
 * 浏览器 WS 总挂载（单一 upgrade 处理器内按 pathname 分发）。
 * 注意：Node EventEmitter 会调用同一事件的全部监听器，不可并列注册多个 upgrade 监听器
 * （互不匹配的路径会被彼此 socket.destroy，双向破坏）。
 * - /ws/conversations/:mossSessionId：会话流（Cookie 认证，计划 3.5 upgrade 校验）
 * - /ws/terminal?conversation=<id>：服务器终端（同源同认证）
 */
export function attachConversationWebSocket(server: Server, deps: WsDeps): void {
  const wss = new WebSocketServer({ noServer: true })
  const terminalWss = new WebSocketServer({ noServer: true })
  const { config, pool, coordinator } = deps
  const terminals = deps.terminals ?? globalTerminalManager

  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://internal.invalid')
      const conversationMatch = url.pathname.match(/^\/ws\/conversations\/([^/]+)$/)
      const isTerminal = url.pathname === '/ws/terminal'
      if (!conversationMatch && !isTerminal) {
        socket.destroy()
        return
      }

      const origin = req.headers.origin
      if (typeof origin !== 'string' || !isOriginAllowed(origin, config.publicOrigin)) {
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

      if (conversationMatch) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          const conn = {
            ws,
            webSession,
            principalId: webSession.principalId,
            mossSessionId: decodeURIComponent(conversationMatch[1] ?? ''),
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
        return
      }

      // /ws/terminal?conversation=<id>：每连接一个 pty，断开即销毁（生命周期回收）
      const conversationId = url.searchParams.get('conversation') ?? ''
      if (!/^[\w-]+$/.test(conversationId)) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
        socket.destroy()
        return
      }
      terminalWss.handleUpgrade(req, socket, head, (ws) => {
        let session: TerminalSession | null = null
        const send = (payload: Record<string, unknown>): void => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
        }
        try {
          session = terminals.create(conversationId, (data) => send({ type: 'output', data }), () => {
            send({ type: 'exit' })
            ws.close()
          })
        } catch (err) {
          send({
            type: 'error',
            code: err instanceof TerminalLimitError ? err.reason : 'TERMINAL_FAILED',
          })
          ws.close()
          return
        }
        send({ type: 'ready', terminalId: session.terminalId })
        ws.on('message', (data) => {
          if (!session) return
          let parsed: unknown
          try {
            parsed = JSON.parse(data.toString('utf8'))
          } catch {
            return
          }
          const frame = parsed as { type?: string; data?: string; cols?: number; rows?: number }
          if (frame.type === 'input' && typeof frame.data === 'string') {
            session.write(frame.data)
          } else if (
            frame.type === 'resize' &&
            typeof frame.cols === 'number' && typeof frame.rows === 'number' &&
            Number.isFinite(frame.cols) && Number.isFinite(frame.rows)
          ) {
            session.resize(Math.max(1, Math.floor(frame.cols)), Math.max(1, Math.floor(frame.rows)))
          }
        })
        const dispose = (): void => {
          session?.dispose()
          session = null
        }
        ws.on('close', dispose)
        ws.on('error', dispose)
      })
    })().catch(() => {
      socket.destroy()
    })
  })
}

export { requireSession, SESSION_COOKIE_NAME, type AuthedRequest }
