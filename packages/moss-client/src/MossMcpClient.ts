import { type MossCallContext, type MossFetch } from './MossHttpClient.js'

/**
 * Moss MCP 端口（计划 3.9 修订版）：
 * - own personal 判定：响应无 owner 字段，用 scope === 'user'（服务端 SQL 保证本人）
 * - 列表仅含 status === 'enabled' 的服务器（pending/error 个人 MCP 不出现）
 * - template install 精确发送 config_values / auth_credentials / display_name
 * 每次调用传入 MossCallContext（access token + 会话生效的 moss 地址）。
 */

export interface MossMcpPort {
  servers(ctx: MossCallContext): Promise<unknown>
  templates(ctx: MossCallContext): Promise<unknown>
  installTemplate(
    ctx: MossCallContext,
    templateId: string,
    body: { config_values?: Record<string, string>; auth_credentials?: Record<string, string>; display_name?: string },
  ): Promise<unknown>
  installJson(ctx: MossCallContext, body: { json_config: string; name?: string }): Promise<unknown>
  createServer(ctx: MossCallContext, body: unknown): Promise<unknown>
  setEnabled(ctx: MossCallContext, id: string, enabled: boolean): Promise<unknown>
  test(ctx: MossCallContext, id: string): Promise<unknown>
  getUserConfig(ctx: MossCallContext, id: string): Promise<unknown>
  putUserConfig(ctx: MossCallContext, id: string, body: { config_values: Record<string, string> }): Promise<unknown>
  updateServer(ctx: MossCallContext, id: string, body: unknown): Promise<unknown>
  deleteServer(ctx: MossCallContext, id: string): Promise<unknown>
  policy(ctx: MossCallContext): Promise<unknown>
  userProfile(ctx: MossCallContext): Promise<unknown>
  tenantConfig(ctx: MossCallContext): Promise<unknown>
}

function seg(value: string): string {
  return encodeURIComponent(value)
}

export function createMossMcpPort(mossFetch: MossFetch): MossMcpPort {
  return {
    servers: (ctx) =>
      mossFetch(ctx.baseUrl, { method: 'GET', path: '/api/v1/me/mcp-servers', accessToken: ctx.accessToken }),
    templates: (ctx) =>
      mossFetch(ctx.baseUrl, { method: 'GET', path: '/api/v1/me/mcp-templates', accessToken: ctx.accessToken }),
    installTemplate: (ctx, templateId, body) =>
      mossFetch(ctx.baseUrl, {
        method: 'POST',
        path: `/api/v1/me/mcp-templates/${seg(templateId)}/install`,
        accessToken: ctx.accessToken,
        body,
      }),
    installJson: (ctx, body) =>
      mossFetch(ctx.baseUrl, {
        method: 'POST',
        path: '/api/v1/me/mcp-servers/install-json',
        accessToken: ctx.accessToken,
        body,
      }),
    createServer: (ctx, body) =>
      mossFetch(ctx.baseUrl, { method: 'POST', path: '/api/v1/me/mcp-servers', accessToken: ctx.accessToken, body }),
    setEnabled: (ctx, id, enabled) =>
      mossFetch(ctx.baseUrl, {
        method: 'PUT',
        path: `/api/v1/me/mcp-servers/${seg(id)}/${enabled ? 'enable' : 'disable'}`,
        accessToken: ctx.accessToken,
      }),
    test: (ctx, id) =>
      mossFetch(ctx.baseUrl, {
        method: 'POST',
        path: `/api/v1/me/mcp-servers/${seg(id)}/test`,
        accessToken: ctx.accessToken,
      }),
    getUserConfig: (ctx, id) =>
      mossFetch(ctx.baseUrl, {
        method: 'GET',
        path: `/api/v1/me/mcp-servers/${seg(id)}/user-config`,
        accessToken: ctx.accessToken,
      }),
    putUserConfig: (ctx, id, body) =>
      mossFetch(ctx.baseUrl, {
        method: 'PUT',
        path: `/api/v1/me/mcp-servers/${seg(id)}/user-config`,
        accessToken: ctx.accessToken,
        body,
      }),
    updateServer: (ctx, id, body) =>
      mossFetch(ctx.baseUrl, {
        method: 'PATCH',
        path: `/api/v1/me/mcp-servers/${seg(id)}`,
        accessToken: ctx.accessToken,
        body,
      }),
    deleteServer: (ctx, id) =>
      mossFetch(ctx.baseUrl, {
        method: 'DELETE',
        path: `/api/v1/me/mcp-servers/${seg(id)}`,
        accessToken: ctx.accessToken,
      }),
    policy: (ctx) =>
      mossFetch(ctx.baseUrl, { method: 'GET', path: '/api/v1/tenant/mcp-policy', accessToken: ctx.accessToken }),
    userProfile: (ctx) =>
      mossFetch(ctx.baseUrl, { method: 'GET', path: '/api/v1/user/profile', accessToken: ctx.accessToken }),
    tenantConfig: (ctx) =>
      mossFetch(ctx.baseUrl, { method: 'GET', path: '/api/v1/tenant/config', accessToken: ctx.accessToken }),
  }
}
