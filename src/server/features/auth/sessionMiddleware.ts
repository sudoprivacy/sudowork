import type { NextFunction, Request, Response } from 'express'
import type { Pool } from 'pg'
import { digestToken } from '../../security/sessionToken.js'
import type { WebSessionRow } from './sessionRepository.js'
import { findActiveSessionByDigest, touchSession } from './sessionRepository.js'

/**
 * HttpOnly Session middleware（计划 3.2 固定流程）：
 *   Cookie → web_sessions → principal → 当前 Session 的 Moss token
 * 校验失败/无 Cookie 时静默放行（路由层决定 401）。
 */

export const SESSION_COOKIE_NAME = 'sudowork_session'

export interface AuthedRequest extends Request {
  webSession?: WebSessionRow
  /** 原始 cookie token（摘要不可逆，路由需要原文调 resolveSession 时使用） */
  webSessionToken?: string
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const name = part.slice(0, idx).trim()
    const raw = part.slice(idx + 1).trim()
    if (!name) continue
    try {
      out[name] = decodeURIComponent(raw)
    } catch {
      out[name] = raw
    }
  }
  return out
}

export function createSessionMiddleware(pool: Pool, hmacKey: Buffer) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME]
    if (token) {
      try {
        const session = await findActiveSessionByDigest(pool, digestToken(token, hmacKey))
        if (session) {
          ;(req as AuthedRequest).webSession = session
          ;(req as AuthedRequest).webSessionToken = token
          void touchSession(pool, session.id).catch(() => {})
        }
      } catch {
        // 数据库瞬断时不阻断请求；路由层会按未登录处理
      }
    }
    next()
  }
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (!(req as AuthedRequest).webSession) {
    res.status(401).json({ error: 'SESSION_REQUIRED' })
    return
  }
  next()
}

/** WS upgrade 场景：直接从 Cookie header 解析活跃 Web Session。 */
export async function findSessionByCookie(
  pool: Pool,
  cookieHeader: string | undefined,
  hmacKey: Buffer,
): Promise<WebSessionRow | null> {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE_NAME]
  if (!token) return null
  try {
    return await findActiveSessionByDigest(pool, digestToken(token, hmacKey))
  } catch {
    return null
  }
}
