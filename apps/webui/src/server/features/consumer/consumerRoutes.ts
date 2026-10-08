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
import { getMossContext } from '../auth/authService.js'
import { requireSession, type AuthedRequest } from '../auth/sessionMiddleware.js'
import type { AuthDeps } from '../auth/authService.js'

/**
 * Paths this server will forward, exact match on the leading segments.
 *
 * Read-only except for credit applications, which a user submits for their own
 * account. Every one of these is scoped by moss to the calling user, so the
 * forward adds no authority beyond what the session already carries.
 */
const FORWARDED = [
  // The sidebar groups conversations by the agent each belongs to and needs
  // the names; scoped by moss to the calling user, like everything here.
  // Path mirrors MOSS_MY_AGENTS_PATH under this router's /api/v1 mount.
  { method: 'GET', path: '/agents/mine' },
  { method: 'GET', path: '/user/dashboard' },
  { method: 'GET', path: '/user/profile' },
  { method: 'GET', path: '/user/model-usage-stats' },
  { method: 'GET', path: '/credit-applications' },
  { method: 'POST', path: '/credit-applications' },
  // Recharge center: the shared renderer sends the full order flow to
  // getConfig().baseUrl, which on the web is this origin.
  { method: 'GET', path: '/recharge/packages' },
  { method: 'GET', path: '/recharge/list' },
  { method: 'POST', path: '/recharge/create' },
  { method: 'POST', path: '/recharge/pay' },
  { method: 'GET', path: '/recharge/query/:orderNo' },
  { method: 'POST', path: '/recharge/cancel/:orderNo' },
] as const

export function createConsumerRouter(deps: { auth: AuthDeps }): Router {
  const router = Router()

  for (const route of FORWARDED) {
    const handler = async (
      req: AuthedRequest,
      res: Response,
      next: NextFunction,
    ): Promise<void> => {
      try {
        const ctx = await getMossContext(deps.auth, req.webSession!)
        // `originalUrl` keeps the mount prefix, the real path params and the
        // query string, so param routes like /recharge/query/:orderNo forward
        // with the actual order number and paged lists keep their query.
        const upstream = await fetch(new URL(req.originalUrl, ctx.baseUrl).toString(), {
          method: route.method,
          headers: {
            Authorization: `Bearer ${ctx.accessToken}`,
            ...(route.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(route.method === 'POST' ? { body: JSON.stringify(req.body ?? {}) } : {}),
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

    if (route.method === 'GET') router.get(route.path, requireSession, handler)
    else router.post(route.path, requireSession, handler)
  }

  return router
}
