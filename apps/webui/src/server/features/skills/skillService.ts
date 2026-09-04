import type { AppConfig } from '../../config.js'
import type { Pool } from 'pg'
import type { AuthDeps } from '../auth/authService.js'
import type { MossCallContext, MossSkillPort } from '@sudowork/moss-client'
import { MossHttpError, MossNetworkError } from '@sudowork/moss-client'

/**
 * Skill 服务（计划 3.4/3.9 修订版）：与 agentService 对称；
 * enabled 请求体为单个 {skillName, enabled}（基线事实，非数组）。
 */

export class MossUnavailableError extends Error {}
export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}

export interface SkillDeps {
  pool: Pool
  config: AppConfig
  auth: AuthDeps
  skills: MossSkillPort
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

export async function requireAnyScope(
  deps: SkillDeps,
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

interface InstalledItem {
  name?: unknown
}

async function installedNames(deps: SkillDeps, ctx: MossCallContext): Promise<Set<string>> {
  const list = (await mapErr(() => deps.skills.installed(ctx))) as InstalledItem[]
  const names = new Set<string>()
  if (Array.isArray(list)) {
    for (const item of list) {
      if (item && typeof item.name === 'string') names.add(item.name)
    }
  }
  return names
}

async function requireVisibleSkill(deps: SkillDeps, ctx: MossCallContext, name: string): Promise<void> {
  if (!(await installedNames(deps, ctx)).has(name)) throw new NotFoundError()
}

export async function listInstalled(deps: SkillDeps, ctx: MossCallContext): Promise<unknown> {
  return mapErr(() => deps.skills.installed(ctx))
}

export async function hubCategories(deps: SkillDeps, ctx: MossCallContext): Promise<unknown> {
  return mapErr(() => deps.skills.hubCategories(ctx))
}

export async function hubList(
  deps: SkillDeps,
  ctx: MossCallContext,
  searchParams: Record<string, string>,
): Promise<unknown> {
  // moss 上游返回 { skills, next_cursor, has_more }（skillStore.ts fetchSkillHubSkills），
  // 与 installFromHub 的兼容读取一致，统一归一化为 items 供前端消费
  const hub = (await mapErr(() => deps.skills.hubList(ctx, searchParams))) as {
    items?: Record<string, unknown>[]
    skills?: Record<string, unknown>[]
    next_cursor?: unknown
    has_more?: unknown
  }
  return {
    items: hub?.items ?? hub?.skills ?? [],
    next_cursor: typeof hub?.next_cursor === 'string' ? hub.next_cursor : null,
    has_more: hub?.has_more === true,
  }
}

export async function hubDetail(deps: SkillDeps, ctx: MossCallContext, id: string): Promise<unknown> {
  return mapErr(() => deps.skills.hubDetail(ctx, id))
}

export async function syncStatus(deps: SkillDeps, ctx: MossCallContext): Promise<unknown> {
  await requireAnyScope(deps, ctx, ['admin:settings'])
  return mapErr(() => deps.skills.syncStatus(ctx))
}

export async function tenantList(deps: SkillDeps, ctx: MossCallContext): Promise<unknown> {
  return mapErr(() => deps.skills.tenantList(ctx))
}

export async function installFromHub(
  deps: SkillDeps,
  ctx: MossCallContext,
  name: string,
): Promise<unknown> {
  await requireAnyScope(deps, ctx, ['admin:settings'])
  const hub = (await mapErr(() =>
    deps.skills.hubList(ctx, { limit: '100' }),
  )) as { items?: Record<string, unknown>[]; skills?: Record<string, unknown>[] }
  const items = hub?.items ?? hub?.skills ?? []
  const meta = items.find((it) => it && (it.name === name || it.id === name))
  if (!meta) throw new NotFoundError()
  return mapErr(() => deps.skills.install(ctx, { skillMeta: meta }))
}

export async function setEnabled(
  deps: SkillDeps,
  ctx: MossCallContext,
  name: string,
  enabled: boolean,
): Promise<unknown> {
  await requireAnyScope(deps, ctx, ['admin:settings'])
  await requireVisibleSkill(deps, ctx, name)
  // 基线请求体是单个对象；不传 sourcePath（WebUI 不透传浏览器路径）
  return mapErr(() => deps.skills.setEnabled(ctx, { skillName: name, enabled }))
}

export async function uploadCustom(
  deps: SkillDeps,
  ctx: MossCallContext,
  file: string,
): Promise<unknown> {
  return mapErr(() => deps.skills.uploadCustom(ctx, { file }))
}

export async function uninstall(
  deps: SkillDeps,
  ctx: MossCallContext,
  name: string,
): Promise<unknown> {
  await requireAnyScope(deps, ctx, ['admin:settings'])
  await requireVisibleSkill(deps, ctx, name)
  return mapErr(() => deps.skills.uninstall(ctx, { skillName: name }))
}

export async function syncFromHub(deps: SkillDeps, ctx: MossCallContext): Promise<unknown> {
  await requireAnyScope(deps, ctx, ['admin:settings'])
  return mapErr(() => deps.skills.syncFromHub(ctx))
}

export async function tenantUpload(
  deps: SkillDeps,
  ctx: MossCallContext,
  body: Record<string, unknown>,
): Promise<unknown> {
  await requireAnyScope(deps, ctx, ['admin:settings', 'store:tenant:write'])
  return mapErr(() => deps.skills.tenantUpload(ctx, body))
}

async function requireTenantVisible(deps: SkillDeps, ctx: MossCallContext, id: string): Promise<void> {
  const list = (await mapErr(() => deps.skills.tenantList(ctx))) as Record<string, unknown>[]
  const row = Array.isArray(list) ? list.find((it) => it && it.id === id) : undefined
  if (!row) throw new NotFoundError()
  if (row.can_manage === false) throw new ForbiddenError()
}

export async function tenantUpdate(
  deps: SkillDeps,
  ctx: MossCallContext,
  id: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  await requireTenantVisible(deps, ctx, id)
  return mapErr(() => deps.skills.tenantUpdate(ctx, id, body))
}

export async function tenantDelete(deps: SkillDeps, ctx: MossCallContext, id: string): Promise<unknown> {
  await requireTenantVisible(deps, ctx, id)
  return mapErr(() => deps.skills.tenantDelete(ctx, id))
}

export async function tenantDownload(deps: SkillDeps, ctx: MossCallContext, id: string): Promise<unknown> {
  return mapErr(() => deps.skills.tenantDownload(ctx, id))
}

export async function tenantPublish(
  deps: SkillDeps,
  ctx: MossCallContext,
  sourceName: string,
): Promise<unknown> {
  await requireVisibleSkill(deps, ctx, sourceName)
  return mapErr(() => deps.skills.tenantPublish(ctx, { skillName: sourceName }))
}
