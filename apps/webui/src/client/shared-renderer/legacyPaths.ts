/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Translation of the old path-based console URLs to the renderer's hash routes.
 *
 * Legacy path URLs (/agents, /cron/:id, /settings/*, …) are still served the SPA
 * shell by the server fallback, and the renderer is a hash router, so the path
 * has to be rewritten once on the client before mounting.
 *
 * Kept apart from `main.ts` so it can be tested: `main.ts` redirects and mounts
 * at module scope, so importing it runs the app. This drifted once already —
 * the settings branch listed four of the renderer's eighteen settings routes,
 * and every other one quietly resolved to the home screen instead of 404ing.
 */

/**
 * The hash route a legacy path belongs to, or null when the path is already
 * hash-routed and nothing should happen.
 */
export function hashTargetForLegacyPath(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  // Normal entry ('/') is already hash-routed — nothing to migrate.
  if (path === '/') return null

  // Prefix matches carry the remainder through rather than enumerating routes.
  // A second copy of the route table here is what drifted; the hash router
  // already sends an unregistered path to /guid, which is where an unmatched
  // path lands anyway, so forwarding an unknown one costs nothing.
  const settings = /^\/settings\/(.+)$/.exec(path)
  const cronId = /^\/cron\/(.+)$/.exec(path)
  const conversation = /^\/conversation\/(.+)$/.exec(path)

  if (path === '/agents') return '/#/app/agent'
  if (path === '/skills') return '/#/app/skills'
  if (cronId) return `/#/app/cron/${cronId[1]}`
  if (path === '/cron') return '/#/app/cron'
  if (settings) return `/#/settings/${settings[1]}`
  if (conversation) return `/#/conversation/${conversation[1]}`
  if (path === '/login') return '/#/login'
  return '/#/guid'
}

/**
 * Returns true when a redirect was issued (navigation pending — skip mounting).
 */
export function redirectLegacyPath(): boolean {
  const target = hashTargetForLegacyPath(window.location.pathname)
  if (target === null) return false
  window.location.replace(target)
  return true
}
