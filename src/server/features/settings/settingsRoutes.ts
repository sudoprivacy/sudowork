import { Router, type NextFunction, type Response } from 'express'
import { z, ZodError } from 'zod'
import type { Pool } from 'pg'
import type { AppConfig } from '../../config.js'
import type { AuthDeps } from '../auth/authService.js'
import { getAccessToken } from '../auth/authService.js'
import { requireSession, type AuthedRequest } from '../auth/sessionMiddleware.js'
import type { MossMcpPort } from '../../moss/MossMcpClient.js'
import { MossHttpError, MossNetworkError } from '../../moss/MossHttpClient.js'

/**
 * 设置路由（计划 Task 8）：
 * - 用户中心：GET /api/settings/profile（Moss user/profile 白名单投影）
 * - 显示：GET/PUT /api/settings/display（user_preferences 表，多用户隔离）
 * - 关于：GET /api/settings/about（tenant branding + WebUI build 元数据）
 */

export class MossUnavailableError extends Error {}
export class ForbiddenError extends Error {}

export interface SettingsDeps {
  pool: Pool
  config: AppConfig
  auth: AuthDeps
  mcp: MossMcpPort
}

const DisplaySchema = z
  .object({
    theme: z.enum(['system', 'light', 'dark']),
    fontScale: z.number().min(0.75).max(1.5),
  })
  .strict()

export function createSettingsRouter(deps: SettingsDeps): Router {
  const router = Router()

  function handle(err: unknown, res: Response, next: NextFunction): void {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'INVALID_REQUEST' })
      return
    }
    if (err instanceof MossUnavailableError) {
      res.status(503).json({ error: 'MOSS_UNAVAILABLE' })
      return
    }
    if (err instanceof MossHttpError) {
      res.status(502).json({ error: 'MOSS_ERROR', status: err.status })
      return
    }
    next(err)
  }

  function wrap(
    fn: (req: AuthedRequest) => Promise<unknown>,
  ): (req: AuthedRequest, res: Response, next: NextFunction) => void {
    return (req, res, next) => {
      void fn(req)
        .then((result) => res.status(200).json(result))
        .catch((err: unknown) => handle(err, res, next))
    }
  }

  /** 用户中心：身份/部门/角色/累计 token/Session 数（Moss user/profile 投影，不伪造）。 */
  router.get(
    '/profile',
    requireSession,
    wrap(async (req) => {
      const tk = await getAccessToken(deps.auth, req.webSession!)
      try {
        return await deps.mcp.userProfile(tk)
      } catch (err) {
        if (err instanceof MossNetworkError) throw new MossUnavailableError()
        throw err
      }
    }),
  )

  router.get(
    '/display',
    requireSession,
    wrap(async (req) => {
      const { rows } = await deps.pool.query(
        `SELECT theme, font_scale::float8 AS "fontScale" FROM user_preferences WHERE principal_id = $1`,
        [req.webSession!.principalId],
      )
      if (rows[0]) return rows[0]
      return { theme: 'system', fontScale: 1.0 }
    }),
  )

  router.put(
    '/display',
    requireSession,
    wrap(async (req) => {
      const body = DisplaySchema.parse(req.body)
      await deps.pool.query(
        `INSERT INTO user_preferences (principal_id, theme, font_scale, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (principal_id) DO UPDATE SET theme = $2, font_scale = $3, updated_at = now()`,
        [req.webSession!.principalId, body.theme, body.fontScale],
      )
      return { ok: true }
    }),
  )

  /** 关于：tenant branding（tenant/config 投影）+ WebUI build 元数据。 */
  router.get(
    '/about',
    requireSession,
    wrap(async (req) => {
      const tk = await getAccessToken(deps.auth, req.webSession!)
      let branding: Record<string, unknown>
      try {
        const config = (await deps.mcp.tenantConfig(tk)) as Record<string, unknown>
        branding = {
          appName: config?.app_name ?? config?.appName,
          logo: config?.logo,
        }
      } catch {
        branding = {}
      }
      return {
        branding,
        webui: {
          name: 'sudowork-webui',
          version: process.env.WEBUI_VERSION ?? '0.1.0',
          node: process.version,
        },
        mossBaseUrl: deps.config.moss.baseUrl,
      }
    }),
  )

  return router
}
