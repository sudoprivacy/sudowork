import type { AppConfig } from '../../config.js'
import type { Pool } from 'pg'
import type { AuthDeps } from '../auth/authService.js'
import type { MossAgentPort } from '../../moss/MossAgentClient.js'
import { MossHttpError, MossNetworkError } from '../../moss/MossHttpClient.js'

/**
 * Agent 服务（计划 3.4/3.9 修订版）：
 * - admin 操作前用当前 token 调 /auth/me 校验 scope（前端隐藏不代替服务端授权）
 * - uninstall/meta/rules 的目标一律先在 fresh installed 列表按 name 核验
 * - install 的 assistantMeta 由后端从 fresh hub 列表解析，不信任浏览器提交的 meta
 */

export class MossUnavailableError extends Error {}
export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}

export interface AgentDeps {
  pool: Pool
  config: AppConfig
  auth: AuthDeps
  agents: MossAgentPort
}

async function mapErr<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err: unknown) => {
    if (err instanceof MossNetworkError) throw new MossUnavailableError()
    if (err instanceof MossHttpError && err.status === 404) throw new NotFoundError()
    if (err instanceof MossHttpError && (err.status === 401 || err.status === 403)) {
      throw new ForbiddenError()
    }
    throw err
  })
}

/** 校验当前 token 具备任一 scope；不具备抛 ForbiddenError。 */
export async function requireAnyScope(
  deps: AgentDeps,
  accessToken: string,
  scopes: string[],
): Promise<void> {
  const me = await mapErr(() => deps.auth.mossAuth.me(accessToken))
  const owned: string[] = Array.isArray(me.scopes) ? me.scopes : []
  const isAdmin = me.role === 'admin' || me.role === 'super_admin' || me.isSuperAdmin === true
  if (isAdmin) return
  if (!scopes.some((s) => owned.includes(s))) {
    throw new ForbiddenError()
  }
}

export async function getScopes(deps: AgentDeps, accessToken: string): Promise<string[]> {
  const me = await mapErr(() => deps.auth.mossAuth.me(accessToken))
  return Array.isArray(me.scopes) ? me.scopes : []
}

interface InstalledItem {
  name?: unknown
}

async function installedNames(deps: AgentDeps, accessToken: string): Promise<Map<string, Record<string, unknown>>> {
  const list = (await mapErr(() => deps.agents.installed(accessToken))) as InstalledItem[]
  const map = new Map<string, Record<string, unknown>>()
  if (Array.isArray(list)) {
    for (const item of list) {
      if (item && typeof item.name === 'string') {
        map.set(item.name, item as Record<string, unknown>)
      }
    }
  }
  return map
}

/** fresh 核验：目标 name 必须在当前用户可见 installed 列表（IDOR 防线，计划 3.4）。 */
async function requireVisibleAgent(
  deps: AgentDeps,
  accessToken: string,
  name: string,
): Promise<void> {
  const names = await installedNames(deps, accessToken)
  if (!names.has(name)) throw new NotFoundError()
}

// ---------- 查询 ----------

export async function listInstalled(deps: AgentDeps, accessToken: string): Promise<unknown> {
  return mapErr(() => deps.agents.installed(accessToken))
}

export async function hubCategories(deps: AgentDeps, accessToken: string): Promise<unknown> {
  return mapErr(() => deps.agents.hubCategories(accessToken))
}

export async function hubList(
  deps: AgentDeps,
  accessToken: string,
  searchParams: Record<string, string>,
): Promise<unknown> {
  // moss 上游返回 { assistants, next_cursor, has_more }（agentStore.ts fetchAgentHubAssistants），
  // 与 installFromHub 的兼容读取一致，统一归一化为 items 供前端消费
  const hub = (await mapErr(() => deps.agents.hubList(accessToken, searchParams))) as {
    items?: Record<string, unknown>[]
    assistants?: Record<string, unknown>[]
    next_cursor?: unknown
    has_more?: unknown
  }
  return {
    items: hub?.items ?? hub?.assistants ?? [],
    next_cursor: typeof hub?.next_cursor === 'string' ? hub.next_cursor : null,
    has_more: hub?.has_more === true,
  }
}

export async function hubDetail(deps: AgentDeps, accessToken: string, id: string): Promise<unknown> {
  return mapErr(() => deps.agents.hubDetail(accessToken, id))
}

export async function syncStatus(deps: AgentDeps, accessToken: string): Promise<unknown> {
  await requireAnyScope(deps, accessToken, ['admin:settings'])
  return mapErr(() => deps.agents.syncStatus(accessToken))
}

