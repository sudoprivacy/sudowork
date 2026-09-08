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

declare global {
  interface Window {
    /** Set by this adapter to mark a shared-renderer web host (read by the renderer's isWebBridgeAvailable). */
    __sudoworkWebBridge?: boolean
  }
}

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

// The renderer's enterprise login and MCP client read `eeclaw.serverUrl` before
// doing anything; seed it with this origin so those paths resolve against the
// webui server (the web transport ignores the value and stays same-origin).
if (typeof window !== 'undefined' && storageGet('agent.config', 'eeclaw.serverUrl') === undefined) {
  storageSet('agent.config', 'eeclaw.serverUrl', window.location.origin)
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

/** Moss installed-agent row as projected by GET /api/agents. */
interface MossAgentItem {
  id?: string
  name: string
  displayName?: string
  display_name?: string
  description?: string
  avatar?: string
  emoji?: string
  /** 'hub' | 'custom' | 'system' | 'tenant' (absent for user-created rows) */
  tag?: string
  isBuiltin?: boolean
  enabled?: boolean
  categories?: string[]
}

/** Moss installed-skill row as projected by GET /api/skills. */
interface MossSkillItem {
  id?: string
  name: string
  version?: string
  description?: string
  display_name?: string
  displayName?: string
  enabled?: boolean
  isBuiltin?: boolean
  isHubInstalled?: boolean
  category?: string
  categories?: string[]
  meta?: Record<string, unknown>
}

type WebAssistantCategory = 'custom' | 'hub' | 'system' | 'tenant'

function toWebCategory(tag: unknown): WebAssistantCategory {
  return tag === 'hub' || tag === 'system' || tag === 'tenant' ? tag : 'custom'
}

/** moss agent row → renderer IAssistantInfo (see assistantTypes.ts). Wire is untyped. */
function mossAgentToAssistantInfo(a: MossAgentItem): unknown {
  const displayName = a.displayName ?? a.display_name ?? a.name
  return {
    id: a.id,
    name: a.name,
    isBuiltin: a.isBuiltin === true,
    isHubInstalled: a.tag === 'hub',
    enabled: a.enabled !== false,
    category: toWebCategory(a.tag),
    meta: {
      id: a.id,
      name: a.name,
      display_name: displayName,
      description: a.description,
      avatar: a.avatar,
      emoji: a.emoji ?? null,
      categories: Array.isArray(a.categories) ? a.categories : undefined,
      tag: typeof a.tag === 'string' ? a.tag : undefined,
      source_type: typeof a.tag === 'string' ? a.tag : 'custom',
      is_builtin: a.isBuiltin === true,
    },
  }
}

/** moss skill row → renderer IInstalledSkillInfo (see ipcBridge IInstalledSkillInfo). Wire is untyped. */
function mossSkillToInstalledInfo(s: MossSkillItem): unknown {
  const isHub = s.isHubInstalled === true
  const rawMeta = (s.meta && typeof s.meta === 'object' ? s.meta : {}) as Record<string, unknown>
  const displayName = s.display_name ?? s.displayName ?? s.name
  return {
    name: s.name,
    version: String(s.version ?? ''),
    isHubInstalled: isHub,
    isBuiltin: s.isBuiltin === true,
    enabled: s.enabled !== false,
    category: toWebCategory(s.category),
    meta: {
      ...rawMeta,
      id: rawMeta.id ?? s.id ?? s.name,
      name: s.name,
      display_name: rawMeta.display_name ?? displayName,
      description: rawMeta.description ?? s.description ?? '',
      // Fallback keeps the renderer's `source_type === 'hub'` branch honest even
      // when moss omits it on non-hub rows.
      source_type: rawMeta.source_type ?? (isHub ? 'hub' : 'system'),
      categories: rawMeta.categories ?? (Array.isArray(s.categories) ? s.categories : []),
    },
  }
}

// ---------------------------------------------------------------------------
// Cron schedule conversion. The renderer's ICronSchedule is a discriminated
// union (atMs/everyMs/expr); the moss/server ScheduleSchema is a flat
// {kind, value, tz?, description?}. These two pure functions round-trip it, and
// are exercised by a round-trip unit test.
// ---------------------------------------------------------------------------

type ServerSchedule = {
  kind: 'at' | 'every' | 'cron'
  value: string
  tz?: string
  description?: string
}
type RendererSchedule =
  | { kind: 'at'; atMs: number; description: string }
  | { kind: 'every'; everyMs: number; description: string }
  | { kind: 'cron'; expr: string; tz?: string; description: string }

const DURATION_UNITS: Array<[string, number]> = [
  ['d', 86_400_000],
  ['h', 3_600_000],
  ['m', 60_000],
  ['s', 1000],
  ['ms', 1],
]

/**
 * everyMs → a duration string. Console encodes minutes ('60m' for hourly), so we
 * prefer minutes, then whole seconds, then raw ms — never hours/days (durationToMs
 * still parses those, for moss values authored elsewhere).
 */
export function msToDuration(ms: number): string {
  if (ms % 60_000 === 0 && ms >= 60_000) return `${ms / 60_000}m`
  if (ms % 1000 === 0 && ms >= 1000) return `${ms / 1000}s`
  return `${ms}ms`
}

/** '60m' | '2h' | plain ms → milliseconds. NaN-safe (0 on failure). */
export function durationToMs(value: string): number {
  const m = /^(\d+)(ms|s|m|h|d)?$/.exec(value.trim())
  if (!m) return 0
  const n = Number(m[1])
  const unit = m[2] ?? 'ms'
  const size = DURATION_UNITS.find(([u]) => u === unit)?.[1] ?? 1
  return Number.isFinite(n) ? n * size : 0
}

export function rendererScheduleToServer(schedule: RendererSchedule): ServerSchedule {
  if (schedule.kind === 'at') {
    return { kind: 'at', value: String(schedule.atMs), description: schedule.description }
  }
  if (schedule.kind === 'every') {
    return {
      kind: 'every',
      value: msToDuration(schedule.everyMs),
      description: schedule.description,
    }
  }
  return { kind: 'cron', value: schedule.expr, tz: schedule.tz, description: schedule.description }
}

export function serverScheduleToRenderer(raw: unknown): RendererSchedule {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<ServerSchedule>
  const description = typeof s.description === 'string' ? s.description : ''
  const value = typeof s.value === 'string' ? s.value : ''
  if (s.kind === 'at') {
    // Console never emits 'at'; moss value may be epoch-ms or an ISO string.
    const n = Number(value)
    const atMs = Number.isFinite(n) && value !== '' ? n : Date.parse(value) || 0
    return { kind: 'at', atMs, description }
  }
  if (s.kind === 'every') {
    return { kind: 'every', everyMs: durationToMs(value), description }
  }
  return { kind: 'cron', expr: value, tz: typeof s.tz === 'string' ? s.tz : undefined, description }
}

/** moss cron job row (transparent passthrough) → renderer ICronJob. Wire is untyped. */
function toIcronJob(raw: unknown): unknown {
  const j = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined
  const createdAt = num(j.createdAt ?? j.created_at) ?? Date.now()
  const updatedAt = num(j.updatedAt ?? j.updated_at) ?? createdAt
  return {
    id: String(j.id ?? ''),
    name: String(j.name ?? ''),
    enabled: j.enabled !== false,
    schedule: serverScheduleToRenderer(j.schedule),
    target: { payload: { kind: 'message', text: String(j.payloadMessage ?? '') } },
    metadata: {
      conversationId: j.boundSessionId != null ? String(j.boundSessionId) : '',
      agentType: typeof j.assistantName === 'string' ? j.assistantName : '',
      createdBy: 'user',
      createdAt,
      updatedAt,
      conversationMode: j.conversationMode === 'reuse' ? 'reuse' : 'new',
    },
    state: {
      nextRunAtMs: num(j.nextRunAtMs ?? j.nextRunAt),
      lastRunAtMs: num(j.lastRunAtMs ?? j.lastRunAt),
      runCount: num(j.runCount) ?? 0,
      retryCount: num(j.retryCount) ?? 0,
      maxRetries: num(j.maxRetries) ?? 0,
    },
  }
}

/** renderer ICreateCronJobParams / Partial<ICronJob> updates → server strict body. */
function cronCreateBody(req: AnyReq): Record<string, unknown> {
  const schedule = req?.schedule as RendererSchedule | undefined
  const conversationId = typeof req?.conversationId === 'string' ? req.conversationId : ''
  const agentType = typeof req?.agentType === 'string' ? req.agentType : ''
  const body: Record<string, unknown> = {
    name: String(req?.name ?? ''),
    payloadMessage: String(req?.message ?? ''),
  }
  if (schedule) body.schedule = rendererScheduleToServer(schedule)
  if (req?.conversationMode === 'new' || req?.conversationMode === 'reuse') {
    body.conversationMode = req.conversationMode
  }
  body.boundSessionId = conversationId || null
  if (agentType) body.assistantName = agentType
  return body
}

/**
 * Runs a cron call and, on failure, returns the desktop bridge's `{ __error }`
 * envelope instead of rejecting — matching what `unwrapCronResult` and the
 * useCronAccess probe expect (a non-array on failure, never a thrown invoke).
 */
async function cronResult<T>(fn: () => Promise<T>): Promise<T | { __error: string }> {
  try {
    return await fn()
  } catch (err) {
    return { __error: errMessage(err) }
  }
}

/** renderer Partial<ICronJob> (update-job) → server strict patch body (only known fields). */
function cronUpdateBody(updates: AnyReq): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (typeof updates?.name === 'string') body.name = updates.name
  if (typeof updates?.enabled === 'boolean') body.enabled = updates.enabled
  const schedule = updates?.schedule as RendererSchedule | undefined
  if (schedule) body.schedule = rendererScheduleToServer(schedule)
  const target = updates?.target as { payload?: { text?: unknown } } | undefined
  if (typeof target?.payload?.text === 'string') body.payloadMessage = target.payload.text
  const metadata = updates?.metadata as { conversationMode?: unknown } | undefined
  if (metadata?.conversationMode === 'new' || metadata?.conversationMode === 'reuse') {
    body.conversationMode = metadata.conversationMode
  }
  return body
}

