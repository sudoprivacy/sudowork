import { Router, type Response, type NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import { ZodError } from 'zod'
import type { AppConfig } from '../../config.js'
import { LoginApiKeyRequestSchema, LoginPasswordRequestSchema } from '../../../shared/contracts/auth.js'
import {
  InvalidCredentialsError,
  MossUnavailableError,
  loginWithApiKey,
  loginWithPassword,
  logout,
  resolveSession,
  type AuthDeps,
} from './authService.js'
import {
  SESSION_COOKIE_NAME,
  requireSession,
  type AuthedRequest,
} from './sessionMiddleware.js'

/**
 * 认证路由（计划 3.7 固定接口）：
 *   GET  /api/auth/session
 *   POST /api/auth/login/password
 *   POST /api/auth/login/api-key
 *   POST /api/auth/logout
 * 错误不区分用户不存在/密码错误（计划 Task 3）。
 */

function setSessionCookie(res: Response, config: AppConfig, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: config.session.ttlSeconds * 1000,
  })
}

function authErrorHandler(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'INVALID_REQUEST' })
    return
  }
  if (err instanceof InvalidCredentialsError) {
    res.status(401).json({ error: 'INVALID_CREDENTIALS' })
    return
  }
  if (err instanceof MossUnavailableError) {
    res.status(503).json({ error: 'MOSS_UNAVAILABLE' })
    return
  }
  next(err)
}

export function createAuthRouter(deps: AuthDeps): Router {
  const router = Router()

  // 登录限流：进程内存存储（单实例约束，计划 2.1 说明）
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
  })

  router.post('/login/password', loginLimiter, (req, res, next) => {
    void (async () => {
      const input = LoginPasswordRequestSchema.parse(req.body)
      const result = await loginWithPassword(deps, input)
      setSessionCookie(res, deps.config, result.cookieToken)
      res.status(200).json({ ok: true })
    })().catch((err: unknown) => authErrorHandler(err, res, next))
  })

  router.post('/login/api-key', loginLimiter, (req, res, next) => {
    void (async () => {
      const input = LoginApiKeyRequestSchema.parse(req.body)
      const result = await loginWithApiKey(deps, input.apiKey)
      setSessionCookie(res, deps.config, result.cookieToken)
      res.status(200).json({ ok: true })
    })().catch((err: unknown) => authErrorHandler(err, res, next))
  })

  router.post('/logout', requireSession, (req, res, next) => {
    void (async () => {
      const webSession = (req as AuthedRequest).webSession!
      await logout(deps, webSession.id)
      res.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
      res.status(200).json({ ok: true })
    })().catch((err: unknown) => authErrorHandler(err, res, next))
  })

  router.get('/session', requireSession, (req, res, next) => {
    void (async () => {
      const authed = req as AuthedRequest
      const token = authed.webSessionToken
      if (!token) {
        res.status(401).json({ error: 'SESSION_REQUIRED' })
        return
      }
      const resolved = await resolveSession(deps, token)
      if (!resolved) {
        res.status(401).json({ error: 'SESSION_REQUIRED' })
        return
      }
      res.status(200).json({
        user: {
          id: resolved.me.user.id,
          name: resolved.me.user.name,
        },
        organization: resolved.me.organization
          ? { id: resolved.me.organization.id, name: resolved.me.organization.name }
          : null,
        role: resolved.me.role,
        scopes: resolved.me.scopes,
      })
    })().catch((err: unknown) => authErrorHandler(err, res, next))
  })

  return router
}
