import { describe, expect, test, vi } from 'vitest'
import { createMossMcpPort } from '@sudowork/moss-client'

const BASE = 'http://moss.test'
const TK = 'tk'
const CTX = { accessToken: TK, baseUrl: BASE }

describe('MossMcpPort request shapes（修订版 3.9）', () => {
  test('server/template/policy endpoints', async () => {
    const mock = vi.fn().mockResolvedValue([])
    const port = createMossMcpPort(mock)
    await port.servers(CTX)
    await port.templates(CTX)
    await port.policy(CTX)
    await port.userProfile(CTX)
    await port.tenantConfig(CTX)
    const paths = mock.mock.calls.map((c) => (c[1] as { path: string }).path)
    expect(paths).toEqual([
      '/api/v1/me/mcp-servers',
      '/api/v1/me/mcp-templates',
      '/api/v1/tenant/mcp-policy',
      '/api/v1/user/profile',
      '/api/v1/tenant/config',
    ])
  })

  test('template install sends config_values/auth_credentials/display_name precisely', async () => {
    const mock = vi.fn().mockResolvedValue({})
    const port = createMossMcpPort(mock)
    await port.installTemplate(CTX, 'tpl-1', {
      config_values: { url: 'https://x' },
      auth_credentials: { token: 'secret' },
      display_name: '我的 MCP',
    })
    expect(mock).toHaveBeenCalledWith(BASE, {
      method: 'POST',
      path: '/api/v1/me/mcp-templates/tpl-1/install',
      accessToken: TK,
      body: {
        config_values: { url: 'https://x' },
        auth_credentials: { token: 'secret' },
        display_name: '我的 MCP',
      },
    })
  })

  test('enable/disable are PUT; test/user-config/patch/delete paths', async () => {
    const mock = vi.fn().mockResolvedValue({})
    const port = createMossMcpPort(mock)
    await port.setEnabled(CTX, 's1', true)
    await port.setEnabled(CTX, 's1', false)
    await port.test(CTX, 's1')
    await port.getUserConfig(CTX, 's1')
    await port.putUserConfig(CTX, 's1', { config_values: { a: '1' } })
    await port.updateServer(CTX, 's1', { display_name: 'x' })
    await port.deleteServer(CTX, 's1')
    const calls = mock.mock.calls.map((c) => c[1] as { method: string; path: string })
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'PUT /api/v1/me/mcp-servers/s1/enable',
      'PUT /api/v1/me/mcp-servers/s1/disable',
      'POST /api/v1/me/mcp-servers/s1/test',
      'GET /api/v1/me/mcp-servers/s1/user-config',
      'PUT /api/v1/me/mcp-servers/s1/user-config',
      'PATCH /api/v1/me/mcp-servers/s1',
      'DELETE /api/v1/me/mcp-servers/s1',
    ])
  })
})
