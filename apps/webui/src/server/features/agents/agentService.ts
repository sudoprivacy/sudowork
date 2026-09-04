import type { AppConfig } from '../../config.js'
import type { Pool } from 'pg'
import type { AuthDeps } from '../auth/authService.js'
import type { MossAgentPort, MossCallContext } from '@sudowork/moss-client'
import { MossHttpError, MossNetworkError } from '@sudowork/moss-client'

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
  ctx: MossCallContext,
  scopes: string[],
): Promise<void> {
  const me = await mapErr(() => deps.auth.mossAuth.me(ctx.accessToken, ctx.baseUrl))
  const owned: string[] = Array.isArray(me.scopes) ? me.scopes : []
  const isAdmin = me.role === 'admin' || me.role === 'super_admin' || me.isSuperAdmin === true
  if (isAdmin) return
  if (!scopes.some((s) => owned.includes(s))) {
    throw new ForbiddenError()
  }
}

export async function getScopes(deps: AgentDeps, ctx: MossCallContext): Promise<string[]> {
  const me = await mapErr(() => deps.auth.mossAuth.me(ctx.accessToken, ctx.baseUrl))
  return Array.isArray(me.scopes) ? me.scopes : []
}

interface InstalledItem {
  name?: unknown
}

async function installedNames(deps: AgentDeps, ctx: MossCallContext): Promise<Map<string, Record<string, unknown>>> {
  const list = (await mapErr(() => deps.agents.installed(ctx))) as InstalledItem[]
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
  ctx: MossCallContext,
  name: string,
): Promise<void> {
  const names = await installedNames(deps, ctx)
  if (!names.has(name)) throw new NotFoundError()
}

// ---------- 查询 ----------

export async function listInstalled(deps: AgentDeps, ctx: MossCallContext): Promise<unknown> {
  return mapErr(() => deps.agents.installed(ctx))
}

export async function hubCategories(deps: AgentDeps, ctx: MossCallContext): Promise<unknown> {
  return mapErr(() => deps.agents.hubCategories(ctx))
}

export async function hubList(
  deps: AgentDeps,
  ctx: MossCallContext,
  searchParams: Record<string, string>,
): Promise<unknown> {
  // moss 上游返回 { assistants, next_cursor, has_more }（agentStore.ts fetchAgentHubAssistants），
  // 与 installFromHub 的兼容读取一致，统一归一化为 items 供前端消费
  const hub = (await mapErr(() => deps.agents.hubList(ctx, searchParams))) as {
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

export async function hubDetail(deps: AgentDeps, ctx: MossCallContext, id: string): Promise<unknown> {
  return mapErr(() => deps.agents.hubDetail(ctx, id))
}

export async function syncStatus(deps: AgentDeps, ctx: MossCallContext): Promise<unknown> {
  await requireAnyScope(deps, ctx, ['admin:settings'])
  return mapErr(() => deps.agents.syncStatus(ctx))
}

export async function tenantList(deps: AgentDeps, ctx: MossCallContext): Promise<unknown> {
  return mapErr(() => deps.agents.tenantList(ctx))
}

// ---------- 变更 ----------

export async function installFromHub(
  deps: AgentDeps,
  ctx: MossCallContext,
  name: string,
): Promise<unknown> {
  await requireAnyScope(deps, ctx, ['admin:settings'])
  // assistantMeta 由后端从 fresh hub 列表解析（不信任浏览器提交）
  const hub = (await mapErr(() =>
    deps.agents.hubList(ctx, { limit: '100' }),
  )) as { items?: Record<string, unknown>[]; assistants?: Record<string, unknown>[] }
  const items = hub?.items ?? hub?.assistants ?? []
  const meta = items.find(
    (it) => it && (it.name === name || it.id === name),
  )
  if (!meta) throw new NotFoundError()
  return mapErr(() =>
    deps.agents.install(ctx, { assistantMeta: meta, selectedSkillIds: [] }),
  )
}

export async function createAgent(
  deps: AgentDeps,
  ctx: MossCallContext,
  body: Record<string, unknown>,
): Promise<unknown> {
  await requireAnyScope(deps, ctx, ['admin:settings'])
  return mapErr(() => deps.agents.create(ctx, body))
}

export async function uploadCustom(
  deps: AgentDeps,
  ctx: MossCallContext,
  file: string,
): Promise<unknown> {
  return mapErr(() => deps.agents.uploadCustom(ctx, { file }))
}

export async function updateMeta(
  deps: AgentDeps,
  ctx: MossCallContext,
  name: string,
  updates: Record<string, unknown>,
): Promise<unknown> {
  await requireVisibleAgent(deps, ctx, name)
  return mapErr(() => deps.agents.updateMeta(ctx, { assistantName: name, updates }))
}

export async function uninstall(
  deps: AgentDeps,
  ctx: MossCallContext,
  name: string,
): Promise<unknown> {
  await requireAnyScope(deps, ctx, ['admin:settings'])
  await requireVisibleAgent(deps, ctx, name)
  return mapErr(() => deps.agents.uninstall(ctx, { assistantName: name }))
}

export async function syncFromHub(deps: AgentDeps, ctx: MossCallContext): Promise<unknown> {
  await requireAnyScope(deps, ctx, ['admin:settings'])
  return mapErr(() => deps.agents.syncFromHub(ctx))
}

export async function installedRules(
  deps: AgentDeps,
  ctx: MossCallContext,
  name: string,
): Promise<unknown> {
  await requireAnyScope(deps, ctx, ['admin:settings'])
  await requireVisibleAgent(deps, ctx, name)
  return mapErr(() => deps.agents.installedRules(ctx, name))
}

export async function tenantCreate(
  deps: AgentDeps,
  ctx: MossCallContext,
  body: Record<string, unknown>,
): Promise<unknown> {
  await requireAnyScope(deps, ctx, ['admin:settings', 'store:tenant:write'])
  return mapErr(() => deps.agents.tenantCreate(ctx, body))
}

export async function tenantUpdate(
  deps: AgentDeps,
  ctx: MossCallContext,
  id: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  await requireTenantVisible(deps, ctx, id)
  return mapErr(() => deps.agents.tenantUpdate(ctx, id, body))
}

export async function tenantDelete(deps: AgentDeps, ctx: MossCallContext, id: string): Promise<unknown> {
  await requireTenantVisible(deps, ctx, id)
  return mapErr(() => deps.agents.tenantDelete(ctx, id))
}

export async function tenantDownload(deps: AgentDeps, ctx: MossCallContext, id: string): Promise<unknown> {
  return mapErr(() => deps.agents.tenantDownload(ctx, id))
}

export async function tenantPublish(
  deps: AgentDeps,
  ctx: MossCallContext,
  sourceName: string,
): Promise<unknown> {
  await requireVisibleAgent(deps, ctx, sourceName)
  return mapErr(() =>
    deps.agents.tenantPublish(ctx, { assistantName: sourceName }),
  )
}

/** tenant 目标必须来自当前 fresh tenant 列表（can_manage 之上的 WebUI 防线）。 */
async function requireTenantVisible(
  deps: AgentDeps,
  ctx: MossCallContext,
  id: string,
): Promise<void> {
  const list = (await mapErr(() => deps.agents.tenantList(ctx))) as Record<string, unknown>[]
  const row = Array.isArray(list) ? list.find((it) => it && it.id === id) : undefined
  if (!row) throw new NotFoundError()
  if (row.can_manage === false) throw new ForbiddenError()
}
