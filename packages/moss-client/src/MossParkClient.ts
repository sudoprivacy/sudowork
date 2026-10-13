import { type MossCallContext, type MossFetch } from './MossHttpClient.js'

/**
 * Moss Park 端口（园区 AI 招商 P0）：
 * - 园区侧 /api/v1/parks/:parkOrgId/*、企业侧 /api/v1/enterprise/*
 * - 上下文 /api/v1/park/context；注册走独立免登录路径（由 BFF 直接调，不经此 port 的 ctx）
 */

export interface MossParkPort {
  context(ctx: MossCallContext): Promise<unknown>
  settings(ctx: MossCallContext, parkOrgId: string): Promise<unknown>
  updateSettings(ctx: MossCallContext, parkOrgId: string, body: unknown): Promise<unknown>
  enterprises(ctx: MossCallContext, parkOrgId: string): Promise<unknown>
  enterpriseDetail(ctx: MossCallContext, parkOrgId: string, enterpriseOrgId: string): Promise<unknown>
  updateEnterpriseFollowUp(ctx: MossCallContext, parkOrgId: string, enterpriseOrgId: string, body: unknown): Promise<unknown>
  createBinding(ctx: MossCallContext, parkOrgId: string, body: unknown): Promise<unknown>
  leads(ctx: MossCallContext, parkOrgId: string, query?: { status?: string; watched?: boolean }): Promise<unknown>
  createManualLead(ctx: MossCallContext, parkOrgId: string, body: unknown): Promise<unknown>
  leadDetail(ctx: MossCallContext, parkOrgId: string, leadId: string): Promise<unknown>
  claimLead(ctx: MossCallContext, parkOrgId: string, leadId: string): Promise<unknown>
  updateLead(ctx: MossCallContext, parkOrgId: string, leadId: string, body: unknown): Promise<unknown>
  watchLead(ctx: MossCallContext, parkOrgId: string, leadId: string): Promise<unknown>
  unwatchLead(ctx: MossCallContext, parkOrgId: string, leadId: string): Promise<unknown>
  consultations(ctx: MossCallContext, parkOrgId: string): Promise<unknown>
  metrics(ctx: MossCallContext, parkOrgId: string): Promise<unknown>
  auditEvents(ctx: MossCallContext, parkOrgId: string): Promise<unknown>
  members(ctx: MossCallContext, parkOrgId: string): Promise<unknown>
  addMember(ctx: MossCallContext, parkOrgId: string, body: unknown): Promise<unknown>
  removeMember(ctx: MossCallContext, parkOrgId: string, userId: string): Promise<unknown>
  assignments(ctx: MossCallContext, parkOrgId: string): Promise<unknown>
  assignAssistant(ctx: MossCallContext, parkOrgId: string, body: unknown): Promise<unknown>
  unassignAssistant(ctx: MossCallContext, parkOrgId: string, assistantId: string, enterpriseOrgId: string): Promise<unknown>
  enterpriseProfile(ctx: MossCallContext): Promise<unknown>
  enterprisePolicies(ctx: MossCallContext): Promise<unknown>
  enterpriseServices(ctx: MossCallContext): Promise<unknown>
  enterpriseInquiries(ctx: MossCallContext): Promise<unknown>
  enterpriseAssistants(ctx: MossCallContext): Promise<unknown>
  /** 免登录注册（无 MossCallContext——墙前直调） */
  registerEnterprise(baseUrl: string, body: unknown): Promise<unknown>
}

function seg(value: string): string {
  return encodeURIComponent(value)
}