const handlers: Record<string, (req: AnyReq) => Promise<unknown>> = {
  // --- enterprise/session flags ---
  'moss.is-enterprise-mode': async () => true,
  'moss.get-config': async () => ({ serverUrl: location.origin, hasToken: true }),
  'moss.set-auth-token': async () => ok(),

  // --- eeclaw tenancy: tenant config / profile / cloud assistants ---
  'eeclaw.verify-server': async () => {
    const about = await apiFetch<{ branding?: { appName?: string; logo?: string } }>(
      '/api/settings/about',
    ).catch(() => null)
    // TenantConfigData has no cron/policy flags; the consumer's
    // resolveTenantConfig fills every null with DEFAULT_TENANT_CONFIG, which
    // is exactly what unblocks the cron access chain on the web host.
    return ok({
      id: location.origin,
      logo: about?.branding?.logo ?? null,
      app_name: about?.branding?.appName ?? null,
      top_name: about?.branding?.appName ?? null,
      about_name: about?.branding?.appName ?? null,
      app_company_name: null,
      login_desp: null,
      updated_at: Date.now(),
    })
  },
  'eeclaw.get-user-profile': async () => {
    // Same lenient field rules as the console ProfilePage (moss may return
    // snake_case or camelCase depending on version).
    const raw = await apiFetch<Record<string, unknown>>('/api/settings/profile').catch(() => null)
    const p = ((raw && typeof raw === 'object' ? ((raw as { data?: unknown }).data ?? raw) : {}) ??
      {}) as {
      username?: unknown
      name?: unknown
      displayName?: unknown
      department?: unknown
      departmentName?: unknown
      role?: unknown
      usage?: Record<string, unknown>
    }
    const usage = (p.usage ?? {}) as Record<string, unknown>
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    return ok({
      username: String(p.username ?? p.name ?? p.displayName ?? '—'),
      department: String(p.department ?? p.departmentName ?? '—'),
      role: String(p.role ?? 'user'),
      usage: {
        input_tokens: num(usage.input_tokens),
        output_tokens: num(usage.output_tokens),
        total_tokens: num(usage.total_tokens ?? usage.totalTokens),
        session_count: num(usage.session_count ?? usage.sessionCount),
      },
    })
  },
  'eeclaw.get-cloud-assistants': async () => {
    const agents = await apiFetch<MossAgentItem[]>('/api/agents').catch(() => [] as MossAgentItem[])
    // key/name/avatar/emoji/description satisfy the channel type; the extra
    // isBuiltin/isHubInstalled/sourceType fields feed the guid selector's
    // isSelectableCloudAssistant filter (it drops rows without them).
    return ok(
      (Array.isArray(agents) ? agents : []).map((a) => ({
        key: a.name,
        name: String(a.displayName ?? a.display_name ?? a.name),
        avatar: typeof a.avatar === 'string' ? a.avatar : undefined,
        emoji: typeof a.emoji === 'string' ? a.emoji : undefined,
        description: typeof a.description === 'string' ? a.description : undefined,
        isBuiltin: a.isBuiltin === true,
        isHubInstalled: a.tag === 'hub',
        sourceType: typeof a.tag === 'string' ? a.tag : undefined,
      })),
    )
  },

  // --- assistant-hub: installed agents (management page) ---
  'assistant-hub.get-installed-assistants': async () => {
    const agents = await apiFetch<MossAgentItem[]>('/api/agents').catch(() => [] as MossAgentItem[])
    return ok((Array.isArray(agents) ? agents : []).map(mossAgentToAssistantInfo))
  },
  // with-visibility ignores accessToken: the server already scopes rows by session.
  'assistant-hub.get-installed-assistants-with-visibility': async () => {
    const agents = await apiFetch<MossAgentItem[]>('/api/agents').catch(() => [] as MossAgentItem[])
    return ok((Array.isArray(agents) ? agents : []).map(mossAgentToAssistantInfo))
  },
  'assistant-hub.create-assistant': async (req) => {
    // CreateAgentRequestSchema (name/displayName/description?/avatar?/prompt?) is
    // not .strict(): zod strips unknown keys, so we send only the minimal set.
    const meta = (req?.meta ?? {}) as Record<string, unknown>
    const name = String(meta.name ?? '')
    const displayName = String(meta.display_name ?? meta.name ?? '')
    await apiFetch('/api/agents/create', {
      method: 'POST',
      body: JSON.stringify({
        name,
        displayName,
        description: typeof meta.description === 'string' ? meta.description : undefined,
        avatar: typeof meta.avatar === 'string' ? meta.avatar : undefined,
        prompt: typeof req?.ruleContent === 'string' ? req.ruleContent : undefined,
      }),
    })
    return ok()
  },
  'assistant-hub.uninstall-assistant': async (req) => {
    await apiFetch('/api/agents/uninstall', {
      method: 'POST',
      body: JSON.stringify({ name: String(req?.name ?? '') }),
    })
    return ok()
  },

  // --- skill-hub: installed skills (management page) ---
  'skill-hub.get-installed-skills': async () => {
    const skills = await apiFetch<MossSkillItem[]>('/api/skills').catch(() => [] as MossSkillItem[])
    return ok((Array.isArray(skills) ? skills : []).map(mossSkillToInstalledInfo))
  },
  'skill-hub.set-skill-enabled': async (req) => {
    await apiFetch('/api/skills/enabled', {
      method: 'PATCH',
      body: JSON.stringify({ name: String(req?.skillName ?? ''), enabled: req?.enabled === true }),
    })
    return ok()
  },
  'skill-hub.uninstall-skill': async (req) => {
    await apiFetch('/api/skills/uninstall', {
      method: 'POST',
      body: JSON.stringify({ name: String(req?.skillName ?? '') }),
    })
    return ok()
  },

  // --- extensions: web host has no local extension host; consumers tolerate []. ---
  'extensions.get-assistants': async () => [],
  'extensions.get-acp-adapters': async () => [],

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

  // --- cron: all providers are RAW (no ok() envelope). On failure they return
  //     the SAME `{ __error }` shape the desktop main-process bridge uses, so
  //     `unwrapCronResult` throws for callers and `Array.isArray` stays false for
  //     the useCronAccess probe. GET /api/cron returns {jobs,canCreate,...}. ---
  'cron.list-jobs': async () =>
    cronResult(async () => {
      const res = await apiFetch<{ jobs?: unknown[] }>('/api/cron')
      return (Array.isArray(res.jobs) ? res.jobs : []).map(toIcronJob)
    }),
  'cron.list-jobs-by-conversation': async (req) =>
    cronResult(async () => {
      const conversationId = String(req?.conversationId ?? '')
      const res = await apiFetch<{ jobs?: unknown[] }>('/api/cron')
      return (Array.isArray(res.jobs) ? res.jobs : [])
        .map(toIcronJob)
        .filter(
          (j) =>
            (j as { metadata?: { conversationId?: string } }).metadata?.conversationId ===
            conversationId,
        )
    }),
  'cron.get-job': async (req) =>
    cronResult(async () => {
      const job = await apiFetch<unknown>(
        `/api/cron/${encodeURIComponent(String(req?.jobId ?? ''))}`,
      )
      return job ? toIcronJob(job) : null
    }),
  'cron.add-job': async (req) =>
    cronResult(async () => {
      const job = await apiFetch<unknown>('/api/cron', {
        method: 'POST',
        body: JSON.stringify(cronCreateBody(req)),
      })
      return toIcronJob(job)
    }),
  'cron.update-job': async (req) =>
    cronResult(async () => {
      const jobId = encodeURIComponent(String(req?.jobId ?? ''))
      const job = await apiFetch<unknown>(`/api/cron/${jobId}`, {
        method: 'PATCH',
        body: JSON.stringify(cronUpdateBody((req?.updates ?? {}) as AnyReq)),
      })
      return toIcronJob(job)
    }),
  'cron.remove-job': async (req) =>
    cronResult(async () => {
      await apiFetch(`/api/cron/${encodeURIComponent(String(req?.jobId ?? ''))}`, {
        method: 'DELETE',
      })
      return undefined
    }),
  'cron.trigger-job': async (req) =>
    cronResult(async () => {
      await apiFetch(`/api/cron/${encodeURIComponent(String(req?.jobId ?? ''))}/trigger`, {
        method: 'POST',
      })
      return undefined
    }),
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

// Marks this window as a shared-renderer web host. The renderer's
// `isWebBridgeAvailable()` reads it to relax desktop-only data guards; desktop
// never loads this module, so the flag (and every guard keyed on it) stays
// inert there.
if (typeof window !== 'undefined') {
  window.__sudoworkWebBridge = true
}

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
