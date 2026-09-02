import { Router, type NextFunction, type Response } from 'express'
import { z, ZodError } from 'zod'
import { getAccessToken } from '../auth/authService.js'
import { findPrincipalById, type Principal } from '../auth/principalRepository.js'
import { requireSession, type AuthedRequest } from '../auth/sessionMiddleware.js'
import { MossHttpError } from '../../moss/MossHttpClient.js'
import {
  CronDisabledError,
  ForbiddenError,
  InvalidSelectionError,
  MossUnavailableError,
  NotFoundError,
  assertAssistantName,
  createJob,
  deleteJob,
  getJob,
  listJobs,
  listRuns,
  triggerJob,
  updateJob,
  type CronDeps,
} from './cronService.js'

const ScheduleSchema = z
  .object({
    kind: z.enum(['at', 'every', 'cron']),
    value: z.string().min(1).max(500),
    tz: z.string().max(64).optional(),
    description: z.string().max(500).optional(),
  })
  .strict()

const JobInputSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    schedule: ScheduleSchema.optional(),
    payloadMessage: z.string().max(20_000).optional(),
    conversationMode: z.enum(['new', 'reuse']).optional(),
    boundSessionId: z.string().min(1).max(100).nullable().optional(),
    assistantName: z.string().trim().min(1).max(255).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()

const CreateJobSchema = JobInputSchema.extend({
  name: z.string().trim().min(1).max(255),
  schedule: ScheduleSchema,
})

export function createCronRouter(deps: CronDeps): Router {
  const router = Router()

  async function principal(req: AuthedRequest): Promise<Principal | null> {
    return findPrincipalById(deps.pool, req.webSession!.principalId)
  }

  async function token(req: AuthedRequest): Promise<string> {
    return getAccessToken(deps.auth, req.webSession!)
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
      const missingPrincipal = err.message === 'SESSION_REQUIRED'
      res.status(missingPrincipal ? 401 : 403).json({
        error: missingPrincipal ? 'SESSION_REQUIRED' : 'FORBIDDEN',
      })
      return
    }
    if (err instanceof CronDisabledError) {
      res.status(403).json({ error: 'CRON_DISABLED_BY_ORG' })
      return
    }
    if (err instanceof InvalidSelectionError) {
      res.status(400).json({ error: 'SELECTION_NOT_AVAILABLE' })
      return
    }
    if (err instanceof MossUnavailableError) {
      res.status(503).json({ error: 'MOSS_UNAVAILABLE' })
      return
    }
    if (err instanceof MossHttpError) {
      if (err.bodyText.includes('cron_disabled_by_org')) {
        res.status(403).json({ error: 'CRON_DISABLED_BY_ORG' })
        return
      }
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

  router.get(
    '/',
    requireSession,
    wrap(async (req) => {
      const p = await principal(req)
      if (!p) throw new ForbiddenError('SESSION_REQUIRED')
      const { jobs, canCreate, canUseAdminList } = await listJobs(deps, p, await token(req))
      return { jobs, canCreate, canUseAdminList }
    }),
  )

  router.post(
    '/',
    requireSession,
    wrap(async (req) => {
      const p = await principal(req)
      if (!p) throw new ForbiddenError('SESSION_REQUIRED')
      const input = CreateJobSchema.parse(req.body)
      const tk = await token(req)
      if (input.assistantName) {
        await assertAssistantName(deps, tk, input.assistantName)
      }
      return createJob(deps, p, tk, input)
    }, 201),
  )

  router.get(
    '/:id',
    requireSession,
    wrap(async (req) => {
      const p = await principal(req)
      if (!p) throw new ForbiddenError('SESSION_REQUIRED')
      return getJob(deps, p, await token(req), String(req.params.id))
    }),
  )

  router.patch(
    '/:id',
    requireSession,
    wrap(async (req) => {
      const p = await principal(req)
      if (!p) throw new ForbiddenError('SESSION_REQUIRED')
      const input = JobInputSchema.parse(req.body)
      const tk = await token(req)
      if (input.assistantName) {
        await assertAssistantName(deps, tk, input.assistantName)
      }
      return updateJob(deps, p, tk, String(req.params.id), input)
    }),
  )

  router.delete(
    '/:id',
    requireSession,
    wrap(async (req) => {
      const p = await principal(req)
      if (!p) throw new ForbiddenError('SESSION_REQUIRED')
      return deleteJob(deps, p, await token(req), String(req.params.id))
    }),
  )

  router.post(
    '/:id/trigger',
    requireSession,
    wrap(async (req) => {
      const p = await principal(req)
      if (!p) throw new ForbiddenError('SESSION_REQUIRED')
      return triggerJob(deps, p, await token(req), String(req.params.id))
    }),
  )

  router.get(
    '/:id/runs',
    requireSession,
    wrap(async (req) => {
      const p = await principal(req)
      if (!p) throw new ForbiddenError('SESSION_REQUIRED')
      const limit = Math.min(
        Math.max(Number(req.query.limit ?? 20) || 20, 1),
        100,
      )
      return listRuns(deps, p, await token(req), String(req.params.id), limit)
    }),
  )

  return router
}
