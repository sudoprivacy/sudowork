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
import {
  deleteConversationMeta as deleteConversationMetaRow,
  getConversationMeta,
  getConversationMetaMap,
  reorderPinnedConversations as reorderPinnedRows,
  updateConversationMeta as updateConversationMetaRow,
  upsertConversationTitle,
} from './conversationMetaRepository.js'

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
  /** DELETE 会话时关闭该会话全部服务器 pty（app.ts 注入；测试可不传） */
  closeTerminals?: (conversationId: string) => void
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
  // 强制过滤：即使 token 带 sessions:list:any 也只返回本人会话（计划 3.3）；
  // 并过滤 terminated（部署版实测 terminate 后 list 仍返回该会话，不过滤则用户视角「删除无效」）
  const visible = sessions.filter(
    (s) => s.userId === principal.mossUserId && s.orgId === principal.orgId && s.status !== 'terminated',
  )
  const metaMap = await getConversationMetaMap(
    deps.pool,
    principal.id,
    visible.map((s) => s.sessionId),
  )
  return visible.map((s) => {
    const meta = metaMap.get(s.sessionId)
    return {
      id: s.sessionId,
      status: s.status,
      assistantName: s.assistantName ?? null,
      source: s.source ?? null,
      lastActiveAt: typeof (s as { lastActiveAt?: unknown }).lastActiveAt === 'number'
        ? (s as { lastActiveAt?: number }).lastActiveAt!
        : null,
      title: meta?.title ?? null,
      pinned: meta?.pinned ?? false,
      pinnedAt: meta?.pinnedAt ?? null,
    }
  })
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
export async function requireOwnSession(
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
): Promise<{ customTitle: string | null; title: string | null; messages: Record<string, unknown>[] }> {
  await requireOwnSession(deps, principal, sessionId, accessToken)
  const localTitle = async (): Promise<string | null> =>
    (await getConversationMeta(deps.pool, principal.id, sessionId))?.title ?? null
  let parsed: unknown
  try {
    parsed = await deps.moss.context(accessToken, sessionId)
  } catch (err) {
    if (err instanceof MossHttpError && err.status === 404) {
      // 空 transcript（新会话）上游返回 404
      return { customTitle: null, title: await localTitle(), messages: [] }
    }
    throw err
  }
  const ctx = (parsed as { context?: { customTitle?: string; messages?: unknown[] } }).context
  const messages = (ctx?.messages ?? []).map((raw) => sanitizeMessage(raw))
  await generateTitleIfMissing(deps, principal, sessionId, messages)
  return { customTitle: ctx?.customTitle ?? null, title: await localTitle(), messages }
}

/**
 * 标题自动生成（对齐 Sudowork useAutoTitle：首条 user 消息首行前 50 字符，剥 <think>）。
 * 失败隔离：写库失败仅告警不影响 getContext 返回（context 接口 5s 轮询，抛错会让接口 500）。
 */
async function generateTitleIfMissing(
  deps: ConversationDeps,
  principal: Principal,
  sessionId: string,
  messages: Record<string, unknown>[],
): Promise<void> {
  try {
    const meta = await getConversationMeta(deps.pool, principal.id, sessionId)
    if (meta?.title) return
    const firstUser = messages.find((m) => m.type === 'user')
    const raw =
      typeof firstUser?.content === 'string'
        ? firstUser.content
        : Array.isArray(firstUser?.content)
          ? (firstUser.content as { text?: string }[])
              .map((b) => (typeof b?.text === 'string' ? b.text : ''))
              .join('')
          : ''
    const stripped = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    if (!stripped) return
    const firstLine = stripped.split('\n')[0] ?? ''
    const title = firstLine.slice(0, 50).trim()
    if (!title) return
    await upsertConversationTitle(deps.pool, principal.id, sessionId, title)
  } catch {
    // 标题生成失败不影响 context 返回（对齐 Sudowork useAutoTitle 吞错处理）
  }
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

/** meta 更新（重命名/置顶，写本地表；Moss 无对应 API） */
export async function updateConversationMeta(
  deps: ConversationDeps,
  principal: Principal,
  sessionId: string,
  accessToken: string,
  update: { title?: string; pinned?: boolean },
): Promise<void> {
  await requireOwnSession(deps, principal, sessionId, accessToken)
  await updateConversationMetaRow(deps.pool, principal.id, sessionId, update)
}

/** 置顶区拖拽排序 */
export async function reorderPinnedConversations(
  deps: ConversationDeps,
  principal: Principal,
  orderedIds: string[],
): Promise<void> {
  await reorderPinnedRows(deps.pool, principal.id, orderedIds)
}

/**
 * 删除会话（对齐 Sudowork 删除语义：本地元数据删除 + Moss terminate 尽力而为——
 * reaper 注释确证 Sudowork 远程删除即 terminate）+ 关闭该会话全部 pty。
 */
export async function deleteConversation(
  deps: ConversationDeps,
  principal: Principal,
  sessionId: string,
  accessToken: string,
): Promise<void> {
  await requireOwnSession(deps, principal, sessionId, accessToken)
  await mapMossErrors(() => deps.moss.terminate(accessToken, sessionId))
  await deps.coordinator.terminate(principal.id, sessionId)
  await deleteConversationMetaRow(deps.pool, principal.id, sessionId)
  deps.closeTerminals?.(sessionId)
}

export interface ConversationOptions {
  models: { id: string; name: string }[]
  agents: { name: string; displayName: string; emoji: string; description: string }[]
  skills: { name: string; displayName: string; description: string; icon: string; emoji: string }[]
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
  // 与智能体页"我的智能体"一致：过滤 moss 系统内置（isBuiltin），不作为会话可选项
  const agents = NameListSchema.parse(agentsJson).filter(
    (a) => (a as { isBuiltin?: unknown }).isBuiltin !== true,
  )
  const skills = NameListSchema.parse(skillsJson)

  return {
    models: models.data.map((m) => ({ id: m.id, name: m.name ?? m.id })),
    agents: agents.map((a) => {
      const extra = a as { displayName?: unknown; emoji?: unknown; description?: unknown }
      return {
        name: a.name,
        displayName: typeof extra.displayName === 'string' ? extra.displayName : a.name,
        emoji: typeof extra.emoji === 'string' ? extra.emoji : '',
        description: typeof extra.description === 'string' ? extra.description : '',
      }
    }),
    skills: skills.map((s) => {
      const extra = s as { displayName?: unknown; description?: unknown; icon?: unknown; emoji?: unknown }
      return {
        name: s.name,
        displayName: typeof extra.displayName === 'string' ? extra.displayName : s.name,
        description: typeof extra.description === 'string' ? extra.description : '',
        icon: typeof extra.icon === 'string' ? extra.icon : '',
        emoji: typeof extra.emoji === 'string' ? extra.emoji : '',
      }
    }),
  }
}

// ---------- workspace（DTO 白名单：node 去 fullPath，计划 3.10） ----------

export async function getWorkspaceTree(
  deps: ConversationDeps,
  principal: Principal,
  sessionId: string,
  path: string,
  accessToken: string,
  search = '',
): Promise<unknown> {
  await requireOwnSession(deps, principal, sessionId, accessToken)
  const tree = await mapMossErrors(() => deps.moss.workspaceTree(accessToken, sessionId, path, search))
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
