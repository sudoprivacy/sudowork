import { Router } from 'express'
import { ZodError } from 'zod'
import {
  createMossOntologyPort,
  MossHttpError,
  MossNetworkError,
  type MossFetch,
} from '@sudowork/moss-client'
import { getMossContext, type AuthDeps } from '../auth/authService.js'
import { requireSession, type AuthedRequest } from '../auth/sessionMiddleware.js'

/** Read only the authenticated owner's registered references; do not mirror model state. */
export function createOntologyRouter(deps: { auth: AuthDeps; request: MossFetch }): Router {
  const router = Router()
  const ontology = createMossOntologyPort(deps.request)
  router.get('/projects', requireSession, (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    void (async () => {
      const ctx = await getMossContext(deps.auth, (req as AuthedRequest).webSession!)
      res.status(200).json({ projects: await ontology.projects(ctx) })
    })().catch((error: unknown) => {
      if (error instanceof MossHttpError) {
        res
          .status([400, 403, 404, 409, 503].includes(error.status) ? error.status : 502)
          .json({ error: 'MODEL_PROJECT_UNAVAILABLE' })
      } else if (error instanceof MossNetworkError) {
        res.status(503).json({ error: 'MOSS_UNAVAILABLE' })
      } else if (error instanceof ZodError) {
        res.status(502).json({ error: 'INVALID_MODEL_PROJECT_RESPONSE' })
      } else {
        next(error)
      }
    })
  })
  return router
}
