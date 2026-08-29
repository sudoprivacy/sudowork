import express, { type Express } from 'express'
import type { Pool } from 'pg'
import type { AppConfig } from './config.js'
import type { MossAuthPort } from './moss/MossAuthClient.js'
import { createOriginGuard, noStore, securityHeaders } from './security/requestSecurity.js'
import { createAuthRouter } from './features/auth/authRoutes.js'
import { createSessionMiddleware } from './features/auth/sessionMiddleware.js'

/**
 * Express 应用工厂（计划 3.6 注册顺序）：
 *   1. /health 存活探针（最先注册，不吞 API/WS）
 *   2. 安全中间件（Helmet / no-store / Origin+Fetch-Metadata）
 *   3. JSON body 解析
 *   4. /api 路由（session middleware + 各 feature router）
 *   5. WebSocket /ws upgrade（Task 5 注册于 server 级）
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
}

/** 挂载 /api 路由（登录后全部走 session middleware，计划 3.2）。 */
export function registerApiRoutes(app: Express, deps: ApiDeps): void {
  app.use('/api', createSessionMiddleware(deps.pool, deps.config.sessionHmacKey))
  app.use(
    '/api/auth',
    createAuthRouter({ pool: deps.pool, config: deps.config, mossAuth: deps.mossAuth }),
  )
}
