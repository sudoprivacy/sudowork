import { type MossFetch } from './MossHttpClient.js'

/**
 * Moss Skill 端口（计划 3.9 修订版映射）：
 * Hub 前缀为 /api/v1/skill-hub/*；enabled 请求体是单个 {skillName, enabled, sourcePath?}。
 */

export interface MossSkillPort {
  hubCategories(accessToken: string): Promise<unknown>
  hubList(accessToken: string, searchParams: Record<string, string>): Promise<unknown>
  hubDetail(accessToken: string, id: string): Promise<unknown>
  installed(accessToken: string): Promise<unknown>
  install(accessToken: string, body: unknown): Promise<unknown>
  setEnabled(accessToken: string, body: { skillName: string; enabled: boolean }): Promise<unknown>
  uploadCustom(accessToken: string, body: { file: string }): Promise<unknown>
  uninstall(accessToken: string, body: unknown): Promise<unknown>
  syncFromHub(accessToken: string): Promise<unknown>
  syncStatus(accessToken: string): Promise<unknown>
  tenantList(accessToken: string): Promise<unknown>
  tenantUpload(accessToken: string, body: unknown): Promise<unknown>
  tenantUpdate(accessToken: string, id: string, body: unknown): Promise<unknown>
  tenantDelete(accessToken: string, id: string): Promise<unknown>
  tenantDownload(accessToken: string, id: string): Promise<unknown>
  tenantPublish(accessToken: string, body: unknown): Promise<unknown>
}

function seg(value: string): string {
  return encodeURIComponent(value)
}

export function createMossSkillPort(mossFetch: MossFetch, baseUrl: string): MossSkillPort {
  return {
    hubCategories: (tk) => mossFetch(baseUrl, { method: 'GET', path: '/api/v1/skill-hub/categories', accessToken: tk }),
    hubList: (tk, searchParams) =>
      mossFetch(baseUrl, { method: 'GET', path: '/api/v1/skill-hub/skills/cursor', accessToken: tk, searchParams }),
    hubDetail: (tk, id) =>
      mossFetch(baseUrl, { method: 'GET', path: `/api/v1/skill-hub/skills/${seg(id)}`, accessToken: tk }),
    installed: (tk) => mossFetch(baseUrl, { method: 'GET', path: '/api/v1/skills/installed', accessToken: tk }),
    install: (tk, body) =>
      mossFetch(baseUrl, { method: 'POST', path: '/api/v1/skills/install', accessToken: tk, body }),
    setEnabled: (tk, body) =>
      mossFetch(baseUrl, { method: 'PATCH', path: '/api/v1/skills/enabled', accessToken: tk, body }),
    uploadCustom: (tk, body) =>
      mossFetch(baseUrl, { method: 'POST', path: '/api/v1/skills/custom', accessToken: tk, body }),
    uninstall: (tk, body) =>
      mossFetch(baseUrl, { method: 'POST', path: '/api/v1/skills/uninstall', accessToken: tk, body }),
    syncFromHub: (tk) =>
      mossFetch(baseUrl, { method: 'POST', path: '/api/v1/skills/sync-from-hub', accessToken: tk }),
    syncStatus: (tk) =>
      mossFetch(baseUrl, { method: 'GET', path: '/api/v1/skills/sync-status', accessToken: tk }),
    tenantList: (tk) => mossFetch(baseUrl, { method: 'GET', path: '/api/v1/skills/tenant', accessToken: tk }),
    tenantUpload: (tk, body) =>
      mossFetch(baseUrl, { method: 'POST', path: '/api/v1/skills/tenant/upload', accessToken: tk, body }),
    tenantUpdate: (tk, id, body) =>
      mossFetch(baseUrl, { method: 'PATCH', path: `/api/v1/skills/tenant/${seg(id)}`, accessToken: tk, body }),
    tenantDelete: (tk, id) =>
      mossFetch(baseUrl, { method: 'DELETE', path: `/api/v1/skills/tenant/${seg(id)}`, accessToken: tk }),
    tenantDownload: (tk, id) =>
      mossFetch(baseUrl, { method: 'GET', path: `/api/v1/skills/tenant/${seg(id)}/download`, accessToken: tk }),
    tenantPublish: (tk, body) =>
      mossFetch(baseUrl, { method: 'POST', path: '/api/v1/skills/tenant/publish', accessToken: tk, body }),
  }
}
