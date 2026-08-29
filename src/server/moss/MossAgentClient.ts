import { type MossFetch } from './MossHttpClient.js'

/**
 * Moss Agent 端口（计划 3.9 修订版映射）：
 * Hub 前缀为 /api/v1/agent-hub/*；installed 无独立 enabled 接口；
 * rules 是 /api/v1/agents/installed/:name/rules（admin:settings）。
 * 所有方法由调用方传入该 Web Session 自己的 access token。
 */

export interface MossAgentPort {
  hubCategories(accessToken: string): Promise<unknown>
  hubList(accessToken: string, searchParams: Record<string, string>): Promise<unknown>
  hubDetail(accessToken: string, id: string): Promise<unknown>
  installed(accessToken: string): Promise<unknown>
  install(accessToken: string, body: unknown): Promise<unknown>
  create(accessToken: string, body: unknown): Promise<unknown>
  uploadCustom(accessToken: string, body: { file: string }): Promise<unknown>
  updateMeta(accessToken: string, body: unknown): Promise<unknown>
  uninstall(accessToken: string, body: unknown): Promise<unknown>
  syncFromHub(accessToken: string): Promise<unknown>
  syncStatus(accessToken: string): Promise<unknown>
  installedRules(accessToken: string, assistantName: string): Promise<unknown>
  tenantList(accessToken: string): Promise<unknown>
  tenantCreate(accessToken: string, body: unknown): Promise<unknown>
  tenantUpdate(accessToken: string, id: string, body: unknown): Promise<unknown>
  tenantDelete(accessToken: string, id: string): Promise<unknown>
  tenantDownload(accessToken: string, id: string): Promise<unknown>
  tenantPublish(accessToken: string, body: unknown): Promise<unknown>
}

function seg(value: string): string {
  return encodeURIComponent(value)
}

export function createMossAgentPort(mossFetch: MossFetch, baseUrl: string): MossAgentPort {
  return {
    hubCategories: (tk) => mossFetch(baseUrl, { method: 'GET', path: '/api/v1/agent-hub/categories', accessToken: tk }),
    hubList: (tk, searchParams) =>
      mossFetch(baseUrl, { method: 'GET', path: '/api/v1/agent-hub/assistants/cursor', accessToken: tk, searchParams }),
    hubDetail: (tk, id) =>
      mossFetch(baseUrl, { method: 'GET', path: `/api/v1/agent-hub/assistants/${seg(id)}`, accessToken: tk }),
    installed: (tk) => mossFetch(baseUrl, { method: 'GET', path: '/api/v1/agents/installed', accessToken: tk }),
    install: (tk, body) =>
      mossFetch(baseUrl, { method: 'POST', path: '/api/v1/agents/install', accessToken: tk, body }),
    create: (tk, body) =>
      mossFetch(baseUrl, { method: 'POST', path: '/api/v1/agents/create', accessToken: tk, body }),
    uploadCustom: (tk, body) =>
      mossFetch(baseUrl, { method: 'POST', path: '/api/v1/agents/custom', accessToken: tk, body }),
    updateMeta: (tk, body) =>
      mossFetch(baseUrl, { method: 'PATCH', path: '/api/v1/agents/meta', accessToken: tk, body }),
    uninstall: (tk, body) =>
      mossFetch(baseUrl, { method: 'POST', path: '/api/v1/agents/uninstall', accessToken: tk, body }),
    syncFromHub: (tk) =>
      mossFetch(baseUrl, { method: 'POST', path: '/api/v1/agents/sync-from-hub', accessToken: tk }),
    syncStatus: (tk) =>
      mossFetch(baseUrl, { method: 'GET', path: '/api/v1/agents/sync-status', accessToken: tk }),
    installedRules: (tk, assistantName) =>
      mossFetch(baseUrl, {
        method: 'GET',
        path: `/api/v1/agents/installed/${seg(assistantName)}/rules`,
        accessToken: tk,
      }),
    tenantList: (tk) => mossFetch(baseUrl, { method: 'GET', path: '/api/v1/agents/tenant', accessToken: tk }),
    tenantCreate: (tk, body) =>
      mossFetch(baseUrl, { method: 'POST', path: '/api/v1/agents/tenant/create', accessToken: tk, body }),
    tenantUpdate: (tk, id, body) =>
      mossFetch(baseUrl, { method: 'PATCH', path: `/api/v1/agents/tenant/${seg(id)}`, accessToken: tk, body }),
    tenantDelete: (tk, id) =>
      mossFetch(baseUrl, { method: 'DELETE', path: `/api/v1/agents/tenant/${seg(id)}`, accessToken: tk }),
    tenantDownload: (tk, id) =>
      mossFetch(baseUrl, { method: 'GET', path: `/api/v1/agents/tenant/${seg(id)}/download`, accessToken: tk }),
    tenantPublish: (tk, body) =>
      mossFetch(baseUrl, { method: 'POST', path: '/api/v1/agents/tenant/publish', accessToken: tk, body }),
  }
}