export function createMossParkPort(mossFetch: MossFetch): MossParkPort {
  const park = (parkOrgId: string, suffix = '') => `/api/v1/parks/${seg(parkOrgId)}${suffix}`
  return {
    context: (ctx) => mossFetch(ctx.baseUrl, { method: 'GET', path: '/api/v1/park/context', accessToken: ctx.accessToken }),
    settings: (ctx, parkOrgId) => mossFetch(ctx.baseUrl, { method: 'GET', path: park(parkOrgId, '/settings'), accessToken: ctx.accessToken }),
    updateSettings: (ctx, parkOrgId, body) => mossFetch(ctx.baseUrl, { method: 'PUT', path: park(parkOrgId, '/settings'), accessToken: ctx.accessToken, body }),
    enterprises: (ctx, parkOrgId) => mossFetch(ctx.baseUrl, { method: 'GET', path: park(parkOrgId, '/enterprises'), accessToken: ctx.accessToken }),
    enterpriseDetail: (ctx, parkOrgId, enterpriseOrgId) => mossFetch(ctx.baseUrl, { method: 'GET', path: park(parkOrgId, `/enterprises/${seg(enterpriseOrgId)}`), accessToken: ctx.accessToken }),
    updateEnterpriseFollowUp: (ctx, parkOrgId, enterpriseOrgId, body) => mossFetch(ctx.baseUrl, { method: 'PATCH', path: park(parkOrgId, `/enterprises/${seg(enterpriseOrgId)}`), accessToken: ctx.accessToken, body }),
    createBinding: (ctx, parkOrgId, body) => mossFetch(ctx.baseUrl, { method: 'POST', path: park(parkOrgId, '/enterprise-bindings'), accessToken: ctx.accessToken, body }),
    leads: (ctx, parkOrgId, query) => {
      const params = new URLSearchParams()
      if (query?.status) params.set('status', query.status)
      if (query?.watched) params.set('watched', '1')
      const qs = params.toString()
      return mossFetch(ctx.baseUrl, { method: 'GET', path: park(parkOrgId, `/leads${qs ? `?${qs}` : ''}`), accessToken: ctx.accessToken })
    },
    createManualLead: (ctx, parkOrgId, body) => mossFetch(ctx.baseUrl, { method: 'POST', path: park(parkOrgId, '/leads'), accessToken: ctx.accessToken, body }),
    leadDetail: (ctx, parkOrgId, leadId) => mossFetch(ctx.baseUrl, { method: 'GET', path: park(parkOrgId, `/leads/${seg(leadId)}`), accessToken: ctx.accessToken }),
    claimLead: (ctx, parkOrgId, leadId) => mossFetch(ctx.baseUrl, { method: 'POST', path: park(parkOrgId, `/leads/${seg(leadId)}/claim`), accessToken: ctx.accessToken }),
    updateLead: (ctx, parkOrgId, leadId, body) => mossFetch(ctx.baseUrl, { method: 'PATCH', path: park(parkOrgId, `/leads/${seg(leadId)}`), accessToken: ctx.accessToken, body }),
    watchLead: (ctx, parkOrgId, leadId) => mossFetch(ctx.baseUrl, { method: 'POST', path: park(parkOrgId, `/leads/${seg(leadId)}/watch`), accessToken: ctx.accessToken }),
    unwatchLead: (ctx, parkOrgId, leadId) => mossFetch(ctx.baseUrl, { method: 'DELETE', path: park(parkOrgId, `/leads/${seg(leadId)}/watch`), accessToken: ctx.accessToken }),
    consultations: (ctx, parkOrgId) => mossFetch(ctx.baseUrl, { method: 'GET', path: park(parkOrgId, '/consultations'), accessToken: ctx.accessToken }),
    metrics: (ctx, parkOrgId) => mossFetch(ctx.baseUrl, { method: 'GET', path: park(parkOrgId, '/metrics'), accessToken: ctx.accessToken }),
    auditEvents: (ctx, parkOrgId) => mossFetch(ctx.baseUrl, { method: 'GET', path: park(parkOrgId, '/audit-events'), accessToken: ctx.accessToken }),
    members: (ctx, parkOrgId) => mossFetch(ctx.baseUrl, { method: 'GET', path: park(parkOrgId, '/members'), accessToken: ctx.accessToken }),
    addMember: (ctx, parkOrgId, body) => mossFetch(ctx.baseUrl, { method: 'POST', path: park(parkOrgId, '/members'), accessToken: ctx.accessToken, body }),
    removeMember: (ctx, parkOrgId, userId) => mossFetch(ctx.baseUrl, { method: 'DELETE', path: park(parkOrgId, `/members?user_id=${seg(userId)}`), accessToken: ctx.accessToken }),
    assignments: (ctx, parkOrgId) => mossFetch(ctx.baseUrl, { method: 'GET', path: park(parkOrgId, '/assistant-assignments'), accessToken: ctx.accessToken }),
    assignAssistant: (ctx, parkOrgId, body) => mossFetch(ctx.baseUrl, { method: 'POST', path: park(parkOrgId, '/assistant-assignments'), accessToken: ctx.accessToken, body }),
    unassignAssistant: (ctx, parkOrgId, assistantId, enterpriseOrgId) =>
      mossFetch(ctx.baseUrl, { method: 'DELETE', path: park(parkOrgId, `/assistant-assignments?assistant_id=${seg(assistantId)}&enterprise_org_id=${seg(enterpriseOrgId)}`), accessToken: ctx.accessToken }),
    enterpriseProfile: (ctx) => mossFetch(ctx.baseUrl, { method: 'GET', path: '/api/v1/enterprise/profile', accessToken: ctx.accessToken }),
    enterprisePolicies: (ctx) => mossFetch(ctx.baseUrl, { method: 'GET', path: '/api/v1/enterprise/policies', accessToken: ctx.accessToken }),
    enterpriseServices: (ctx) => mossFetch(ctx.baseUrl, { method: 'GET', path: '/api/v1/enterprise/services', accessToken: ctx.accessToken }),
    enterpriseInquiries: (ctx) => mossFetch(ctx.baseUrl, { method: 'GET', path: '/api/v1/enterprise/inquiries', accessToken: ctx.accessToken }),
    enterpriseAssistants: (ctx) => mossFetch(ctx.baseUrl, { method: 'GET', path: '/api/v1/enterprise/assistant', accessToken: ctx.accessToken }),
    registerEnterprise: (baseUrl, body) => mossFetch(baseUrl, { method: 'POST', path: '/api/v1/park/register-enterprise', body }),
  }
}
