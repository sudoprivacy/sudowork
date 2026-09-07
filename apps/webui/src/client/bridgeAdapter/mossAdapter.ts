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
// Canonical wire shape — one definition shared with the renderer + main, not a
// parallel copy.
import type { IBridgeResponse } from '@sudowork/host-bridge/ipcBridge'
import type { IConfirmation } from '@sudowork/common/chatLib'
// The moss-frame → IResponseMessage mapping is the SAME implementation the desktop
// MossWsConnection uses (shared leaf module, full stateless-frame coverage).
import {
  isUserAbortError,
  mossControlRequestToConfirmation,
  mossFrameToResponses,
} from '@sudowork/common/mossResponse'

interface BridgeEmitter {
  emit: (name: string, data: unknown) => void
}

type AnyReq = Record<string, unknown>

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

// Only durable renderer CONFIG is browser-persisted on web. The chat/message
// groups (agent.chat / agent.chat.message) are SERVER-OWNED — moss is their
// single source of truth — so we never shadow them in localStorage (that would
// persist ephemeral server state and create a second source). Their reads fall
// through to undefined; the renderer's data comes from the moss channels below.
const DURABLE_STORAGE_GROUPS = new Set(['agent.config', 'agent.env'])

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
  // A successful mutation to the conversation collection invalidates the cache.
  if (
    res.ok &&
    (init?.method ?? 'GET').toUpperCase() !== 'GET' &&
    path.startsWith('/api/conversations')
  ) {
    invalidateConversations()
  }
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
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof (body as { error?: unknown }).error === 'string'
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

// Per-session interactive state (browser memory, mirrors the desktop main-process
// maps; cleared with the session WS on close).
// - pending permission prompts shown through the renderer's confirmation UI
const pendingConfirmations = new Map<string, IConfirmation[]>()
// - pending AskUserQuestion cards keyed by toolCallId AND responseToolCallId
//   (mirrors desktop RemoteAgent.pendingQuestions double-keying)
const pendingQuestions = new Map<
  string,
  Map<string, { msgId: string; responseToolUseId?: string; toolCallId: string }>
>()
// - sessions whose last result was a user abort: trailing assistant frames are
//   suppressed until the user sends again (desktop models this as the connection
//   lifecycle; here the reset point is the next outbound send)
const abortedSessions = new Set<string>()

