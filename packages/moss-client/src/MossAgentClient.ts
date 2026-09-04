import { type MossCallContext, type MossFetch } from './MossHttpClient.js'

/**
 * Moss Agent 端口（计划 3.9 修订版映射）：
 * Hub 前缀为 /api/v1/agent-hub/*；installed 无独立 enabled 接口；
 * rules 是 /api/v1/agents/installed/:name/rules（admin:settings）。
 * 每次调用传入 MossCallContext（access token + 会话生效的 moss 地址）。
 */

export interface MossAgentPort {
  hubCategories(ctx: MossCallContext): Promise<unknown>
  hubList(ctx: MossCallContext, searchParams: Record<string, string>): Promise<unknown>
  hubDetail(ctx: MossCallContext, id: string): Promise<unknown>
  installed(ctx: MossCallContext): Promise<unknown>
  install(ctx: MossCallContext, body: unknown): Promise<unknown>
  create(ctx: MossCallContext, body: unknown): Promise<unknown>
  uploadCustom(ctx: MossCallContext, body: { file: string }): Promise<unknown>
  updateMeta(ctx: MossCallContext, body: unknown): Promise<unknown>
  uninstall(ctx: MossCallContext, body: unknown): Promise<unknown>
  syncFromHub(ctx: MossCallContext): Promise<unknown>
  syncStatus(ctx: MossCallContext): Promise<unknown>
  installedRules(ctx: MossCallContext, assistantName: string): Promise<unknown>
  tenantList(ctx: MossCallContext): Promise<unknown>
  tenantCreate(ctx: MossCallContext, body: unknown): Promise<unknown>
  tenantUpdate(ctx: MossCallContext, id: string, body: unknown): Promise<unknown>
  tenantDelete(ctx: MossCallContext, id: string): Promise<unknown>
  tenantDownload(ctx: MossCallContext, id: string): Promise<unknown>
  tenantPublish(ctx: MossCallContext, body: unknown): Promise<unknown>
}

function seg(value: string): string {
  return encodeURIComponent(value)
}

export function createMossAgentPort(mossFetch: MossFetch): MossAgentPort {
  return {
    hubCategories: (ctx) =>
      mossFetch(ctx.baseUrl, { method: 'GET', path: '/api/v1/agent-hub/categories', accessToken: ctx.accessToken }),
    hubList: (ctx, searchParams) =>
      mossFetch(ctx.baseUrl, {
        method: 'GET',
        path: '/api/v1/agent-hub/assistants/cursor',
        accessToken: ctx.accessToken,
        searchParams,
      }),
    hubDetail: (ctx, id) =>
      mossFetch(ctx.baseUrl, {
        method: 'GET',
        path: `/api/v1/agent-hub/assistants/${seg(id)}`,
        accessToken: ctx.accessToken,
      }),
    installed: (ctx) =>
      mossFetch(ctx.baseUrl, { method: 'GET', path: '/api/v1/agents/installed', accessToken: ctx.accessToken }),
    install: (ctx, body) =>
      mossFetch(ctx.baseUrl, { method: 'POST', path: '/api/v1/agents/install', accessToken: ctx.accessToken, body }),
    create: (ctx, body) =>
      mossFetch(ctx.baseUrl, { method: 'POST', path: '/api/v1/agents/create', accessToken: ctx.accessToken, body }),
    uploadCustom: (ctx, body) =>
      mossFetch(ctx.baseUrl, { method: 'POST', path: '/api/v1/agents/custom', accessToken: ctx.accessToken, body }),
    updateMeta: (ctx, body) =>
      mossFetch(ctx.baseUrl, { method: 'PATCH', path: '/api/v1/agents/meta', accessToken: ctx.accessToken, body }),
    uninstall: (ctx, body) =>
      mossFetch(ctx.baseUrl, { method: 'POST', path: '/api/v1/agents/uninstall', accessToken: ctx.accessToken, body }),
    syncFromHub: (ctx) =>
      mossFetch(ctx.baseUrl, { method: 'POST', path: '/api/v1/agents/sync-from-hub', accessToken: ctx.accessToken }),
    syncStatus: (ctx) =>
      mossFetch(ctx.baseUrl, { method: 'GET', path: '/api/v1/agents/sync-status', accessToken: ctx.accessToken }),
    installedRules: (ctx, assistantName) =>
      mossFetch(ctx.baseUrl, {
        method: 'GET',
        path: `/api/v1/agents/installed/${seg(assistantName)}/rules`,
        accessToken: ctx.accessToken,
      }),
    tenantList: (ctx) =>
      mossFetch(ctx.baseUrl, { method: 'GET', path: '/api/v1/agents/tenant', accessToken: ctx.accessToken }),
    tenantCreate: (ctx, body) =>
      mossFetch(ctx.baseUrl, {
        method: 'POST',
        path: '/api/v1/agents/tenant/create',
        accessToken: ctx.accessToken,
        body,
      }),
    tenantUpdate: (ctx, id, body) =>
      mossFetch(ctx.baseUrl, {
        method: 'PATCH',
        path: `/api/v1/agents/tenant/${seg(id)}`,
        accessToken: ctx.accessToken,
        body,
      }),
    tenantDelete: (ctx, id) =>
      mossFetch(ctx.baseUrl, {
        method: 'DELETE',
        path: `/api/v1/agents/tenant/${seg(id)}`,
        accessToken: ctx.accessToken,
      }),
    tenantDownload: (ctx, id) =>
      mossFetch(ctx.baseUrl, {
        method: 'GET',
        path: `/api/v1/agents/tenant/${seg(id)}/download`,
        accessToken: ctx.accessToken,
      }),
    tenantPublish: (ctx, body) =>
      mossFetch(ctx.baseUrl, {
        method: 'POST',
        path: '/api/v1/agents/tenant/publish',
        accessToken: ctx.accessToken,
        body,
      }),
  }
}
