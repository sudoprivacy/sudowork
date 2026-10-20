/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Forwards the user-scoped consumer endpoints to the moss this deployment fronts.
 *
 * The shared renderer's points, usage and order pages ask the transport where to
 * send their requests, and in the browser that answer is this origin. Without a
 * forward they 404 here and the panels render empty with nothing reported.
 *
 * An allowlist rather than a blanket `/api/v1/*` proxy. A catch-all would hand
 * the browser every moss admin route under this server's session cookie, which
 * is a much larger grant than these pages need — the cookie is the credential,
 * so whatever is reachable through it is reachable to any page on this origin.
 */
import { Router, type NextFunction, type Response } from 'express'
import { z } from 'zod'
import { getMossContext } from '../auth/authService.js'
import { requireSession, type AuthedRequest } from '../auth/sessionMiddleware.js'
import type { AuthDeps } from '../auth/authService.js'

/**
 * Paths this server will forward, exact match on the leading segments.
 *
 * Every one of these is scoped by moss to the calling user, so the
 * forward adds no authority beyond what the session already carries.
 */
const FORWARDED = [
  { method: 'GET', path: '/agents/mine' },
  { method: 'GET', path: '/config/items' },
  { method: 'GET', path: '/me/secrets' },
  { method: 'GET', path: '/me/secrets/:namespace/:key' },
  { method: 'PUT', path: '/me/secrets/:namespace/:key' },
  { method: 'DELETE', path: '/me/secrets/:namespace/:key' },
  { method: 'POST', path: '/me/secrets/:namespace/:key/enable' },
  { method: 'POST', path: '/me/secrets/:namespace/:key/disable' },
  { method: 'GET', path: '/user-agents' },
  { method: 'POST', path: '/user-agents' },
  { method: 'GET', path: '/user/dashboard' },
  { method: 'GET', path: '/user/profile' },
  { method: 'GET', path: '/user/model-usage-stats' },
  { method: 'GET', path: '/credit-applications' },
  { method: 'POST', path: '/credit-applications' },
  // Shared model account and organization recharge screens.
  { method: 'GET', path: '/model-account/access' },
  { method: 'GET', path: '/model-account' },
  { method: 'GET', path: '/model-account/logs' },
  { method: 'GET', path: '/model-billing/packages' },
  { method: 'GET', path: '/model-billing/orders' },
  { method: 'POST', path: '/model-billing/orders' },
  { method: 'POST', path: '/model-billing/orders/:orderNo/pay' },
  { method: 'POST', path: '/model-billing/orders/:orderNo/sync' },
  { method: 'POST', path: '/model-billing/orders/:orderNo/cancel' },
  // Recharge center: the shared renderer sends the full order flow to
  // getConfig().baseUrl, which on the web is this origin.
  { method: 'GET', path: '/recharge/packages' },
  { method: 'GET', path: '/recharge/list' },
  { method: 'POST', path: '/recharge/create' },
  { method: 'POST', path: '/recharge/pay' },
  { method: 'GET', path: '/recharge/query/:orderNo' },
  { method: 'POST', path: '/recharge/cancel/:orderNo' },
] as const

const PersonalAgentSchema = z.object({ displayName: z.string().trim().min(1).max(60) }).strict()

export function createConsumerRouter(deps: { auth: AuthDeps }): Router {
  const router = Router()

  for (const route of FORWARDED) {
    const isBodyMethod = route.method === 'POST' || route.method === 'PUT'
    const handler = async (
      req: AuthedRequest,
      res: Response,
      next: NextFunction,
    ): Promise<void> => {
      try {
        let body = req.body ?? {}
        if (route.method === 'POST' && route.path === '/user-agents') {
          const parsed = PersonalAgentSchema.safeParse(body)
          if (!parsed.success) {
            res.status(400).json({ error: 'INVALID_REQUEST' })
            return
          }
          body = parsed.data
        }
        const ctx = await getMossContext(deps.auth, req.webSession!)
        // Retrying a purchase must retain the renderer's order identity at Moss.
        const idempotencyKey =
          route.method === 'POST' && route.path === '/model-billing/orders'
            ? req.get('Idempotency-Key')
            : undefined
        // `originalUrl` keeps the mount prefix, the real path params and the
        // query string, so param routes like /recharge/query/:orderNo forward
        // with the actual order number and paged lists keep their query.
        const upstream = await fetch(new URL(req.originalUrl, ctx.baseUrl).toString(), {
          method: route.method,
          headers: {
            Authorization: `Bearer ${ctx.accessToken}`,
            ...(isBodyMethod ? { 'Content-Type': 'application/json' } : {}),
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          },
          ...(isBodyMethod ? { body: JSON.stringify(body) } : {}),
        })
        const text = await upstream.text()
        // Passed through verbatim, status included: these pages read moss's own
        // `{success, msg}` shape, and re-wrapping would lose the reason a
        // submission was refused.
        res.status(upstream.status).type('application/json').send(text)
      } catch (err) {
        next(err)
      }
    }

    const endpoint = router.route(route.path)
    const method = route.method.toLowerCase() as Lowercase<typeof route.method>
    endpoint[method](requireSession, handler)
  }

  return router
}
