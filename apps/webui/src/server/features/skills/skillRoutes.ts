import { Router, type NextFunction, type Response } from 'express'
import { ZodError } from 'zod'
import { getMossContext } from '../auth/authService.js'
import type { MossCallContext } from '@sudowork/moss-client'
import { requireSession, type AuthedRequest } from '../auth/sessionMiddleware.js'
import { MossHttpError } from '@sudowork/moss-client'
import {
  HubListQuerySchema,
  InstallRequestSchema,
  SetEnabledRequestSchema,
  TenantPublishRequestSchema,
  UninstallRequestSchema,
  UploadCustomRequestSchema,
} from './skillSchemas.js'
import {
  ForbiddenError,
  MossUnavailableError,
  NotFoundError,
  hubCategories,
  hubDetail,
  hubList,
  installFromHub,
  listInstalled,
  setEnabled,
  syncFromHub,
  syncStatus,
  tenantDelete,
  tenantDownload,
  tenantList,
  tenantPublish,
  tenantUpdate,
  tenantUpload,
  uninstall,
  uploadCustom,
  type SkillDeps,
} from './skillService.js'

export function createSkillRouter(deps: SkillDeps): Router {
  const router = Router()

  async function token(req: AuthedRequest): Promise<MossCallContext> {
    return getMossContext(deps.auth, req.webSession!)
  }

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
  ): (req: AuthedRequest, res: Response, next: NextFunction) => void {
    return (req, res, next) => {
      void fn(req)
        .then((result) => res.status(200).json(result ?? { ok: true }))
        .catch((err: unknown) => handle(err, res, next))
    }
  }

  router.get('/', requireSession, wrap(async (req) => listInstalled(deps, await token(req))))
  router.get(
    '/hub/categories',
    requireSession,
    wrap(async (req) => hubCategories(deps, await token(req))),
  )
  router.get(
    '/hub/list',
    requireSession,
    wrap(async (req) => {
      const query = HubListQuerySchema.parse(req.query)
      const searchParams: Record<string, string> = {}
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) searchParams[k] = String(v)
      }
      return hubList(deps, await token(req), searchParams)
    }),
  )
  router.get(
    '/hub/:id',
    requireSession,
    wrap(async (req) => hubDetail(deps, await token(req), String(req.params.id))),
  )
  router.get(
    '/sync-status',
    requireSession,
    wrap(async (req) => syncStatus(deps, await token(req))),
  )
  router.get(
    '/tenant',
    requireSession,
    wrap(async (req) => tenantList(deps, await token(req))),
  )
  router.get(
    '/tenant/:id/download',
    requireSession,
    wrap(async (req) => tenantDownload(deps, await token(req), String(req.params.id))),
  )

  router.post(
    '/install',
    requireSession,
    wrap(async (req) => {
      const body = InstallRequestSchema.parse(req.body)
      return installFromHub(deps, await token(req), body.name)
    }),
  )
  router.patch(
    '/enabled',
    requireSession,
    wrap(async (req) => {
      const body = SetEnabledRequestSchema.parse(req.body)
      return setEnabled(deps, await token(req), body.name, body.enabled)
    }),
  )
  router.post(
    '/custom',
    requireSession,
    wrap(async (req) => {
      const body = UploadCustomRequestSchema.parse(req.body)
      return uploadCustom(deps, await token(req), body.file)
    }),
  )
  router.post(
    '/uninstall',
    requireSession,
    wrap(async (req) => {
      const body = UninstallRequestSchema.parse(req.body)
      return uninstall(deps, await token(req), body.name)
    }),
  )
  router.post(
    '/sync',
    requireSession,
    wrap(async (req) => syncFromHub(deps, await token(req))),
  )
  router.post(
    '/tenant',
    requireSession,
    wrap(async (req) => tenantUpload(deps, await token(req), req.body ?? {})),
  )
  router.patch(
    '/tenant/:id',
    requireSession,
    wrap(async (req) =>
      tenantUpdate(deps, await token(req), String(req.params.id), req.body ?? {}),
    ),
  )
  router.delete(
    '/tenant/:id',
    requireSession,
    wrap(async (req) => tenantDelete(deps, await token(req), String(req.params.id))),
  )
  router.post(
    '/tenant/publish',
    requireSession,
    wrap(async (req) => {
      const body = TenantPublishRequestSchema.parse(req.body)
      return tenantPublish(deps, await token(req), body.sourceName)
    }),
  )

  return router
}
