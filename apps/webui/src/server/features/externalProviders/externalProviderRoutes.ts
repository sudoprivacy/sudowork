import { Router } from 'express'
import { MossHttpError, MossNetworkError, type MossFetch } from '@sudowork/moss-client'
import {
  EXTERNAL_REQUEST_TIMEOUT_MS,
  withExternalRequestDeadline,
} from '@sudowork/moss-client/external-providers'
import { getMossContext, type AuthDeps } from '../auth/authService.js'
import { requireSession, type AuthedRequest } from '../auth/sessionMiddleware.js'

/** Allowlisted user/admin routes; Moss enforces organization-scoped role and platform policy permissions. */
export function createExternalProviderRouter(deps: { auth: AuthDeps; request: MossFetch }): Router {
  const router = Router()
  router.get('/external-context', requireSession, (req: AuthedRequest, res) => {
    const session = req.webSession!
    const baseUrl = session.mossBaseUrl ?? deps.auth.config.moss.baseUrl
    const isAvailable = Boolean(baseUrl && session.encryptedMossTokens?.length)
    res.setHeader('Cache-Control', 'no-store')
    res.json({
      success: true,
      data: {
        isAvailable,
        identity: isAvailable ? JSON.stringify([baseUrl, session.principalId]) : '',
      },
    })
  })
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
      void withExternalRequestDeadline(async (signal) => {
        const deadline = Date.now() + EXTERNAL_REQUEST_TIMEOUT_MS
        const principalId = req.webSession!.principalId
        let context = await getMossContext(deps.auth, req.webSession!)
        const baseUrl = context.baseUrl
        const expectedIdentity = req.get('X-Sudo-External-Identity')
        const assertIdentity = () => {
          signal.throwIfAborted()
          if (
            req.webSession!.principalId !== principalId ||
            context.baseUrl !== baseUrl ||
            (expectedIdentity !== undefined &&
              expectedIdentity !== JSON.stringify([baseUrl, principalId]))
          ) {
            throw new MossHttpError(
              409,
              JSON.stringify({ error: { code: 'EXTERNAL_IDENTITY_CHANGED' } }),
              req.path,
            )
          }
        }
        assertIdentity()
        const send = () =>
          deps.request(
            context.baseUrl,
            {
              method: route.method === 'get' ? 'GET' : 'POST',
              path: `/api/v1${req.path}`,
              accessToken: context.accessToken,
              ...(route.method === 'post' ? { body: req.body } : {}),
              ...(req.query.cursor === undefined
                ? {}
                : { searchParams: { cursor: String(req.query.cursor) } }),
            },
            Math.max(1, deadline - Date.now()),
          )
        let result: unknown
        try {
          result = await send()
        } catch (error) {
          if (!(error instanceof MossHttpError) || error.status !== 401) throw error
          context = await getMossContext(deps.auth, req.webSession!, true)
          assertIdentity()
          result = await send()
        }
        assertIdentity()
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
      }).catch((error: unknown) => {
        if (error instanceof Error && error.message === 'EXTERNAL_TASK_TIMEOUT') {
          res.status(504).json({ error: 'EXTERNAL_TASK_TIMEOUT' })
          return
        }
        if (error instanceof MossNetworkError) {
          res.status(502).json({ error: 'EXTERNAL_TASK_REQUEST_FAILED' })
          return
        }
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
