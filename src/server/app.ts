import express, { type Express } from 'express'
import { createOriginGuard, noStore, securityHeaders } from './security/requestSecurity.js'

/**
 * Express 应用工厂（计划 3.6 注册顺序）：
 *   1. /health 存活探针（最先注册，不吞 API/WS）
 *   2. 安全中间件（Helmet / no-store / Origin+Fetch-Metadata）
 *   3. JSON body 解析（后续 /api 路由）
 *   4. /api 路由（Task 3+ 注册）
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

  // /api 路由在 Task 3 起注册

  return app
}
