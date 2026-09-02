import { type MossFetch } from './MossHttpClient.js'

/**
 * Moss MCP 端口（计划 3.9 修订版）：
 * - own personal 判定：响应无 owner 字段，用 scope === 'user'（服务端 SQL 保证本人）
 * - 列表仅含 status === 'enabled' 的服务器（pending/error 个人 MCP 不出现）
 * - template install 精确发送 config_values / auth_credentials / display_name
 */

export interface MossMcpPort {
  servers(accessToken: string): Promise<unknown>
  templates(accessToken: string): Promise<unknown>
  installTemplate(
    accessToken: string,
    templateId: string,
    body: { config_values?: Record<string, string>; auth_credentials?: Record<string, string>; display_name?: string },
  ): Promise<unknown>
  installJson(accessToken: string, body: { json_config: string; name?: string }): Promise<unknown>
  createServer(accessToken: string, body: unknown): Promise<unknown>
  setEnabled(accessToken: string, id: string, enabled: boolean): Promise<unknown>
  test(accessToken: string, id: string): Promise<unknown>
  getUserConfig(accessToken: string, id: string): Promise<unknown>
  putUserConfig(accessToken: string, id: string, body: { config_values: Record<string, string> }): Promise<unknown>
  updateServer(accessToken: string, id: string, body: unknown): Promise<unknown>
  deleteServer(accessToken: string, id: string): Promise<unknown>
  policy(accessToken: string): Promise<unknown>
  userProfile(accessToken: string): Promise<unknown>
  tenantConfig(accessToken: string): Promise<unknown>
}

function seg(value: string): string {
  return encodeURIComponent(value)
}

export function createMossMcpPort(mossFetch: MossFetch, baseUrl: string): MossMcpPort {
  return {
    servers: (tk) => mossFetch(baseUrl, { method: 'GET', path: '/api/v1/me/mcp-servers', accessToken: tk }),
    templates: (tk) => mossFetch(baseUrl, { method: 'GET', path: '/api/v1/me/mcp-templates', accessToken: tk }),
    installTemplate: (tk, templateId, body) =>
      mossFetch(baseUrl, {
        method: 'POST',
        path: `/api/v1/me/mcp-templates/${seg(templateId)}/install`,
        accessToken: tk,
        body,
      }),
    installJson: (tk, body) =>
      mossFetch(baseUrl, {
        method: 'POST',
        path: '/api/v1/me/mcp-servers/install-json',
        accessToken: tk,
        body,
      }),
    createServer: (tk, body) =>
      mossFetch(baseUrl, { method: 'POST', path: '/api/v1/me/mcp-servers', accessToken: tk, body }),
    setEnabled: (tk, id, enabled) =>
      mossFetch(baseUrl, {
        method: 'PUT',
        path: `/api/v1/me/mcp-servers/${seg(id)}/${enabled ? 'enable' : 'disable'}`,
        accessToken: tk,
      }),
    test: (tk, id) =>
      mossFetch(baseUrl, { method: 'POST', path: `/api/v1/me/mcp-servers/${seg(id)}/test`, accessToken: tk }),
    getUserConfig: (tk, id) =>
      mossFetch(baseUrl, {
        method: 'GET',
        path: `/api/v1/me/mcp-servers/${seg(id)}/user-config`,
        accessToken: tk,
      }),
    putUserConfig: (tk, id, body) =>
      mossFetch(baseUrl, {
        method: 'PUT',
        path: `/api/v1/me/mcp-servers/${seg(id)}/user-config`,
        accessToken: tk,
        body,
      }),
    updateServer: (tk, id, body) =>
      mossFetch(baseUrl, {
        method: 'PATCH',
        path: `/api/v1/me/mcp-servers/${seg(id)}`,
        accessToken: tk,
        body,
      }),
    deleteServer: (tk, id) =>
      mossFetch(baseUrl, {
        method: 'DELETE',
        path: `/api/v1/me/mcp-servers/${seg(id)}`,
        accessToken: tk,
      }),
    policy: (tk) => mossFetch(baseUrl, { method: 'GET', path: '/api/v1/tenant/mcp-policy', accessToken: tk }),
    userProfile: (tk) => mossFetch(baseUrl, { method: 'GET', path: '/api/v1/user/profile', accessToken: tk }),
    tenantConfig: (tk) => mossFetch(baseUrl, { method: 'GET', path: '/api/v1/tenant/config', accessToken: tk }),
  }
}
