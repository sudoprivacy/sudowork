async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  if (!res.ok) {
    const code =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'UNKNOWN'
    throw Object.assign(new Error(code), { status: res.status, code })
  }
  return body as T
}

export interface DisplaySettings {
  theme: 'system' | 'light' | 'dark'
  fontScale: number
}

export const settingsApi = {
  profile: (): Promise<Record<string, unknown>> => api('/api/settings/profile'),
  getDisplay: (): Promise<DisplaySettings> => api('/api/settings/display'),
  putDisplay: (body: DisplaySettings): Promise<{ ok: true }> =>
    api('/api/settings/display', { method: 'PUT', body: JSON.stringify(body) }),
  about: (): Promise<Record<string, unknown>> => api('/api/settings/about'),
}

export interface McpServer {
  id: string
  name: string
  display_name?: string
  scope: string
  mcp_type?: string
  enabled?: boolean
  user_disabled?: boolean
  [key: string]: unknown
}

export const mcpApi = {
  servers: (): Promise<McpServer[]> => {
    const raw = api<unknown>('/api/mcp/servers')
    return raw.then((data) =>
      Array.isArray(data)
        ? (data as McpServer[])
        : ((data as { servers?: McpServer[]; data?: McpServer[] }).servers ??
          (data as { data?: McpServer[] }).data ??
          []),
    )
  },
  templates: (): Promise<unknown> => api('/api/mcp/templates'),
  policy: (): Promise<Record<string, unknown>> => api('/api/mcp/policy'),
  installTemplate: (id: string, body: Record<string, unknown>) =>
    api(`/api/mcp/templates/${encodeURIComponent(id)}/install`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  installJson: (json_config: string, name?: string) =>
    api('/api/mcp/install-json', { method: 'POST', body: JSON.stringify({ json_config, name }) }),
  enable: (id: string) => api(`/api/mcp/servers/${encodeURIComponent(id)}/enable`, { method: 'PUT' }),
  disable: (id: string) => api(`/api/mcp/servers/${encodeURIComponent(id)}/disable`, { method: 'PUT' }),
  test: (id: string) => api(`/api/mcp/servers/${encodeURIComponent(id)}/test`, { method: 'POST' }),
  remove: (id: string) => api(`/api/mcp/servers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
