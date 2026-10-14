import type { MossCallContext, MossFetch, MossParkPort } from '@sudowork/moss-client'

/**
 * Park 业务编排层（计划 3.4 parkRoutes+parkService 拆分，样板 conversations：
 * Deps 与领域错误定义在 service，routes 只做 HTTP 适配）。
 * 本层承载：注册转发、园区系统运营授权（policy 端点前置）、
 * 需要参数组装的端口调用（leads/consultations 过滤、成员与分配的标识提取）。
 */

/** policy 管理端点的授权失败——routes 捕获后映射为 403 park_role_denied。 */
export class ParkRoleDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParkRoleDeniedError'
  }
}

export interface ParkDeps {
  park: MossParkPort
  config: { moss: { baseUrl: string } }
  mossFetch: MossFetch
}

export interface LeadsFilter {
  status?: string
  watched?: boolean
}

export interface ConsultationsFilter {
  enterprise_org_id?: string
  before_created_at?: number
  after_created_at?: number
}

/** 免登录注册转发（clientIp 经 x-forwarded-for 透传给 moss 限流）。 */
export async function registerEnterprise(
  deps: ParkDeps,
  body: unknown,
  clientIp?: string,
): Promise<unknown> {
  return deps.park.registerEnterprise(deps.config.moss.baseUrl, body, clientIp)
}

/**
 * policy 管理端点授权（计划 2.3 系统运营专属）：调用者 org 必须是目标园区本身，
 * 且持有 park_system_operator 角色。不满足抛 ParkRoleDeniedError。
 */
export async function assertParkSystemOperator(
  deps: ParkDeps,
  ctx: MossCallContext,
  parkOrgId: string,
): Promise<void> {
  const context = (await deps.park.context(ctx)) as {
    park_org_id?: string
    park_role?: string
    org_type?: string
  }
  if (
    context.org_type !== 'park' ||
    context.park_org_id !== parkOrgId ||
    context.park_role !== 'park_system_operator'
  ) {
    throw new ParkRoleDeniedError('仅园区系统运营可管理政策')
  }
}

export async function listLeads(
  deps: ParkDeps,
  ctx: MossCallContext,
  parkOrgId: string,
  filter: LeadsFilter,
): Promise<unknown> {
  return deps.park.leads(ctx, parkOrgId, filter)
}

export async function listConsultations(
  deps: ParkDeps,
  ctx: MossCallContext,
  parkOrgId: string,
  filter: ConsultationsFilter,
): Promise<unknown> {
  return deps.park.consultations(ctx, parkOrgId, filter)
}

export async function removeMember(
  deps: ParkDeps,
  ctx: MossCallContext,
  parkOrgId: string,
  userId: string,
): Promise<unknown> {
  return deps.park.removeMember(ctx, parkOrgId, userId)
}

export async function unassignAssistant(
  deps: ParkDeps,
  ctx: MossCallContext,
  parkOrgId: string,
  assistantId: string,
  enterpriseOrgId: string,
): Promise<unknown> {
  return deps.park.unassignAssistant(ctx, parkOrgId, assistantId, enterpriseOrgId)
}
