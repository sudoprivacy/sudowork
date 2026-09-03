/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Web (moss) transport adapter for the shared `@sudowork/renderer`.
 *
 * The shared renderer talks to its backend ONLY through the `@office-ai/platform`
 * `bridge` (the `ipcBridge` in `@sudowork/host-bridge`). On desktop that bridge is
 * wired to Electron IPC; here it is wired to the apps/webui Express server
 * (same-origin, cookie auth) which fronts moss. This module is a SIDE-EFFECT
 * import: it calls `bridge.adapter()` at import time so the transport is live
 * before the renderer's eager module-level ipcBridge calls run (see the ordering
 * note in `shared-renderer/main.ts`).
 *
 * Protocol (from `@office-ai/platform`):
 *  - `invoke(channel, req)` emits `subscribe-<channel>` with `{ id, data: req }`.
 *  - the reply MUST come back as `subscribe.callback-<channel><id>` delivered
 *    through the `emitter` passed to `on`.
 *  - `buildEmitter(channel).on(cb)` registers `cb` on that same emitter, so a
 *    server-pushed stream frame reaches the UI via `emitter.emit(channel, frame)`.
 *
 * Every `emit()` branch delivers a callback — an unanswered invoke hangs the UI.
 * Channels without a web mapping resolve to a `not-supported-on-web`
 * `IBridgeResponse` (never left pending), logged once for triage.
 */

import { bridge } from '@office-ai/platform'

interface BridgeEmitter {
  emit: (name: string, data: unknown) => void
}

/** Renderer-side IBridgeResponse shape (see packages/host-bridge/src/ipcBridge.ts). */
interface IBridgeResponse<D = unknown> {
  success: boolean
  data?: D
  msg?: string
}

type AnyReq = Record<string, any>

const ok = <D>(data?: D): IBridgeResponse<D> => ({ success: true, data })
const fail = (msg: string): IBridgeResponse => ({ success: false, msg })

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ---------------------------------------------------------------------------
// Bridge emitter (inbound channel — set synchronously when bridge.adapter runs).
// ---------------------------------------------------------------------------

let emitterRef: BridgeEmitter | null = null
const unmappedLogged = new Set<string>()

// ---------------------------------------------------------------------------
// ConfigStorage / ChatStorage / EnvStorage groups: `@office-ai/platform`
// `buildStorage(group)` routes get/set/remove/clear through the bridge as
// `<group>.storage.<op>`. On desktop these hit the main process; on the web we
// back them onto localStorage so the renderer's config layer works offline.
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = 'sw.web-bridge'
const STORAGE_RE = /^(.+)\.storage\.(get|set|remove|clear)$/

function storageKey(group: string, key: string): string {
  return `${STORAGE_PREFIX}:${group}:${key}`
}

function storageGet(group: string, key: string): unknown {
  const raw = localStorage.getItem(storageKey(group, key))
  if (raw == null) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function storageSet(group: string, key: string, data: unknown): void {
  try {
    localStorage.setItem(storageKey(group, key), JSON.stringify(data))
  } catch {
    /* quota / serialization — best-effort */
  }
}

function storageRemove(group: string, key: string): void {
  localStorage.removeItem(storageKey(group, key))
}

function storageClear(group: string): void {
  const prefix = `${STORAGE_PREFIX}:${group}:`
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i)
    if (k && k.startsWith(prefix)) localStorage.removeItem(k)
  }
}

// Web host runs in enterprise ('e') mode: the renderer's enterprise branches hide
// local-only desktop surfaces (filesystem / terminal / runtime installers). Seed
// it so useAppMode's eager `ConfigStorage.get('system.appMode')` resolves to 'e'
// (which also makes needsSetup=false, skipping the first-run ModeSetup).
if (typeof window !== 'undefined' && storageGet('agent.config', 'system.appMode') === undefined) {
  storageSet('agent.config', 'system.appMode', 'e')
}

// ---------------------------------------------------------------------------
// Same-origin HTTP to the apps/webui server (cookie session auth).
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }
  if (!res.ok) {
    const code =
      body && typeof body === 'object' && 'error' in body && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `HTTP_${res.status}`
    throw new Error(code)
  }
  return body as T
}

// ---------------------------------------------------------------------------
// Session stream (chat): the server exposes one WS per moss session at
// `/ws/conversations/:mossSessionId` (cookie auth, upstream managed server-side).
// Raw server frames are forwarded to the renderer's stream emitters. Frame-shape
// translation to IResponseMessage is the live-e2e follow-up.
// ---------------------------------------------------------------------------

const openStreams = new Map<string, WebSocket>()

