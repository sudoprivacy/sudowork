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
 * MCP 路由（计划 3.9 修订版）：
 * - own personal 判定用 scope === 'user'（响应无 owner 字段）
 * - test / PATCH / DELETE / user-config PUT 仅 own personal（fresh 列表核验）
 * - 首版不代理 MCP SSE；mutation 后前端 refetch + 30s polling
 */

export class MossUnavailableError extends Error {}
export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}

export interface McpDeps {
  pool: Pool
  config: AppConfig
  auth: AuthDeps
  mcp: MossMcpPort
}

async function mapErr<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err: unknown) => {
    if (err instanceof MossNetworkError) throw new MossUnavailableError()
    if (err instanceof MossHttpError && err.status === 404) throw new NotFoundError()
    if (err instanceof MossHttpError && (err.status === 401 || err.status === 403)) {
      throw new ForbiddenError()
    }
    throw err
  })
}

/** 从 fresh 列表找 server 行；返回其 scope（own personal 判定依据）。 */
async function findServerRow(
  deps: McpDeps,
  accessToken: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const list = (await mapErr(() => deps.mcp.servers(accessToken))) as Record<string, unknown>[]
  if (!Array.isArray(list)) return null
  return list.find((row) => row && row.id === id) ?? null
}

const InstallTemplateSchema = z
  .object({
    config_values: z.record(z.string(), z.string()).optional(),
    auth_credentials: z.record(z.string(), z.string()).optional(),
    display_name: z.string().trim().min(1).max(255).optional(),
  })
  .strip()

const InstallJsonSchema = z
  .object({
    json_config: z.string().min(1).max(500_000),
    name: z.string().trim().min(1).max(255).optional(),
  })
  .strip()

const UserConfigSchema = z
  .object({ config_values: z.record(z.string(), z.string()) })
  .strip()

export function createMcpRouter(deps: McpDeps): Router {
  const router = Router()

  function handle(err: unknown, res: Response, next: NextFunction): void {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'INVALID_REQUEST' })
      return
    }
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: 'NOT_FOUND' })
      return
    }
    if (err instanceof ForbiddenError) {
      res.status(403).json({ error: 'FORBIDDEN' })
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
    status = 200,
  ): (req: AuthedRequest, res: Response, next: NextFunction) => void {
    return (req, res, next) => {
      void fn(req)
        .then((result) => res.status(status).json(result ?? { ok: true }))
        .catch((err: unknown) => handle(err, res, next))
    }
  }

  const tk = (req: AuthedRequest) => getAccessToken(deps.auth, req.webSession!)

  router.get(
    '/servers',
    requireSession,
    wrap(async (req) => mapErr(async () => deps.mcp.servers(await tk(req)))),
  )
  router.get(
    '/templates',
    requireSession,
    wrap(async (req) => mapErr(async () => deps.mcp.templates(await tk(req)))),
  )
  router.get(
    '/policy',
    requireSession,
    wrap(async (req) => mapErr(async () => deps.mcp.policy(await tk(req)))),
  )

  router.post(
    '/templates/:id/install',
    requireSession,
    wrap(async (req) => {
      const body = InstallTemplateSchema.parse(req.body)
      return mapErr(async () =>
        deps.mcp.installTemplate(await tk(req), String(req.params.id), {
          ...(body.config_values ? { config_values: body.config_values } : {}),
          ...(body.auth_credentials ? { auth_credentials: body.auth_credentials } : {}),
          ...(body.display_name ? { display_name: body.display_name } : {}),
        }),
      )
    }, 201),
  )

  router.post(
    '/install-json',
    requireSession,
    wrap(async (req) => {
      const body = InstallJsonSchema.parse(req.body)
      return mapErr(async () => deps.mcp.installJson(await tk(req), body))
    }, 201),
  )

  router.post(
    '/servers',
    requireSession,
    wrap(async (req) => mapErr(async () => deps.mcp.createServer(await tk(req), req.body ?? {})), 201),
  )

  router.put(
    '/servers/:id/enable',
    requireSession,
    wrap(async (req) => mapErr(async () => deps.mcp.setEnabled(await tk(req), String(req.params.id), true))),
  )
  router.put(
    '/servers/:id/disable',
    requireSession,
    wrap(async (req) => mapErr(async () => deps.mcp.setEnabled(await tk(req), String(req.params.id), false))),
  )

  router.post(
    '/servers/:id/test',
    requireSession,
    wrap(async (req) => {
      const accessToken = await tk(req)
      const row = await findServerRow(deps, accessToken, String(req.params.id))
      if (!row) throw new NotFoundError()
      if (row.scope !== 'user') throw new ForbiddenError() // 仅 own personal
      return mapErr(async () => deps.mcp.test(accessToken, String(req.params.id)))
    }),
  )

  router.get(
    '/servers/:id/user-config',
    requireSession,
    wrap(async (req) => {
      const accessToken = await tk(req)
      const row = await findServerRow(deps, accessToken, String(req.params.id))
      if (!row) throw new NotFoundError()
      return mapErr(async () => deps.mcp.getUserConfig(accessToken, String(req.params.id)))
    }),
  )

  router.put(
    '/servers/:id/user-config',
    requireSession,
    wrap(async (req) => {
      const body = UserConfigSchema.parse(req.body)
      const accessToken = await tk(req)
      const row = await findServerRow(deps, accessToken, String(req.params.id))
      if (!row) throw new NotFoundError()
      if (row.scope !== 'user') throw new ForbiddenError()
      return mapErr(async () => deps.mcp.putUserConfig(accessToken, String(req.params.id), body))
    }),
  )

  router.patch(
    '/servers/:id',
    requireSession,
    wrap(async (req) => {
      const accessToken = await tk(req)
      const row = await findServerRow(deps, accessToken, String(req.params.id))
      if (!row) throw new NotFoundError()
      if (row.scope !== 'user') throw new ForbiddenError()
      return mapErr(async () => deps.mcp.updateServer(accessToken, String(req.params.id), req.body ?? {}))
    }),
  )

  router.delete(
    '/servers/:id',
    requireSession,
    wrap(async (req) => {
      const accessToken = await tk(req)
      const row = await findServerRow(deps, accessToken, String(req.params.id))
      if (!row) throw new NotFoundError()
      if (row.scope !== 'user') throw new ForbiddenError()
      return mapErr(async () => deps.mcp.deleteServer(accessToken, String(req.params.id)))
    }),
  )

  return router
}
