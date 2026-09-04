import type { AppConfig } from '../../config.js'
import type { Pool } from 'pg'
import type { AuthDeps } from '../auth/authService.js'
import type { Principal } from '../auth/principalRepository.js'
import type { MossCallContext, MossCronPort } from '@sudowork/moss-client'
import type { MossSessionPort } from '@sudowork/moss-client'
import { MossHttpError, MossNetworkError } from '@sudowork/moss-client'

/**
 * Cron 服务（计划 3.9 修订版）：
 * - schedule 统一 value 字段（at/every/cron 保真 roundtrip，无 expr）
 * - boundSessionId 提交前用当前用户 token 确认 Session 归属（计划 Task 7）
 * - assistant 引用从 fresh installed 列表核验（仅 assistantId/assistantName，无 skill 字段）
 * - client_cron_enabled 为全局系统设置且仅 admin 可读；创建被拒（cron_disabled_by_org）
 *   时原样透传该上游错误码供前端降级隐藏创建入口
 */

export class MossUnavailableError extends Error {}
export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}
export class CronDisabledError extends Error {}
export class InvalidSelectionError extends Error {
  constructor(readonly value: string) {
    super(`assistant not in visible list: ${value}`)
  }
}

export interface CronDeps {
  pool: Pool
  config: AppConfig
  auth: AuthDeps
  cron: MossCronPort
  sessions: MossSessionPort
  /** 从 fresh agents/installed 列表取当前可见名字集合（由 routes 注入） */
  fetchVisibleAgentNames: (ctx: MossCallContext) => Promise<Set<string>>
}

function mapErr(err: unknown): Error {
  if (err instanceof MossNetworkError) return new MossUnavailableError()
  if (err instanceof MossHttpError) {
    if (err.status === 404) return new NotFoundError()
    if (err.status === 401 || err.status === 403) return new ForbiddenError()
    if (err.bodyText.includes('cron_disabled_by_org')) return new CronDisabledError()
  }
  return err instanceof Error ? err : new Error(String(err))
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw mapErr(err)
  }
}

/**
 * 当前用户可见 job 列表。基线事实：普通 GET /api/v1/cron/jobs 默认 listByUser
 * （仅本人），已满足 WebUI“只展示本人 job”的要求；无需 admin 端点（也少一次
 * /auth/me 调用，降低上游压力）。
 */
async function visibleJobs(
  deps: CronDeps,
  _principal: Principal,
  ctx: MossCallContext,
): Promise<Record<string, unknown>[]> {
  const json = await run(() => deps.cron.list(ctx))
  return extractRows(json)
}

function extractRows(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[]
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>
    if (Array.isArray(obj.jobs)) return obj.jobs as Record<string, unknown>[]
    if (Array.isArray(obj.data)) return obj.data as Record<string, unknown>[]
  }
  return []
}

/** fresh 核验：目标 job 必须在当前用户可见列表（IDOR 防线）。 */
async function requireVisibleJob(
  deps: CronDeps,
  principal: Principal,
  ctx: MossCallContext,
  jobId: string,
): Promise<void> {
  const jobs = await visibleJobs(deps, principal, ctx)
  if (!jobs.some((j) => String(j.id) === jobId)) throw new NotFoundError()
}

export async function listJobs(
  deps: CronDeps,
  principal: Principal,
  ctx: MossCallContext,
): Promise<{ jobs: Record<string, unknown>[]; canCreate: boolean; canUseAdminList: boolean }> {
  const jobs = await visibleJobs(deps, principal, ctx)
  // canCreate 投影：默认乐观展示创建入口；被组织停用时由 CRON_DISABLED_BY_ORG 降级
  return { jobs, canCreate: true, canUseAdminList: false }
}

export interface CronJobInput {
  name?: string
  schedule?: { kind: 'at' | 'every' | 'cron'; value: string; tz?: string; description?: string }
  payloadMessage?: string
  conversationMode?: 'new' | 'reuse'
  boundSessionId?: string | null
  assistantName?: string | null
  enabled?: boolean
}

