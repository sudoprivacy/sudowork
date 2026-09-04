import { type MossCallContext, type MossFetch } from './MossHttpClient.js'

/**
 * Moss Skill 端口（计划 3.9 修订版映射）：
 * Hub 前缀为 /api/v1/skill-hub/*；enabled 请求体是单个 {skillName, enabled, sourcePath?}。
 * 每次调用传入 MossCallContext（access token + 会话生效的 moss 地址）。
 */

export interface MossSkillPort {
  hubCategories(ctx: MossCallContext): Promise<unknown>
  hubList(ctx: MossCallContext, searchParams: Record<string, string>): Promise<unknown>
  hubDetail(ctx: MossCallContext, id: string): Promise<unknown>
  installed(ctx: MossCallContext): Promise<unknown>
  install(ctx: MossCallContext, body: unknown): Promise<unknown>
  setEnabled(ctx: MossCallContext, body: { skillName: string; enabled: boolean }): Promise<unknown>
  uploadCustom(ctx: MossCallContext, body: { file: string }): Promise<unknown>
  uninstall(ctx: MossCallContext, body: unknown): Promise<unknown>
  syncFromHub(ctx: MossCallContext): Promise<unknown>
  syncStatus(ctx: MossCallContext): Promise<unknown>
  tenantList(ctx: MossCallContext): Promise<unknown>
  tenantUpload(ctx: MossCallContext, body: unknown): Promise<unknown>
  tenantUpdate(ctx: MossCallContext, id: string, body: unknown): Promise<unknown>
  tenantDelete(ctx: MossCallContext, id: string): Promise<unknown>
  tenantDownload(ctx: MossCallContext, id: string): Promise<unknown>
  tenantPublish(ctx: MossCallContext, body: unknown): Promise<unknown>
}

function seg(value: string): string {
  return encodeURIComponent(value)
}

export function createMossSkillPort(mossFetch: MossFetch): MossSkillPort {
  return {
    hubCategories: (ctx) =>
      mossFetch(ctx.baseUrl, { method: 'GET', path: '/api/v1/skill-hub/categories', accessToken: ctx.accessToken }),
    hubList: (ctx, searchParams) =>
      mossFetch(ctx.baseUrl, {
        method: 'GET',
        path: '/api/v1/skill-hub/skills/cursor',
        accessToken: ctx.accessToken,
        searchParams,
      }),
    hubDetail: (ctx, id) =>
      mossFetch(ctx.baseUrl, {
        method: 'GET',
        path: `/api/v1/skill-hub/skills/${seg(id)}`,
        accessToken: ctx.accessToken,
      }),
    installed: (ctx) =>
      mossFetch(ctx.baseUrl, { method: 'GET', path: '/api/v1/skills/installed', accessToken: ctx.accessToken }),
    install: (ctx, body) =>
      mossFetch(ctx.baseUrl, { method: 'POST', path: '/api/v1/skills/install', accessToken: ctx.accessToken, body }),
    setEnabled: (ctx, body) =>
      mossFetch(ctx.baseUrl, { method: 'PATCH', path: '/api/v1/skills/enabled', accessToken: ctx.accessToken, body }),
    uploadCustom: (ctx, body) =>
      mossFetch(ctx.baseUrl, { method: 'POST', path: '/api/v1/skills/custom', accessToken: ctx.accessToken, body }),
    uninstall: (ctx, body) =>
      mossFetch(ctx.baseUrl, { method: 'POST', path: '/api/v1/skills/uninstall', accessToken: ctx.accessToken, body }),
    syncFromHub: (ctx) =>
      mossFetch(ctx.baseUrl, { method: 'POST', path: '/api/v1/skills/sync-from-hub', accessToken: ctx.accessToken }),
    syncStatus: (ctx) =>
      mossFetch(ctx.baseUrl, { method: 'GET', path: '/api/v1/skills/sync-status', accessToken: ctx.accessToken }),
    tenantList: (ctx) =>
      mossFetch(ctx.baseUrl, { method: 'GET', path: '/api/v1/skills/tenant', accessToken: ctx.accessToken }),
    tenantUpload: (ctx, body) =>
      mossFetch(ctx.baseUrl, {
        method: 'POST',
        path: '/api/v1/skills/tenant/upload',
        accessToken: ctx.accessToken,
        body,
      }),
    tenantUpdate: (ctx, id, body) =>
      mossFetch(ctx.baseUrl, {
        method: 'PATCH',
        path: `/api/v1/skills/tenant/${seg(id)}`,
        accessToken: ctx.accessToken,
        body,
      }),
    tenantDelete: (ctx, id) =>
      mossFetch(ctx.baseUrl, {
        method: 'DELETE',
        path: `/api/v1/skills/tenant/${seg(id)}`,
        accessToken: ctx.accessToken,
      }),
    tenantDownload: (ctx, id) =>
      mossFetch(ctx.baseUrl, {
        method: 'GET',
        path: `/api/v1/skills/tenant/${seg(id)}/download`,
        accessToken: ctx.accessToken,
      }),
    tenantPublish: (ctx, body) =>
      mossFetch(ctx.baseUrl, {
        method: 'POST',
        path: '/api/v1/skills/tenant/publish',
        accessToken: ctx.accessToken,
        body,
      }),
  }
}