export async function tenantList(deps: AgentDeps, accessToken: string): Promise<unknown> {
  return mapErr(() => deps.agents.tenantList(accessToken))
}

// ---------- 变更 ----------

export async function installFromHub(
  deps: AgentDeps,
  accessToken: string,
  name: string,
): Promise<unknown> {
  await requireAnyScope(deps, accessToken, ['admin:settings'])
  // assistantMeta 由后端从 fresh hub 列表解析（不信任浏览器提交）
  const hub = (await mapErr(() =>
    deps.agents.hubList(accessToken, { limit: '100' }),
  )) as { items?: Record<string, unknown>[]; assistants?: Record<string, unknown>[] }
  const items = hub?.items ?? hub?.assistants ?? []
  const meta = items.find(
    (it) => it && (it.name === name || it.id === name),
  )
  if (!meta) throw new NotFoundError()
  return mapErr(() =>
    deps.agents.install(accessToken, { assistantMeta: meta, selectedSkillIds: [] }),
  )
}

export async function createAgent(
  deps: AgentDeps,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  await requireAnyScope(deps, accessToken, ['admin:settings'])
  return mapErr(() => deps.agents.create(accessToken, body))
}

export async function uploadCustom(
  deps: AgentDeps,
  accessToken: string,
  file: string,
): Promise<unknown> {
  return mapErr(() => deps.agents.uploadCustom(accessToken, { file }))
}

export async function updateMeta(
  deps: AgentDeps,
  accessToken: string,
  name: string,
  updates: Record<string, unknown>,
): Promise<unknown> {
  await requireVisibleAgent(deps, accessToken, name)
  return mapErr(() => deps.agents.updateMeta(accessToken, { assistantName: name, updates }))
}

export async function uninstall(
  deps: AgentDeps,
  accessToken: string,
  name: string,
): Promise<unknown> {
  await requireAnyScope(deps, accessToken, ['admin:settings'])
  await requireVisibleAgent(deps, accessToken, name)
  return mapErr(() => deps.agents.uninstall(accessToken, { assistantName: name }))
}

export async function syncFromHub(deps: AgentDeps, accessToken: string): Promise<unknown> {
  await requireAnyScope(deps, accessToken, ['admin:settings'])
  return mapErr(() => deps.agents.syncFromHub(accessToken))
}

export async function installedRules(
  deps: AgentDeps,
  accessToken: string,
  name: string,
): Promise<unknown> {
  await requireAnyScope(deps, accessToken, ['admin:settings'])
  await requireVisibleAgent(deps, accessToken, name)
  return mapErr(() => deps.agents.installedRules(accessToken, name))
}

export async function tenantCreate(
  deps: AgentDeps,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  await requireAnyScope(deps, accessToken, ['admin:settings', 'store:tenant:write'])
  return mapErr(() => deps.agents.tenantCreate(accessToken, body))
}

export async function tenantUpdate(
  deps: AgentDeps,
  accessToken: string,
  id: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  await requireTenantVisible(deps, accessToken, id)
  return mapErr(() => deps.agents.tenantUpdate(accessToken, id, body))
}

export async function tenantDelete(deps: AgentDeps, accessToken: string, id: string): Promise<unknown> {
  await requireTenantVisible(deps, accessToken, id)
  return mapErr(() => deps.agents.tenantDelete(accessToken, id))
}

export async function tenantDownload(deps: AgentDeps, accessToken: string, id: string): Promise<unknown> {
  return mapErr(() => deps.agents.tenantDownload(accessToken, id))
}

export async function tenantPublish(
  deps: AgentDeps,
  accessToken: string,
  sourceName: string,
): Promise<unknown> {
  await requireVisibleAgent(deps, accessToken, sourceName)
  return mapErr(() =>
    deps.agents.tenantPublish(accessToken, { assistantName: sourceName }),
  )
}

/** tenant 目标必须来自当前 fresh tenant 列表（can_manage 之上的 WebUI 防线）。 */
async function requireTenantVisible(
  deps: AgentDeps,
  accessToken: string,
  id: string,
): Promise<void> {
  const list = (await mapErr(() => deps.agents.tenantList(accessToken))) as Record<string, unknown>[]
  const row = Array.isArray(list) ? list.find((it) => it && it.id === id) : undefined
  if (!row) throw new NotFoundError()
  if (row.can_manage === false) throw new ForbiddenError()
}
