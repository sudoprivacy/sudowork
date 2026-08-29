import type { AppConfig } from '../../config.js'
import type { Pool } from 'pg'
import type { AuthDeps } from '../auth/authService.js'
import type { MossSkillPort } from '../../moss/MossSkillClient.js'
import { MossHttpError, MossNetworkError } from '../../moss/MossHttpClient.js'

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

interface InstalledItem {
  name?: unknown
}

async function installedNames(deps: SkillDeps, accessToken: string): Promise<Set<string>> {
  const list = (await mapErr(() => deps.skills.installed(accessToken))) as InstalledItem[]
  const names = new Set<string>()
  if (Array.isArray(list)) {
    for (const item of list) {
      if (item && typeof item.name === 'string') names.add(item.name)
    }
  }
  return names
}

async function requireVisibleSkill(deps: SkillDeps, accessToken: string, name: string): Promise<void> {
  if (!(await installedNames(deps, accessToken)).has(name)) throw new NotFoundError()
}

export async function listInstalled(deps: SkillDeps, accessToken: string): Promise<unknown> {
  return mapErr(() => deps.skills.installed(accessToken))
}

export async function hubCategories(deps: SkillDeps, accessToken: string): Promise<unknown> {
  return mapErr(() => deps.skills.hubCategories(accessToken))
}

export async function hubList(
  deps: SkillDeps,
  accessToken: string,
  searchParams: Record<string, string>,
): Promise<unknown> {
  return mapErr(() => deps.skills.hubList(accessToken, searchParams))
}

export async function hubDetail(deps: SkillDeps, accessToken: string, id: string): Promise<unknown> {
  return mapErr(() => deps.skills.hubDetail(accessToken, id))
}

export async function syncStatus(deps: SkillDeps, accessToken: string): Promise<unknown> {
  await requireAnyScope(deps, accessToken, ['admin:settings'])
  return mapErr(() => deps.skills.syncStatus(accessToken))
}

export async function tenantList(deps: SkillDeps, accessToken: string): Promise<unknown> {
  return mapErr(() => deps.skills.tenantList(accessToken))
}

export async function installFromHub(
  deps: SkillDeps,
  accessToken: string,
  name: string,
): Promise<unknown> {
  await requireAnyScope(deps, accessToken, ['admin:settings'])
  const hub = (await mapErr(() =>
    deps.skills.hubList(accessToken, { limit: '100' }),
  )) as { items?: Record<string, unknown>[]; skills?: Record<string, unknown>[] }
  const items = hub?.items ?? hub?.skills ?? []
  const meta = items.find((it) => it && (it.name === name || it.id === name))
  if (!meta) throw new NotFoundError()
  return mapErr(() => deps.skills.install(accessToken, { skillMeta: meta }))
}

export async function setEnabled(
  deps: SkillDeps,
  accessToken: string,
  name: string,
  enabled: boolean,
): Promise<unknown> {
  await requireAnyScope(deps, accessToken, ['admin:settings'])
  await requireVisibleSkill(deps, accessToken, name)
  // 基线请求体是单个对象；不传 sourcePath（WebUI 不透传浏览器路径）
  return mapErr(() => deps.skills.setEnabled(accessToken, { skillName: name, enabled }))
}

export async function uploadCustom(
  deps: SkillDeps,
  accessToken: string,
  file: string,
): Promise<unknown> {
  return mapErr(() => deps.skills.uploadCustom(accessToken, { file }))
}

export async function uninstall(
  deps: SkillDeps,
  accessToken: string,
  name: string,
): Promise<unknown> {
  await requireAnyScope(deps, accessToken, ['admin:settings'])
  await requireVisibleSkill(deps, accessToken, name)
  return mapErr(() => deps.skills.uninstall(accessToken, { skillName: name }))
}

export async function syncFromHub(deps: SkillDeps, accessToken: string): Promise<unknown> {
  await requireAnyScope(deps, accessToken, ['admin:settings'])
  return mapErr(() => deps.skills.syncFromHub(accessToken))
}

export async function tenantUpload(
  deps: SkillDeps,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  await requireAnyScope(deps, accessToken, ['admin:settings', 'store:tenant:write'])
  return mapErr(() => deps.skills.tenantUpload(accessToken, body))
}

async function requireTenantVisible(deps: SkillDeps, accessToken: string, id: string): Promise<void> {
  const list = (await mapErr(() => deps.skills.tenantList(accessToken))) as Record<string, unknown>[]
  const row = Array.isArray(list) ? list.find((it) => it && it.id === id) : undefined
  if (!row) throw new NotFoundError()
  if (row.can_manage === false) throw new ForbiddenError()
}

export async function tenantUpdate(
  deps: SkillDeps,
  accessToken: string,
  id: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  await requireTenantVisible(deps, accessToken, id)
  return mapErr(() => deps.skills.tenantUpdate(accessToken, id, body))
}

export async function tenantDelete(deps: SkillDeps, accessToken: string, id: string): Promise<unknown> {
  await requireTenantVisible(deps, accessToken, id)
  return mapErr(() => deps.skills.tenantDelete(accessToken, id))
}

export async function tenantDownload(deps: SkillDeps, accessToken: string, id: string): Promise<unknown> {
  return mapErr(() => deps.skills.tenantDownload(accessToken, id))
}

export async function tenantPublish(
  deps: SkillDeps,
  accessToken: string,
  sourceName: string,
): Promise<unknown> {
  await requireVisibleSkill(deps, accessToken, sourceName)
  return mapErr(() => deps.skills.tenantPublish(accessToken, { skillName: sourceName }))
}