let __mid = 0
function nextMsgId(): string {
  __mid += 1
  return `web-${__mid}-${Math.random().toString(16).slice(2, 8)}`
}

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
    let frame: { kind?: string; event?: unknown; code?: string | number }
    try {
      frame = JSON.parse(String(ev.data))
    } catch {
      return
    }
    // The server wraps the moss stream in { kind: 'upstream', event }, where
    // `event` is an anthropic-style moss message. The renderer expects
    // IResponseMessage, so translate (mirrors the desktop MossWsConnection).
    if (frame && frame.kind === 'upstream' && frame.event) {
      // moss frame shapes are open-ended; narrow to the fields the branches below touch
      const event = frame.event as {
        type?: string
        request?: unknown
        request_id?: string
      }

      // Permission prompt → renderer confirmation card (mirrors desktop
      // RemoteAgent.handlePermissionRequest via the shared converter).
      if (event.type === 'control_request' && typeof event.request_id === 'string') {
        const confirmation: IConfirmation & { conversation_id: string } = {
          ...mossControlRequestToConfirmation(event.request, event.request_id),
          conversation_id: sessionId,
        }
        const list = pendingConfirmations.get(sessionId) ?? []
        list.push(confirmation)
        pendingConfirmations.set(sessionId, list)
        emitterRef?.emit('confirmation.add', confirmation)
        return
      }

      // User-abort tracking: suppress trailing assistant frames until the next send.
      if (event.type === 'result' && isUserAbortError(event)) {
        abortedSessions.add(sessionId)
      }
      if (event.type === 'assistant' && abortedSessions.has(sessionId)) {
        return
      }

      for (const msg of mossFrameToResponses(event, {
        sessionId,
        conversationId: sessionId,
        nextMsgId,
      })) {
        // Register pending question cards under BOTH ids (mirrors desktop
        // RemoteAgent.pendingQuestions double-keying) so the answer handler can
        // resolve the original msg_id for the "answered" update.
        if (msg.type === 'acp_question') {
          const data = msg.data as { toolCallId?: string; responseToolCallId?: string }
          if (data?.toolCallId) {
            const pending = {
              msgId: msg.msg_id,
              responseToolUseId: data.responseToolCallId,
              toolCallId: data.toolCallId,
            }
            const map =
              pendingQuestions.get(sessionId) ??
              new Map<string, { msgId: string; responseToolUseId?: string; toolCallId: string }>()
            map.set(data.toolCallId, pending)
            if (data.responseToolCallId) map.set(data.responseToolCallId, pending)
            pendingQuestions.set(sessionId, map)
          }
        }
        // The upstream acp_model_info only carries the current model (empty
        // availableModels); merge the cached list so a model_changed confirmation
        // does not flip the selector back to read-only.
        if (msg.type === 'acp_model_info' && cachedModels && cachedModels.length > 0) {
          const modelInfoData = msg.data as { availableModels?: unknown[] } | undefined
          if (!modelInfoData?.availableModels?.length) {
            msg.data = {
              ...modelInfoData,
              availableModels: cachedModels,
              canSwitch: cachedModels.length > 1,
            }
          }
        }
        emitterRef?.emit('chat.response.stream', msg)
        emitterRef?.emit('moss.response-stream', msg)
      }
    } else if (frame && frame.kind === 'error') {
      emitterRef?.emit('chat.response.stream', {
        type: 'error',
        msg_id: nextMsgId(),
        conversation_id: sessionId,
        data: String(frame.code ?? 'error'),
      })
    }
  })
  ws.addEventListener('close', () => {
    openStreams.delete(sessionId)
    pendingConfirmations.delete(sessionId)
    pendingQuestions.delete(sessionId)
    abortedSessions.delete(sessionId)
  })
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
// Model surface for the renderer's AcpModelSelector (web conversations project
// backend 'scode', so the selector's standard path consumes these channels).
// The upstream acp_model_info stream only carries the CURRENT model (empty list),
// so this side owns the available-models cache and merges it into stream frames
// to keep the selector switchable after a model_changed confirmation.
// ---------------------------------------------------------------------------

let cachedModels: Array<{ id: string; label: string }> | null = null

async function fetchAvailableModels(): Promise<Array<{ id: string; label: string }>> {
  const opts = await apiFetch<{ models: { id: string; name: string }[] }>(
    '/api/conversations/options',
  )
  const models = opts.models.map((m) => ({ id: m.id, label: m.name || m.id }))
  cachedModels = models
  return models
}

/** Current model with a three-level fallback mirroring the renderer's fetchMossModelInfo:
 *  conversation model → user preference → first available. */
async function resolveCurrentModelId(sessionId?: string): Promise<string> {
  if (sessionId) {
    const conv = await apiFetch<{ modelId: string | null }>(
      `/api/conversations/${encodeURIComponent(sessionId)}/model`,
    ).catch(() => null)
    if (conv?.modelId) return conv.modelId
  }
  const user = await apiFetch<{ modelId: string | null }>('/api/conversations/user-model').catch(
    () => null,
  )
  if (user?.modelId) return user.modelId
  return cachedModels?.[0]?.id ?? ''
}

