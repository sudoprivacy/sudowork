/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Forwards the remote-connections (channels) endpoints to the moss this
 * deployment fronts.
 *
 * The shared renderer's channels page drives IM connections through the
 * `channel.*` bridge wires; on the web the mossAdapter maps those wires onto
 * these same-origin routes. Like consumerRoutes this is an allowlist forward
 * (session-scoped, moss replies passed through verbatim) — the wire-shape
 * translation (`{ok,...}` envelopes → `IBridgeResponse`) lives in the adapter,
 * not here, so each side keeps one responsibility.
 */
import { Router, type NextFunction, type Response } from 'express'
import { getMossContext } from '../auth/authService.js'
import { requireSession, type AuthedRequest } from '../auth/sessionMiddleware.js'
import type { AuthDeps } from '../auth/authService.js'

type ForwardMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

/** Paths this server will forward: `/api/channels/<path>` → moss `/api/v1/channels/<path>`. */
const FORWARDED: ReadonlyArray<{ method: ForwardMethod; path: string }> = [
  { method: 'GET', path: '/plugins' },
  { method: 'GET', path: '/plugins/:id/credentials' },
  { method: 'POST', path: '/plugins/:id/enable' },
  { method: 'POST', path: '/plugins/:id/disable' },
  { method: 'POST', path: '/plugins/:id/test' },
  { method: 'POST', path: '/plugins/create' },
  { method: 'GET', path: '/plugins/:id/agents' },
  { method: 'PUT', path: '/plugins/:id/agents/default' },
  { method: 'GET', path: '/pairings/pending' },
  { method: 'POST', path: '/pairings/:code/approve' },
  { method: 'POST', path: '/pairings/:code/reject' },
  { method: 'GET', path: '/users' },
  { method: 'DELETE', path: '/users/:id' },
  { method: 'POST', path: '/settings/sync' },
  { method: 'POST', path: '/wechat/qr-start' },
  { method: 'GET', path: '/wechat/qr-poll' },
]

export function createChannelsRouter(deps: { auth: AuthDeps }): Router {
  const router = Router()

  for (const route of FORWARDED) {
    const handler = async (
      req: AuthedRequest,
      res: Response,
      next: NextFunction,
    ): Promise<void> => {
      try {
        const ctx = await getMossContext(deps.auth, req.webSession!)
        // `originalUrl` keeps the real path params (`:id`, `:code`) and the
        // query string (qr-poll's ?qrcode=); only the prefix differs upstream.
        const upstreamUrl = new URL(
          req.originalUrl.replace(/^\/api\/channels/, '/api/v1/channels'),
          ctx.baseUrl,
        ).toString()
        const hasBody = route.method === 'POST' || route.method === 'PUT'
        const upstream = await fetch(upstreamUrl, {
          method: route.method,
          headers: {
            Authorization: `Bearer ${ctx.accessToken}`,
            ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(hasBody ? { body: JSON.stringify(req.body ?? {}) } : {}),
        })
        const text = await upstream.text()
        // Passed through verbatim, status included: the adapter reads moss's
        // own envelopes (`{ok}`, `{success}`, bare rows) and re-wraps them.
        res.status(upstream.status).type('application/json').send(text)
      } catch (err) {
        next(err)
      }
    }

    if (route.method === 'GET') router.get(route.path, requireSession, handler)
    else if (route.method === 'POST') router.post(route.path, requireSession, handler)
    else if (route.method === 'PUT') router.put(route.path, requireSession, handler)
    else router.delete(route.path, requireSession, handler)
  }

  return router
}