/** 组装 Moss 请求体（schedule 保真；引用字段仅 assistant）。 */
async function buildMossBody(
  deps: CronDeps,
  principal: Principal,
  ctx: MossCallContext,
  input: CronJobInput,
  opts: { requireFull: boolean },
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {}

  if (input.name !== undefined) body.name = input.name
  if (input.payloadMessage !== undefined) body.payloadMessage = input.payloadMessage
  if (input.conversationMode !== undefined) body.conversationMode = input.conversationMode
  if (input.enabled !== undefined) body.enabled = input.enabled

  if (input.schedule !== undefined) {
    const { kind, value, tz, description } = input.schedule
    const schedule: Record<string, unknown> = { kind, value }
    if (tz) schedule.tz = tz
    if (description) schedule.description = description
    body.schedule = schedule
  }

  if (input.boundSessionId !== undefined && input.boundSessionId !== null) {
    // 计划 Task 7：boundSessionId 归属校验（当前用户 + 同 org）
    const session = await run(() => deps.sessions.get(ctx, input.boundSessionId!))
    if (!session) throw new NotFoundError()
    if (session.userId !== principal.mossUserId || session.orgId !== principal.orgId) {
      throw new ForbiddenError()
    }
    body.boundSessionId = input.boundSessionId
  } else if (input.boundSessionId === null) {
    body.boundSessionId = null
  }

  if (input.assistantName !== undefined && input.assistantName !== null) {
    body.assistantName = input.assistantName
    body.assistantId = null // Moss 基线客户端做法：提交 name，服务端解析
  }

  if (opts.requireFull && (!body.schedule || !body.name)) {
    throw new Error('INVALID_REQUEST')
  }

  return body
}

export async function createJob(
  deps: CronDeps,
  principal: Principal,
  ctx: MossCallContext,
  input: CronJobInput & { name: string; schedule: NonNullable<CronJobInput['schedule']> },
): Promise<unknown> {
  const body = await buildMossBody(deps, principal, ctx, input, { requireFull: true })
  return run(() => deps.cron.create(ctx, body))
}

export async function getJob(
  deps: CronDeps,
  principal: Principal,
  ctx: MossCallContext,
  jobId: string,
): Promise<unknown> {
  await requireVisibleJob(deps, principal, ctx, jobId)
  return run(() => deps.cron.get(ctx, jobId))
}

export async function updateJob(
  deps: CronDeps,
  principal: Principal,
  ctx: MossCallContext,
  jobId: string,
  input: CronJobInput,
): Promise<unknown> {
  await requireVisibleJob(deps, principal, ctx, jobId)
  const body = await buildMossBody(deps, principal, ctx, input, { requireFull: false })
  return run(() => deps.cron.update(ctx, jobId, body))
}

export async function deleteJob(
  deps: CronDeps,
  principal: Principal,
  ctx: MossCallContext,
  jobId: string,
): Promise<unknown> {
  await requireVisibleJob(deps, principal, ctx, jobId)
  return run(() => deps.cron.remove(ctx, jobId))
}

export async function triggerJob(
  deps: CronDeps,
  principal: Principal,
  ctx: MossCallContext,
  jobId: string,
): Promise<unknown> {
  // 手动触发：点击者必须是绑定会话 owner（requireVisibleJob 已保证本人可见）
  await requireVisibleJob(deps, principal, ctx, jobId)
  return run(() => deps.cron.trigger(ctx, jobId))
}

export async function listRuns(
  deps: CronDeps,
  principal: Principal,
  ctx: MossCallContext,
  jobId: string,
  limit: number,
): Promise<unknown> {
  await requireVisibleJob(deps, principal, ctx, jobId)
  return run(() => deps.cron.runs(ctx, jobId, limit))
}

/** 计划 Task 7：assistantName 必须来自当前 fresh 可见列表（不接收浏览器自造 name）。 */
export async function assertAssistantName(
  deps: CronDeps,
  ctx: MossCallContext,
  assistantName: string,
): Promise<void> {
  const names = await deps.fetchVisibleAgentNames(ctx)
  if (!names.has(assistantName)) throw new InvalidSelectionError(assistantName)
}
