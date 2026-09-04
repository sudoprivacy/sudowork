import type { NextFunction, Request, Response } from 'express'
import helmet from 'helmet'

/**
 * 请求安全最小集（计划 3.5）：
 * - Helmet 安全响应头
 * - 所有状态变更请求校验同源 Origin / Sec-Fetch-Site
 * - 已认证响应 Cache-Control: no-store
 */

const CSP_IMAGE_ORIGINS_ENV = 'CSP_IMG_SRC_ORIGINS'
const INVALID_CSP_HOST_CHARS = /[*;]/

function containsInvalidCspSourceChar(value: string): boolean {
  return [...value].some((char) => {
    const codePoint = char.codePointAt(0) ?? 0
    return /\s/u.test(char) || codePoint <= 0x1f || codePoint === 0x7f
  })
}

export function parseCspImageOrigins(
  raw: string | undefined,
  warn: (message: string) => void = console.warn,
): string[] {
  if (!raw?.trim()) return []

  const origins = new Set<string>()
  raw.split(',').forEach((value, index) => {
    const candidate = value.trim()
    if (!candidate) return

    let reason: string | undefined
    let parsed: URL | undefined
    if (containsInvalidCspSourceChar(candidate)) {
      reason = 'contains whitespace or control characters'
    } else {
      try {
        parsed = new URL(candidate)
      } catch {
        reason = 'is not a valid URL'
      }
    }

    if (parsed) {
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        reason = 'must use http or https'
      } else if (parsed.username || parsed.password) {
        reason = 'must not include credentials'
      } else if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
        reason = 'must be an origin without path, query, or hash'
      } else if (parsed.origin === 'null' || INVALID_CSP_HOST_CHARS.test(parsed.hostname)) {
        reason = 'contains an invalid hostname'
      }
    }

    if (reason || !parsed) {
      warn(`${CSP_IMAGE_ORIGINS_ENV} entry ${index + 1} ignored: ${reason ?? 'invalid origin'}`)
      return
    }
    origins.add(parsed.origin)
  })
  return [...origins]
}

export function createSecurityHeaders(
  rawImageOrigins: string | undefined,
  warn: (message: string) => void = console.warn,
) {
  const imageOrigins = parseCspImageOrigins(rawImageOrigins, warn)
  return helmet({
    contentSecurityPolicy: {
      directives: {
        imgSrc: ["'self'", 'data:', ...imageOrigins],
      },
    },
  })
}

export const securityHeaders = createSecurityHeaders(process.env.CSP_IMG_SRC_ORIGINS)

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
      if (isOriginAllowed(origin, publicOrigin)) {
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

/** 回环主机名集合：localhost / 127.0.0.1 / [::1]（含 URL 解析后的 ::1 写法）互视为同源基础。 */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * Origin 放行判定：protocol 与 port 严格相等，且 hostname 相等或双方均为回环地址
 * （浏览器无法伪造跨站请求的 Origin 头，回环等价仅影响本机不同回环写法的访问，
 * 如 127.0.0.1 ↔ localhost，端口不一致仍拒绝）。畸形 Origin（URL 解析失败）一律拒绝。
 */
export function isOriginAllowed(origin: string, publicOrigin: string): boolean {
  let originUrl: URL
  let publicUrl: URL
  try {
    originUrl = new URL(origin)
    publicUrl = new URL(publicOrigin)
  } catch {
    return false
  }
  if (originUrl.protocol !== publicUrl.protocol || originUrl.port !== publicUrl.port) {
    return false
  }
  if (originUrl.hostname === publicUrl.hostname) {
    return true
  }
  return (
    LOOPBACK_HOSTNAMES.has(originUrl.hostname) && LOOPBACK_HOSTNAMES.has(publicUrl.hostname)
  )
}

export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store')
  next()
}
