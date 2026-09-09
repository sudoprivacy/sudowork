/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The web entry that hosts the shared `@sudowork/renderer` over the moss
 * transport. This is the sole webui front-end entry.
 *
 * Order matters (mirrors the desktop entry packages/renderer/src/index.ts):
 * side-effect-import the moss adapter FIRST so `bridge.adapter` is wired before
 * the renderer's eager module-level ipcBridge calls run. `useAppMode` primes the
 * app mode via a module-level `ConfigStorage` ipcBridge call at import time, and
 * ES import hoisting means the transport must be live before `mountApp` (and the
 * modules it pulls in) execute.
 */

import '../bridgeAdapter/mossAdapter'
import { mountApp } from '@sudowork/renderer/bootstrap/mount'

/**
 * Legacy path URLs (/agents, /cron/:id, /settings/*, …) are still served the
 * SPA shell by the server fallback. The renderer is a hash router, so translate
 * the old path to its hash route once, on the client, before mounting. Returns
 * true when a redirect was issued (navigation pending — skip mounting).
 */
function redirectLegacyPath(): boolean {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  // Normal entry ('/') is already hash-routed — nothing to migrate.
  if (path === '/') return false

  const settings = /^\/settings\/(profile|display|about|mcp)$/.exec(path)
  const cronId = /^\/cron\/(.+)$/.exec(path)
  const conversation = /^\/conversation\/(.+)$/.exec(path)

  let target = '/#/guid'
  if (path === '/agents') target = '/#/app/agent'
  else if (path === '/skills') target = '/#/app/skills'
  else if (cronId) target = `/#/app/cron/${cronId[1]}`
  else if (path === '/cron') target = '/#/app/cron'
  else if (settings) target = `/#/settings/${settings[1]}`
  else if (conversation) target = `/#/conversation/${conversation[1]}`
  else if (path === '/login') target = '/#/login'
  else if (path === '/guid') target = '/#/guid'

  window.location.replace(target)
  return true
}

if (!redirectLegacyPath()) {
  mountApp()
}
