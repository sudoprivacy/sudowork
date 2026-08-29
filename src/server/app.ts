import express, { type Express } from 'express'

/**
 * Express 应用工厂。
 *
 * 注册顺序遵循计划 3.6：
 *   /health → /api → /ws upgrade（Task 5）→ express.static → SPA fallback
 * Task 1 阶段仅包含 /health 存活探针。
 */
export function createApp(): Express {
  const app = express()

  app.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' })
  })

  return app
}