function makeModelInfo(models: Array<{ id: string; label: string }>, currentModelId: string) {
  const match = models.find((m) => m.id === currentModelId)
  return {
    source: 'models',
    currentModelId,
    currentModelLabel: match?.label || currentModelId,
    canSwitch: models.length > 1,
    availableModels: models,
  }
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

// The list is read by get-conversation / moss.get-session / list-all, so an
// uncached impl re-fetches the whole collection on the critical open path.
// Short TTL + invalidation on any conversation mutation (see apiFetch).
let convCache: { at: number; items: ConversationListItem[] } | null = null
const CONV_CACHE_MS = 3000

function invalidateConversations(): void {
  convCache = null
}

async function listConversations(): Promise<ConversationListItem[]> {
  if (convCache && Date.now() - convCache.at < CONV_CACHE_MS) return convCache.items
  const { conversations } = await apiFetch<{ conversations: ConversationListItem[] }>(
    '/api/conversations',
  )
  convCache = { at: Date.now(), items: conversations }
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
  'database.get-user-conversations': async () =>
    (await listConversations()).map(toChatConversation),
  'moss.list-sessions': async () => ok((await listConversations()).map(toMossSession)),
  'moss.get-session': async (req) => {
    const found = (await listConversations()).find((c) => c.id === req?.sessionId)
    return found ? ok(toMossSession(found)) : fail('SESSION_NOT_FOUND')
  },
  'get-conversation': async (req) => {
    const found = (await listConversations()).find((c) => c.id === req?.id)
    if (!found) return undefined
    const conv = toChatConversation(found)
    // 会话模型回读：conversation_meta.model_id（renderer 以 extra.currentModelId 作 initialModelId）
    const model = await apiFetch<{ modelId: string | null }>(
      `/api/conversations/${encodeURIComponent(String(req?.id ?? ''))}/model`,
    ).catch(() => null)
    if (model?.modelId)
      conv.extra = { ...(conv.extra as Record<string, unknown>), currentModelId: model.modelId }
    return conv
  },
  'database.get-conversation-messages': async (req) => {
    const id = String(req?.conversation_id ?? '')
    const ctx = await apiFetch<{ messages?: unknown[] }>(
      `/api/conversations/${encodeURIComponent(id)}/context`,
    )
    return ctx.messages ?? []
  },

  // --- create / update / delete ---
  'create-conversation': async (req) => {
    // The renderer's enterprise agent label (e.g. "Remote Agent") is a UI name,
    // not a moss agent — passing it yields SELECTION_NOT_AVAILABLE. Let moss pick
    // its default agent (empty assistantName) unless a real moss agent id is given.
    const agent =
      typeof req?.assistantName === 'string' &&
      req.assistantName &&
      req.assistantName !== 'Remote Agent'
        ? req.assistantName
        : ''
    const created = await apiFetch<{ id: string }>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({
        assistantName: agent,
        enabledSkills:
          (req?.extra as { enabledSkills?: unknown } | undefined)?.enabledSkills ??
          req?.enabledSkills ??
          [],
      }),
    })
    ensureSessionStream(created.id)
    return toChatConversation({ id: created.id, assistantName: agent || null })
  },
  'moss.create-session': async (req) => {
    const created = await apiFetch<{ id: string }>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ assistantName: req?.assistantName ?? '', enabledSkills: [] }),
    })
    ensureSessionStream(created.id)
    return ok(
      toMossSession({
        id: created.id,
        assistantName: typeof req?.assistantName === 'string' ? req.assistantName : null,
      }),
    )
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
    return ok(
      toMossSession({ id: sessionId, title: typeof req?.title === 'string' ? req.title : null }),
    )
  },
  'update-conversation': async (req) => {
    const id = String(req?.id ?? '')
    const updates = (req?.updates ?? {}) as { name?: unknown; extra?: { pinned?: unknown } }
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
    await apiFetch(`/api/conversations/${encodeURIComponent(String(req?.sessionId ?? ''))}`, {
      method: 'DELETE',
    })
    return ok()
  },
  'remove-conversation': async (req) => {
    await apiFetch(`/api/conversations/${encodeURIComponent(String(req?.id ?? ''))}`, {
      method: 'DELETE',
    })
    return true
  },

  // --- models ---
  'mode.get-model-config': async () => [],
  'moss.get-available-models': async () => {
    const opts = await apiFetch<{ models: { id: string; name: string }[] }>(
      '/api/conversations/options',
    )
    return ok(opts.models.map((m) => ({ id: m.id, name: m.name, ratio: 1 })))
  },
  'moss.get-user-model': async () => {
    const data = await apiFetch<{ modelId: string | null }>('/api/conversations/user-model')
    return ok(data ?? { modelId: null })
  },
  'moss.set-user-model': async (req) => {
    const modelId = String(req?.modelId ?? '')
    await apiFetch('/api/conversations/user-model', {
      method: 'PUT',
      body: JSON.stringify({ modelId }),
    })
    return ok({ modelId, updatedAt: Date.now() })
  },

  // --- chat send / control (over the session WS) ---
  'chat.send.message': async (req) => {
    const sessionId = String(req?.conversation_id ?? req?.sessionId ?? '')
    if (!sessionId) return fail('NO_SESSION')
    abortedSessions.delete(sessionId)
    sendOverStream(sessionId, { kind: 'send', text: extractText(req) })
    return ok()
  },
  'moss.send-message': async (req) => {
    const sessionId = String(req?.sessionId ?? '')
    if (!sessionId) return fail('NO_SESSION')
    abortedSessions.delete(sessionId)
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
    sendOverStream(String(req?.sessionId ?? ''), {
      kind: 'set_model',
      modelId: String(req?.modelId ?? ''),
    })
    return ok()
  },

  // --- in-session model switch (renderer AcpModelSelector, non-remote-agent branch) ---
  'acp.set-model': async (req) => {
    const sessionId = String(req?.conversationId ?? '')
    const modelId = String(req?.modelId ?? '')
    if (!sessionId || !modelId) return fail('Invalid conversationId or modelId')
    if (!sendOverStream(sessionId, { kind: 'set_model', modelId })) return fail('NO_SESSION')
    return ok()
  },

  // --- AskUserQuestion answer loop (server already forwards answer_question) ---
  'acp.answer-question': async (req) => {
    const sessionId = String(req?.conversationId ?? '')
    if (!sessionId || typeof sessionId !== 'string') return fail('Invalid conversationId')
    const toolCallId = String(req?.toolCallId ?? '')
    if (!toolCallId) return fail('Invalid toolCallId')
    const answers = Array.isArray(req?.answers) ? req.answers : []
    if (answers.length === 0) return fail('answers must be a non-empty array')
    const text = answers
      .map((a: { value?: unknown }) => (typeof a?.value === 'string' ? a.value : ''))
      .filter(Boolean)
      .join('\n')
    if (!text) return fail('answers must contain non-empty values')
    if (!sendOverStream(sessionId, { kind: 'answer_question', parentToolUseId: toolCallId, text }))
      return fail('NO_SESSION')
    abortedSessions.delete(sessionId)

    // Flip the pending card to answered (mirrors desktop emitQuestionAnswered).
    // Without a registration (e.g. after a page refresh) the answer is still sent;
    // there is just no local card to update.
    const pending = pendingQuestions.get(sessionId)?.get(toolCallId)
    if (pending) {
      const map = pendingQuestions.get(sessionId)!
      map.delete(pending.toolCallId)
      if (pending.responseToolUseId) map.delete(pending.responseToolUseId)
      const answerItems = answers.map(
        (a: { id?: unknown; value?: unknown; label?: unknown }, index: number) => ({
          id: typeof a?.id === 'string' ? a.id : String(index + 1),
          index: index + 1,
          submissionValue: typeof a?.value === 'string' ? a.value : '',
          displayValue:
            (typeof a?.label === 'string' && a.label) ||
            (typeof a?.value === 'string' && a.value) ||
            '',
          skipped: a?.value === '[skipped]',
        }),
      )
      const selectedAnswer = answerItems
        .map((a) => `${a.index}. ${a.skipped ? '[skipped]' : a.displayValue}`)
        .join('\n')
      const answered = {
        type: 'acp_question',
        msg_id: pending.msgId,
        conversation_id: sessionId,
        data: { answered: true, selectedAnswer, answerItems },
      }
      emitterRef?.emit('chat.response.stream', answered)
      emitterRef?.emit('moss.response-stream', answered)
    }
    return ok()
  },

  // --- permission approval loop (renderer confirmation card) ---
  'confirmation.confirm': async (req) => {
    const sessionId = String(req?.conversation_id ?? '')
    if (
      !sendOverStream(sessionId, {
        kind: 'control_response',
        requestId: String(req?.callId ?? ''),
        optionId: String(req?.data ?? ''),
      })
    ) {
      return fail('NO_SESSION')
    }
    const list = pendingConfirmations.get(sessionId)
    if (list)
      pendingConfirmations.set(
        sessionId,
        list.filter((c) => c.id !== req?.msg_id),
      )
    emitterRef?.emit('confirmation.remove', {
      conversation_id: sessionId,
      id: String(req?.msg_id ?? ''),
    })
    return ok()
  },

  // --- model surface for the renderer's AcpModelSelector (scode projection path) ---
  'acp.get-model-info': async (req) => {
    const models = await fetchAvailableModels()
    if (models.length === 0) return ok({ modelInfo: null })
    const currentModelId = await resolveCurrentModelId(String(req?.conversationId ?? ''))
    return ok({ modelInfo: makeModelInfo(models, currentModelId) })
  },

  'scode.refresh-models': async () => {
    const models = await fetchAvailableModels()
    const currentModelId = await resolveCurrentModelId()
    // data is checked by the renderer (result.success && result.data) — must be a
    // real AcpModelInfo, never a bare ok().
    return ok({ modelInfo: makeModelInfo(models, currentModelId) })
  },

  // --- misc surfaces the enterprise chat page touches early ---
  'conversation.get-slash-commands': async () => ok({ commands: [] }),

  // --- desktop-only surfaces reached on load (e.g. the sidebar's cron access
  //     probe). These return RAW arrays, so the default-reject object would
  //     crash array consumers (`jobs.filter is not a function`). The features
  //     are gated/absent on web, so answer with safe empties. ---
  'cron.list-jobs': async () => [],
  'cron.list-jobs-by-conversation': async () => [],
  // The conversation view loads these on open; they return RAW arrays, so the
  // default-reject object breaks array consumers ("data is not iterable").
  'confirmation.list': async (req) =>
    pendingConfirmations.get(String(req?.conversation_id ?? '')) ?? [],
  'approval.check': async () => false,
  'acp.get-mode': async () => ok({ mode: 'default', initialized: true }),
  'conversation.flush-pending-messages': async () => undefined,
}

// ---------------------------------------------------------------------------
// Dispatch.
// ---------------------------------------------------------------------------

function handleInvoke(channel: string, id: string, req: unknown): void {
  // Defer to a microtask: `invoke()` emits the request and THEN registers the
  // callback listener, both synchronously. A synchronous deliver (the
  // localStorage-backed storage ops) would fire the callback before that
  // listener exists → the invoke hangs (this stuck the app-mode prime). The
  // async-mapped handlers already resolve on a later tick; deferring uniformly
  // guarantees the listener is registered first for every branch.
  const deliver = (result: unknown): void => {
    queueMicrotask(() => emitterRef?.emit('subscribe.callback-' + channel + id, result))
  }

  const storageMatch = STORAGE_RE.exec(channel)
  if (storageMatch) {
    const group = storageMatch[1] as string
    const op = storageMatch[2] as string
    if (!DURABLE_STORAGE_GROUPS.has(group)) {
      // Server-owned group (chat/messages): don't browser-persist. get -> no
      // local cache; set/remove/clear -> no-op. moss is the SSOT for this data.
      deliver(undefined)
      return
    }
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
