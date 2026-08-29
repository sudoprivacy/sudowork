import { z } from 'zod'
import type { Pool } from 'pg'
import type { AppConfig } from '../../config.js'
import type { AuthDeps } from '../auth/authService.js'
import type { Principal } from '../auth/principalRepository.js'
import type { MossSessionPort } from '../../moss/MossSessionClient.js'
import { type MossFetch, MossHttpError, MossNetworkError } from '../../moss/MossHttpClient.js'
import type {
  ConversationListItem,
  CreateConversationRequest,
} from '../../../shared/contracts/conversations.js'
import type { ConversationCoordinator } from './ConversationCoordinator.js'

/**
 * 会话服务（计划 3.3/3.10）：
 * - 列表/单项访问强制过滤 session.userId === 当前 moss_user_id
 * - Agent/Skill 提交前重新核验当前可见列表（不接受浏览器自造名字）
 * - 浏览器 DTO 严格白名单：不出 ws_url/work_dir/cwd/fullPath/Moss origin
 */

export class SessionNotFoundError extends Error {}
export class SessionForbiddenError extends Error {}
export class MossUnavailableError extends Error {}
export class InvalidSelectionError extends Error {
  constructor(readonly field: 'assistantName' | 'enabledSkills', readonly value: string) {
    super(`${field} not in current visible list: ${value}`)
  }
}

export interface ConversationDeps {
  pool: Pool
  config: AppConfig
  auth: AuthDeps
  moss: MossSessionPort
  mossFetch: MossFetch
  coordinator: ConversationCoordinator
}

const NameListSchema = z.array(z.object({ name: z.string() }).passthrough())

async function fetchVisibleNames(
  deps: ConversationDeps,
  path: '/api/v1/agents/installed' | '/api/v1/skills/installed',
  accessToken: string,
): Promise<Set<string>> {
  const json = await deps.mossFetch(deps.config.moss.baseUrl, { method: 'GET', path, accessToken })
  const parsed = NameListSchema.parse(json)
  return new Set(parsed.map((item) => item.name))
}

/** 计划 3.4/3.10：提交前核验 Agent/Skill 名字在当前用户 fresh 可见列表中。 */
async function assertSelectionVisible(
  deps: ConversationDeps,
  input: CreateConversationRequest,
  accessToken: string,
): Promise<void> {
  if (input.assistantName) {
    const names = await fetchVisibleNames(deps, '/api/v1/agents/installed', accessToken)
    if (!names.has(input.assistantName)) {
      throw new InvalidSelectionError('assistantName', input.assistantName)
    }
  }
  if (input.enabledSkills.length > 0) {
    const names = await fetchVisibleNames(deps, '/api/v1/skills/installed', accessToken)
    for (const skill of input.enabledSkills) {
      if (!names.has(skill)) {
        throw new InvalidSelectionError('enabledSkills', skill)
      }
    }
  }
}

export async function listConversations(
  deps: ConversationDeps,
  principal: Principal,
  accessToken: string,
): Promise<ConversationListItem[]> {
  const sessions = await mapMossErrors(() => deps.moss.list(accessToken))
  // 强制过滤：即使 token 带 sessions:list:any 也只返回本人会话（计划 3.3）
  return sessions
    .filter((s) => s.userId === principal.mossUserId && s.orgId === principal.orgId)
    .map((s) => ({
      id: s.sessionId,
      status: s.status,
      assistantName: s.assistantName ?? null,
      source: s.source ?? null,
      lastActiveAt: typeof (s as { lastActiveAt?: unknown }).lastActiveAt === 'number'
        ? (s as { lastActiveAt?: number }).lastActiveAt!
        : null,
    }))
}

export async function createConversation(
  deps: ConversationDeps,
  _principal: Principal,
  input: CreateConversationRequest,
  accessToken: string,
): Promise<{ id: string }> {
  await assertSelectionVisible(deps, input, accessToken)
  const created = await mapMossErrors(() =>
    deps.moss.create(accessToken, {
      assistantName: input.assistantName,
      enabledSkills: input.enabledSkills,
    }),
  )
  // ws_url 只留在服务端（协调器 resume 时使用）
  return { id: created.sessionId }
}

/** 计划 3.3：打开会话先重新查询该 Session 并校验归属。 */
async function requireOwnSession(
  deps: ConversationDeps,
  principal: Principal,
  sessionId: string,
  accessToken: string,
): Promise<void> {
  const session = await mapMossErrors(() => deps.moss.get(accessToken, sessionId))
  if (!session) throw new SessionNotFoundError()
  if (session.userId !== principal.mossUserId || session.orgId !== principal.orgId) {
    throw new SessionForbiddenError()
  }
}

