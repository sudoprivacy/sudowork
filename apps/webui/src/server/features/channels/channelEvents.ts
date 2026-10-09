/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `/ws/channels` event bridge.
 *
 * The desktop pushes channel events (`pairingRequested`, `userAuthorized`,
 * `pluginStatusChanged`) over IPC the moment they happen. moss only offers
 * read endpoints, so this bridge polls the three sources while at least one
 * socket per principal is open and pushes the deltas as `{type, payload}`
 * frames; the browser adapter re-emits them onto the renderer's wires.
 *
 * - Pollers are per-principal and shared by that principal's sockets
 *   (refcounted), so N tabs cost one poller, and the last disconnect stops it.
 * - The first poll only builds a baseline: pages fetch the full lists on load,
 *   so replaying them would duplicate notifications. Only later deltas push.
 * - Frames for `pluginStatusChanged` carry the raw moss plugin row; the
 *   adapter owns the row → `IChannelPluginStatus` conversion (single copy).
 */
import type { WebSocket, WebSocketServer } from 'ws'
import { getMossContext, type AuthDeps } from '../auth/authService.js'
import type { WebSessionRow } from '../auth/sessionRepository.js'

const POLL_INTERVAL_MS = 5_000

export interface ChannelEventFrame {
  type: 'pairingRequested' | 'userAuthorized' | 'pluginStatusChanged'
  payload: unknown
}

interface PluginRow {
  id?: unknown
  enabled?: unknown
  status?: unknown
  [key: string]: unknown
}

interface PollBaseline {
  pairings: Set<string>
  users: Set<string>
  plugins: Map<string, string>
}

interface PrincipalPoller {
  sockets: Set<WebSocket>
  session: WebSessionRow
  timer: NodeJS.Timeout | null
  baseline: PollBaseline | null
}

async function fetchMossList(
  auth: AuthDeps,
  session: WebSessionRow,
  path: string,
): Promise<Record<string, unknown>[] | null> {
  try {
    const ctx = await getMossContext(auth, session)
    const upstream = await fetch(new URL(path, ctx.baseUrl).toString(), {
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
    })
    if (!upstream.ok) return null
    const body = (await upstream.json()) as Record<string, unknown>
    // `{pairings: [...]}` / `{users: [...]}` / `{plugins: [...]}`
    for (const key of ['pairings', 'users', 'plugins']) {
      const list = body[key]
      if (Array.isArray(list)) return list as Record<string, unknown>[]
    }
    return null
  } catch {
    // Transient moss/network failure: skip this round, keep the baseline so
    // deltas resume cleanly once moss is reachable again.
    return null
  }
}

function toKey(row: Record<string, unknown>, field: string): string | null {
  const value = row[field]
  return typeof value === 'string' && value ? value : null
}

async function pollAndPush(deps: { auth: AuthDeps }, poller: PrincipalPoller): Promise<void> {
  const [pairings, users, plugins] = await Promise.all([
    fetchMossList(deps.auth, poller.session, '/api/v1/channels/pairings/pending'),
    fetchMossList(deps.auth, poller.session, '/api/v1/channels/users'),
    fetchMossList(deps.auth, poller.session, '/api/v1/channels/plugins'),
  ])

  const frames: ChannelEventFrame[] = []
  const next: PollBaseline = { pairings: new Set(), users: new Set(), plugins: new Map() }

  for (const row of pairings ?? []) {
    const code = toKey(row, 'code')
    if (!code) continue
    next.pairings.add(code)
    if (poller.baseline && !poller.baseline.pairings.has(code)) {
      frames.push({ type: 'pairingRequested', payload: row })
    }
  }
  for (const row of users ?? []) {
    const id = toKey(row, 'id')
    if (!id) continue
    next.users.add(id)
    if (poller.baseline && !poller.baseline.users.has(id)) {
      frames.push({ type: 'userAuthorized', payload: row })
    }
  }
  for (const row of (plugins ?? []) as PluginRow[]) {
    const id = toKey(row, 'id')
    if (!id) continue
    const fingerprint = `${String(Boolean(row.enabled))}|${String(row.status ?? '')}`
    next.plugins.set(id, fingerprint)
    if (poller.baseline && poller.baseline.plugins.get(id) !== fingerprint) {
      frames.push({ type: 'pluginStatusChanged', payload: { pluginId: id, plugin: row } })
    }
  }

  // First successful round only establishes the baseline (see header note).
  poller.baseline = next
  if (!frames.length) return
  const text = JSON.stringify(frames)
  for (const ws of poller.sockets) {
    if (ws.readyState === ws.OPEN) ws.send(text)
  }
}

/**
 * Wire a `/ws/channels` WebSocketServer (noServer — upgraded by app.ts's
 * dispatcher). Connections without `deps.auth` configured are refused by the
 * caller; this function only manages poller lifecycles.
 */
export function attachChannelEvents(wss: WebSocketServer, deps: { auth: AuthDeps }): void {
  const pollers = new Map<string, PrincipalPoller>()

  const stopPoller = (principalId: string): void => {
    const poller = pollers.get(principalId)
    if (!poller) return
    if (poller.timer) clearInterval(poller.timer)
    pollers.delete(principalId)
  }

  wss.on('connection', (ws: WebSocket, session: WebSessionRow) => {
    const principalId = session.principalId
    let poller = pollers.get(principalId)
    if (!poller) {
      poller = { sockets: new Set(), session, timer: null, baseline: null }
      pollers.set(principalId, poller)
      // Immediate first round builds the baseline; deltas start from round two.
      void pollAndPush(deps, poller)
      poller.timer = setInterval(() => void pollAndPush(deps, poller!), POLL_INTERVAL_MS)
    }
    poller.sockets.add(ws)
    ws.on('close', () => {
      const current = pollers.get(principalId)
      if (!current) return
      current.sockets.delete(ws)
      if (current.sockets.size === 0) stopPoller(principalId)
    })
  })
}
