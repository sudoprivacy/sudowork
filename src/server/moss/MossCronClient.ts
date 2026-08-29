import { type MossFetch } from './MossHttpClient.js'

/**
 * Moss Cron 端口（计划 3.9 修订版）：
 * - 普通列表 GET /api/v1/cron/jobs；admin:cron/cron:list:any → GET /api/v1/admin/cron/jobs
 * - schedule DTO：{kind:'at'|'every'|'cron', value, tz?, description?}（无 expr 字段）
 * - 引用仅 assistantId/assistantName（基线无 skill 字段）
 */

export interface MossCronPort {
  list(accessToken: string): Promise<unknown>
  adminList(accessToken: string): Promise<unknown>
  get(accessToken: string, id: string): Promise<unknown>
  create(accessToken: string, body: unknown): Promise<unknown>
  update(accessToken: string, id: string, body: unknown): Promise<unknown>
  remove(accessToken: string, id: string): Promise<unknown>
  trigger(accessToken: string, id: string): Promise<unknown>
  runs(accessToken: string, id: string, limit: number): Promise<unknown>
}

function seg(value: string): string {
  return encodeURIComponent(value)
}

export function createMossCronPort(mossFetch: MossFetch, baseUrl: string): MossCronPort {
  return {
    list: (tk) => mossFetch(baseUrl, { method: 'GET', path: '/api/v1/cron/jobs', accessToken: tk }),
    adminList: (tk) =>
      mossFetch(baseUrl, { method: 'GET', path: '/api/v1/admin/cron/jobs', accessToken: tk }),
    get: (tk, id) =>
      mossFetch(baseUrl, { method: 'GET', path: `/api/v1/cron/jobs/${seg(id)}`, accessToken: tk }),
    create: (tk, body) =>
      mossFetch(baseUrl, { method: 'POST', path: '/api/v1/cron/jobs', accessToken: tk, body }),
    update: (tk, id, body) =>
      mossFetch(baseUrl, {
        method: 'PATCH',
        path: `/api/v1/cron/jobs/${seg(id)}`,
        accessToken: tk,
        body,
      }),
    remove: (tk, id) =>
      mossFetch(baseUrl, { method: 'DELETE', path: `/api/v1/cron/jobs/${seg(id)}`, accessToken: tk }),
    trigger: (tk, id) =>
      mossFetch(baseUrl, {
        method: 'POST',
        path: `/api/v1/cron/jobs/${seg(id)}/trigger`,
        accessToken: tk,
      }),
    runs: (tk, id, limit) =>
      mossFetch(baseUrl, {
        method: 'GET',
        path: `/api/v1/cron/jobs/${seg(id)}/runs`,
        accessToken: tk,
        searchParams: { limit: String(limit) },
      }),
  }
}