export async function getContext(
  deps: ConversationDeps,
  principal: Principal,
  sessionId: string,
  accessToken: string,
): Promise<{ customTitle: string | null; messages: Record<string, unknown>[] }> {
  await requireOwnSession(deps, principal, sessionId, accessToken)
  let parsed: unknown
  try {
    parsed = await deps.moss.context(accessToken, sessionId)
  } catch (err) {
    if (err instanceof MossHttpError && err.status === 404) {
      // 空 transcript（新会话）上游返回 404
      return { customTitle: null, messages: [] }
    }
    throw err
  }
  const ctx = (parsed as { context?: { customTitle?: string; messages?: unknown[] } }).context
  const messages = (ctx?.messages ?? []).map((raw) => sanitizeMessage(raw))
  return { customTitle: ctx?.customTitle ?? null, messages }
}

const SENSITIVE_MESSAGE_KEYS = ['cwd', 'workDir', 'fullPath', 'work_dir']

function sanitizeMessage(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {}
  const clone: Record<string, unknown> = { ...(raw as Record<string, unknown>) }
  for (const key of SENSITIVE_MESSAGE_KEYS) {
    delete clone[key]
  }
  return clone
}

export async function terminateConversation(
  deps: ConversationDeps,
  principal: Principal,
  sessionId: string,
  accessToken: string,
): Promise<void> {
  await requireOwnSession(deps, principal, sessionId, accessToken)
  await mapMossErrors(() => deps.moss.terminate(accessToken, sessionId))
  await deps.coordinator.terminate(principal.id, sessionId)
}

export interface ConversationOptions {
  models: { id: string; name: string }[]
  agents: { name: string }[]
  skills: { name: string }[]
}

export async function getConversationOptions(
  deps: ConversationDeps,
  accessToken: string,
): Promise<ConversationOptions> {
  const baseUrl = deps.config.moss.baseUrl
  const [modelsJson, agentsJson, skillsJson] = await Promise.all(
    [
      deps.mossFetch(baseUrl, { method: 'GET', path: '/api/v1/models/available', accessToken }),
      deps.mossFetch(baseUrl, { method: 'GET', path: '/api/v1/agents/installed', accessToken }),
      deps.mossFetch(baseUrl, { method: 'GET', path: '/api/v1/skills/installed', accessToken }),
    ].map((p) => mapMossErrors(() => p)),
  )

  const models = z
    .object({ data: z.array(z.object({ id: z.string(), name: z.string().optional() }).passthrough()) })
    .passthrough()
    .parse(modelsJson)
  const agents = NameListSchema.parse(agentsJson)
  const skills = NameListSchema.parse(skillsJson)

  return {
    models: models.data.map((m) => ({ id: m.id, name: m.name ?? m.id })),
    agents: agents.map((a) => ({ name: a.name })),
    skills: skills.map((s) => ({ name: s.name })),
  }
}

// ---------- workspace（DTO 白名单：node 去 fullPath，计划 3.10） ----------

export async function getWorkspaceTree(
  deps: ConversationDeps,
  principal: Principal,
  sessionId: string,
  path: string,
  accessToken: string,
): Promise<unknown> {
  await requireOwnSession(deps, principal, sessionId, accessToken)
  const tree = await mapMossErrors(() => deps.moss.workspaceTree(accessToken, sessionId, path))
  return sanitizeWorkspaceNode(tree)
}

function sanitizeWorkspaceNode(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node
  const clone: Record<string, unknown> = { ...(node as Record<string, unknown>) }
  delete clone.fullPath
  if (Array.isArray(clone.children)) {
    clone.children = clone.children.map((child) => sanitizeWorkspaceNode(child))
  }
  return clone
}

export async function getWorkspaceFile(
  deps: ConversationDeps,
  principal: Principal,
  sessionId: string,
  path: string,
  accessToken: string,
): Promise<unknown> {
  await requireOwnSession(deps, principal, sessionId, accessToken)
  return mapMossErrors(() => deps.moss.workspaceFileGet(accessToken, sessionId, path))
}

export async function uploadWorkspaceFile(
  deps: ConversationDeps,
  principal: Principal,
  sessionId: string,
  path: string,
  contentBase64: string,
  accessToken: string,
): Promise<unknown> {
  await requireOwnSession(deps, principal, sessionId, accessToken)
  const decodedBytes = Math.floor((contentBase64.length * 3) / 4)
  if (decodedBytes > deps.config.upload.maxFileBytes) {
    throw new Error('FILE_TOO_LARGE')
  }
  return mapMossErrors(() => deps.moss.workspaceFilePost(accessToken, sessionId, path, contentBase64))
}

function mapMossErrors<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err: unknown) => {
    if (err instanceof MossNetworkError) {
      throw new MossUnavailableError()
    }
    if (err instanceof MossHttpError && err.status === 404) {
      throw new SessionNotFoundError()
    }
    throw err
  })
}
