import { type MossCallContext, type MossFetch } from './MossHttpClient.js'

/**
 * Moss Cron 端口（计划 3.9 修订版）：
 * - 普通列表 GET /api/v1/cron/jobs；admin:cron/cron:list:any → GET /api/v1/admin/cron/jobs
 * - schedule DTO：{kind:'at'|'every'|'cron', value, tz?, description?}（无 expr 字段）
 * - 引用仅 assistantId/assistantName（基线无 skill 字段）
 * 每次调用传入 MossCallContext（access token + 会话生效的 moss 地址）。
 */

export interface MossCronPort {
  list(ctx: MossCallContext): Promise<unknown>
  adminList(ctx: MossCallContext): Promise<unknown>
  get(ctx: MossCallContext, id: string): Promise<unknown>
  create(ctx: MossCallContext, body: unknown): Promise<unknown>
  update(ctx: MossCallContext, id: string, body: unknown): Promise<unknown>
  remove(ctx: MossCallContext, id: string): Promise<unknown>
  trigger(ctx: MossCallContext, id: string): Promise<unknown>
  runs(ctx: MossCallContext, id: string, limit: number): Promise<unknown>
}

function seg(value: string): string {
  return encodeURIComponent(value)
}

export function createMossCronPort(mossFetch: MossFetch): MossCronPort {
  return {
    list: (ctx) => mossFetch(ctx.baseUrl, { method: 'GET', path: '/api/v1/cron/jobs', accessToken: ctx.accessToken }),
    adminList: (ctx) =>
      mossFetch(ctx.baseUrl, { method: 'GET', path: '/api/v1/admin/cron/jobs', accessToken: ctx.accessToken }),
    get: (ctx, id) =>
      mossFetch(ctx.baseUrl, { method: 'GET', path: `/api/v1/cron/jobs/${seg(id)}`, accessToken: ctx.accessToken }),
    create: (ctx, body) =>
      mossFetch(ctx.baseUrl, { method: 'POST', path: '/api/v1/cron/jobs', accessToken: ctx.accessToken, body }),
    update: (ctx, id, body) =>
      mossFetch(ctx.baseUrl, {
        method: 'PATCH',
        path: `/api/v1/cron/jobs/${seg(id)}`,
        accessToken: ctx.accessToken,
        body,
      }),
    remove: (ctx, id) =>
      mossFetch(ctx.baseUrl, { method: 'DELETE', path: `/api/v1/cron/jobs/${seg(id)}`, accessToken: ctx.accessToken }),
    trigger: (ctx, id) =>
      mossFetch(ctx.baseUrl, {
        method: 'POST',
        path: `/api/v1/cron/jobs/${seg(id)}/trigger`,
        accessToken: ctx.accessToken,
      }),
    runs: (ctx, id, limit) =>
      mossFetch(ctx.baseUrl, {
        method: 'GET',
        path: `/api/v1/cron/jobs/${seg(id)}/runs`,
        accessToken: ctx.accessToken,
        searchParams: { limit: String(limit) },
      }),
  }
}