function wsUrlFor(sessionId: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/ws/conversations/${encodeURIComponent(sessionId)}`
}

function ensureSessionStream(sessionId: string): WebSocket | null {
  if (!sessionId) return null
  const existing = openStreams.get(sessionId)
  if (existing) return existing
  const ws = new WebSocket(wsUrlFor(sessionId))
  openStreams.set(sessionId, ws)
  ws.addEventListener('message', (ev) => {
    let frame: unknown
    try {
      frame = JSON.parse(String(ev.data))
    } catch {
      return
    }
    emitterRef?.emit('chat.response.stream', frame)
    emitterRef?.emit('moss.response-stream', frame)
  })
  ws.addEventListener('close', () => openStreams.delete(sessionId))
  ws.addEventListener('error', () => {
    try {
      ws.close()
    } catch {
      /* noop */
    }
  })
  return ws
}

function sendOverStream(sessionId: string, payload: unknown): boolean {
  const ws = ensureSessionStream(sessionId)
  if (!ws) return false
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload))
    return true
  }
  ws.addEventListener(
    'open',
    () => {
      try {
        ws.send(JSON.stringify(payload))
      } catch {
        /* noop */
      }
    },
    { once: true },
  )
  return true
}

function extractText(req: AnyReq): string {
  if (typeof req?.content === 'string') return req.content
  if (typeof req?.text === 'string') return req.text
  if (typeof req?.input === 'string') return req.input
  if (Array.isArray(req?.content)) {
    return req.content.map((p: AnyReq) => (typeof p?.text === 'string' ? p.text : '')).join('')
  }
  return ''
}

// ---------------------------------------------------------------------------
// DTO adapters: apps/webui server shapes -> renderer shapes.
// ---------------------------------------------------------------------------

interface ConversationListItem {
  id: string
  status?: string
  assistantName?: string | null
  source?: string | null
  lastActiveAt?: number | null
  title?: string | null
  pinned?: boolean
  pinnedAt?: number | null
}

/** Minimal TChatConversation projection (enough for the sider + open flow). */
function toChatConversation(item: ConversationListItem): Record<string, unknown> {
  const ts = item.lastActiveAt ?? Date.now()
  return {
    id: item.id,
    name: item.title ?? item.assistantName ?? item.id,
    type: 'acp',
    createTime: ts,
    modifyTime: ts,
    status: item.status === 'running' ? 'running' : 'finished',
    extra: {
      backend: 'scode',
      agentName: item.assistantName ?? undefined,
      pinned: item.pinned ?? false,
      pinnedAt: item.pinnedAt ?? undefined,
      mossSessionId: item.id,
    },
    model: { platform: '', name: '', useModel: '', id: '' },
  }
}

/** Minimal MossSessionInfo projection. */
function toMossSession(item: ConversationListItem): Record<string, unknown> {
  return {
    sessionId: item.id,
    status: item.status ?? 'active',
    assistantName: item.assistantName ?? null,
    title: item.title ?? null,
    lastActiveAt: item.lastActiveAt ?? null,
  }
}

async function listConversations(): Promise<ConversationListItem[]> {
  const { conversations } = await apiFetch<{ conversations: ConversationListItem[] }>('/api/conversations')
  return conversations
}

// ---------------------------------------------------------------------------
// Channel mapping table. Everything not listed falls through to a default reject.
// ---------------------------------------------------------------------------

const handlers: Record<string, (req: AnyReq) => Promise<unknown>> = {
  // --- enterprise/session flags ---
  'moss.is-enterprise-mode': async () => true,
  'moss.get-config': async () => ({ serverUrl: location.origin, hasToken: true }),
  'moss.set-auth-token': async () => ok(),

  // --- conversation list / open ---
  'database.get-user-conversations': async () => (await listConversations()).map(toChatConversation),
  'moss.list-sessions': async () => ok((await listConversations()).map(toMossSession)),
  'moss.get-session': async (req) => {
    const found = (await listConversations()).find((c) => c.id === req?.sessionId)
    return found ? ok(toMossSession(found)) : fail('SESSION_NOT_FOUND')
  },
  'get-conversation': async (req) => {
    const found = (await listConversations()).find((c) => c.id === req?.id)
    return found ? toChatConversation(found) : undefined
  },
  'database.get-conversation-messages': async (req) => {
    const id = String(req?.conversation_id ?? '')
    const ctx = await apiFetch<{ messages?: unknown[] }>(`/api/conversations/${encodeURIComponent(id)}/context`)
    return ctx.messages ?? []
  },

  // --- create / update / delete ---
  'create-conversation': async (req) => {
    const created = await apiFetch<{ id: string }>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({
        assistantName: req?.extra?.agentName ?? req?.assistantName ?? '',
        enabledSkills: req?.extra?.enabledSkills ?? req?.enabledSkills ?? [],
      }),
    })
    ensureSessionStream(created.id)
    return toChatConversation({ id: created.id, assistantName: req?.extra?.agentName ?? null })
  },
  'moss.create-session': async (req) => {
    const created = await apiFetch<{ id: string }>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ assistantName: req?.assistantName ?? '', enabledSkills: [] }),
    })
    ensureSessionStream(created.id)
    return ok(toMossSession({ id: created.id, assistantName: req?.assistantName ?? null }))
  },
  'moss.resume-session': async (req) => {
    const sessionId = String(req?.sessionId ?? '')
    ensureSessionStream(sessionId)
    return ok({ wsUrl: wsUrlFor(sessionId), session: toMossSession({ id: sessionId }) })
  },
  'moss.update-session': async (req) => {
    const sessionId = String(req?.sessionId ?? '')
    await apiFetch(`/api/conversations/${encodeURIComponent(sessionId)}/meta`, {
      method: 'PATCH',
      body: JSON.stringify({ title: req?.title }),
    })
    return ok(toMossSession({ id: sessionId, title: req?.title ?? null }))
  },
  'update-conversation': async (req) => {
    const id = String(req?.id ?? '')
    const updates = (req?.updates ?? {}) as AnyReq
    const body: Record<string, unknown> = {}
    if (typeof updates.name === 'string') body.title = updates.name
    if (typeof updates?.extra?.pinned === 'boolean') body.pinned = updates.extra.pinned
    if (Object.keys(body).length > 0) {
      await apiFetch(`/api/conversations/${encodeURIComponent(id)}/meta`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }).catch(() => {})
    }
    return true
  },
  'moss.delete-session': async (req) => {
    await apiFetch(`/api/conversations/${encodeURIComponent(String(req?.sessionId ?? ''))}`, { method: 'DELETE' })
    return ok()
  },
  'remove-conversation': async (req) => {
    await apiFetch(`/api/conversations/${encodeURIComponent(String(req?.id ?? ''))}`, { method: 'DELETE' })
    return true
  },

  // --- models ---
  'mode.get-model-config': async () => [],
  'moss.get-available-models': async () => {
    const opts = await apiFetch<{ models: { id: string; name: string }[] }>('/api/conversations/options')
    return ok(opts.models.map((m) => ({ id: m.id, name: m.name, ratio: 1 })))
  },
  'moss.get-user-model': async () => ok(null),
  'moss.set-user-model': async (req) => ok({ modelId: String(req?.modelId ?? ''), updatedAt: Date.now() }),

  // --- chat send / control (over the session WS) ---
  'chat.send.message': async (req) => {
    const sessionId = String(req?.conversation_id ?? req?.sessionId ?? '')
    if (!sessionId) return fail('NO_SESSION')
    sendOverStream(sessionId, { kind: 'send', text: extractText(req) })
    return ok()
  },
  'moss.send-message': async (req) => {
    const sessionId = String(req?.sessionId ?? '')
    if (!sessionId) return fail('NO_SESSION')
    sendOverStream(sessionId, { kind: 'send', text: String(req?.content ?? '') })
    return ok()
  },
  'chat.stop.stream': async (req) => {
    sendOverStream(String(req?.conversation_id ?? ''), { kind: 'stop' })
    return ok()
  },
  'moss.stop': async (req) => {
    sendOverStream(String(req?.sessionId ?? ''), { kind: 'stop' })
    return ok()
  },
  'moss.set-model': async (req) => {
    sendOverStream(String(req?.sessionId ?? ''), { kind: 'set_model', modelId: String(req?.modelId ?? '') })
    return ok()
  },

  // --- misc surfaces the enterprise chat page touches early ---
  'conversation.get-slash-commands': async () => ok({ commands: [] }),
}

// ---------------------------------------------------------------------------
// Dispatch.
// ---------------------------------------------------------------------------

function handleInvoke(channel: string, id: string, req: unknown): void {
  const deliver = (result: unknown): void => {
    emitterRef?.emit('subscribe.callback-' + channel + id, result)
  }

  const storageMatch = STORAGE_RE.exec(channel)
  if (storageMatch) {
    const group = storageMatch[1] as string
    const op = storageMatch[2] as string
    try {
      if (op === 'get') {
        deliver(storageGet(group, String(req ?? '')))
      } else if (op === 'set') {
        const payload = (req ?? {}) as { key?: string; data?: unknown }
        storageSet(group, String(payload.key ?? ''), payload.data)
        deliver(undefined)
      } else if (op === 'remove') {
        storageRemove(group, String(req ?? ''))
        deliver(undefined)
      } else {
        storageClear(group)
        deliver(undefined)
      }
    } catch {
      deliver(undefined)
    }
    return
  }

  const handler = handlers[channel]
  if (handler) {
    handler((req ?? {}) as AnyReq)
      .then(deliver)
      .catch((err: unknown) => {
        console.warn('[mossAdapter] channel failed:', channel, err)
        deliver(fail(errMessage(err)))
      })
    return
  }

  if (!unmappedLogged.has(channel)) {
    unmappedLogged.add(channel)
    console.warn('[mossAdapter] no web mapping for channel (returning not-supported):', channel)
  }
  deliver(fail('not-supported-on-web'))
}

// ---------------------------------------------------------------------------
// Wire the transport (side effect).
// ---------------------------------------------------------------------------

bridge.adapter({
  emit(name: string, data: unknown) {
    try {
      if (typeof name === 'string' && name.startsWith('subscribe-')) {
        const channel = name.slice('subscribe-'.length)
        const env = (data ?? {}) as { id?: string; data?: unknown }
        handleInvoke(channel, String(env.id ?? ''), env.data)
      }
      // Non-`subscribe-` emits are renderer-side buildEmitter emits with no reply
      // contract; there is nothing to answer, so they are intentionally ignored.
    } catch (err) {
      console.warn('[mossAdapter] emit error:', err)
    }
  },
  on(emitter: BridgeEmitter) {
    emitterRef = emitter
  },
})
