import { Router } from 'express'
import { MossHttpError, type MossFetch } from '@sudowork/moss-client'
import { getMossContext, type AuthDeps } from '../auth/authService.js'
import { requireSession, type AuthedRequest } from '../auth/sessionMiddleware.js'

/** Allowlisted user/admin routes; Moss enforces organization-scoped role and platform policy permissions. */
export function createExternalProviderRouter(deps: { auth: AuthDeps; request: MossFetch }): Router {
  const router = Router()
  const routes: Array<{ method: 'get' | 'post'; path: string }> = [
    { method: 'get', path: '/external-agents/access' },
    { method: 'get', path: '/external-agents/admin/policy' },
    { method: 'get', path: '/external-agents/admin/members' },
    { method: 'get', path: '/external-agents/admin/agents' },
    { method: 'post', path: '/external-agents/admin/policy' },
    { method: 'post', path: '/external-agents/admin/inspect' },
    { method: 'post', path: '/external-agents/admin/onboard' },
    { method: 'post', path: '/external-agents/admin/:id/update' },
    { method: 'post', path: '/external-agents/admin/:id/rotate' },
    { method: 'post', path: '/external-agents/admin/:id/archive' },
    { method: 'post', path: '/external-agents/admin/:id/test' },
    { method: 'post', path: '/external-agents/:id/review' },
    { method: 'get', path: '/external-agents' },
    { method: 'get', path: '/external-sessions' },
    { method: 'get', path: '/external-sessions/:id/tasks' },
    { method: 'get', path: '/tasks/:id/events' },
    { method: 'post', path: '/tasks' },
  ]
  for (const route of routes)
    router[route.method](route.path, requireSession, (req: AuthedRequest, res, next) => {
      void (async () => {
        const context = await getMossContext(deps.auth, req.webSession!)
        const result = await deps.request(context.baseUrl, {
          method: route.method === 'get' ? 'GET' : 'POST',
          path: `/api/v1${req.path}`,
          accessToken: context.accessToken,
          ...(route.method === 'post' ? { body: req.body } : {}),
          ...(req.query.cursor === undefined
            ? {}
            : { searchParams: { cursor: String(req.query.cursor) } }),
        })
        res.setHeader('Cache-Control', 'no-store')
        res
          .status(
            route.path === '/tasks' && route.method === 'post'
              ? 202
              : route.path === '/external-agents/admin/onboard'
                ? 201
                : 200,
          )
          .json(result)
      })().catch((error: unknown) => {
        if (error instanceof MossHttpError) {
          let code = 'EXTERNAL_TASK_REQUEST_FAILED'
          try {
            const parsed = JSON.parse(error.bodyText)
            if (typeof parsed.error?.code === 'string' && /^[A-Z_]+$/.test(parsed.error.code))
              code = parsed.error.code
          } catch {
            /* Safe generic error. */
          }
          res.status(error.status).json({ error: code })
          return
        }
        next(error)
      })
    })
  return router
}
