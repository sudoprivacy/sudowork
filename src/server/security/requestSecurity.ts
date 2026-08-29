import type { NextFunction, Request, Response } from 'express'
import helmet from 'helmet'

/**
 * 请求安全最小集（计划 3.5）：
 * - Helmet 安全响应头
 * - 所有状态变更请求校验同源 Origin / Sec-Fetch-Site
 * - 已认证响应 Cache-Control: no-store
 */

export const securityHeaders = helmet()

/** 状态变更请求的跨站防护：Origin 精确匹配，或 Fetch-Metadata 判定同源。 */
export function createOriginGuard(publicOrigin: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const method = req.method.toUpperCase()
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      next()
      return
    }

    const origin = req.headers.origin
    if (typeof origin === 'string') {
      if (origin === publicOrigin) {
        next()
        return
      }
      res.status(403).json({ error: 'ORIGIN_REJECTED' })
      return
    }

    const site = req.headers['sec-fetch-site']
    if (
      typeof site === 'string' &&
      (site === 'same-origin' || site === 'same-site' || site === 'none')
    ) {
      next()
      return
    }

    res.status(403).json({ error: 'ORIGIN_REJECTED' })
  }
}

export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store')
  next()
}
