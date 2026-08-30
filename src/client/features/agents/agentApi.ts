import { ApiError } from '@client/features/auth/authApi'

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
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }
  if (!res.ok) {
    const code =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'UNKNOWN'
    throw new ApiError(res.status, code)
  }
  return body as T
}

export interface AgentItem {
  name: string
  displayName?: string
  description?: string
  avatar?: string
  emoji?: string
  meta?: { feature?: string }
  [key: string]: unknown
}

export const agentApi = {
  listInstalled: (): Promise<AgentItem[]> => api('/api/agents'),
  getScopes: (): Promise<{ scopes: string[] }> => api('/api/agents/scopes'),
  hubCategories: (): Promise<unknown> => api('/api/agents/hub/categories'),
  hubList: (params: Record<string, string> = {}): Promise<{ items?: AgentItem[] } & Record<string, unknown>> => {
    const qs = new URLSearchParams(params).toString()
    return api(`/api/agents/hub/list${qs ? `?${qs}` : ''}`)
  },
  install: (name: string) =>
    api<{ ok: true }>('/api/agents/install', { method: 'POST', body: JSON.stringify({ name }) }),
  create: (body: Record<string, unknown>) =>
    api('/api/agents/create', { method: 'POST', body: JSON.stringify(body) }),
  uploadCustom: (file: string) =>
    api('/api/agents/custom', { method: 'POST', body: JSON.stringify({ file }) }),
  updateMeta: (name: string, updates: Record<string, unknown>) =>
    api('/api/agents/meta', { method: 'PATCH', body: JSON.stringify({ name, updates }) }),
  uninstall: (name: string) =>
    api('/api/agents/uninstall', { method: 'POST', body: JSON.stringify({ name }) }),
  sync: () => api('/api/agents/sync', { method: 'POST' }),
  tenantList: (): Promise<Record<string, unknown>[]> => api('/api/agents/tenant'),
  tenantPublish: (sourceName: string) =>
    api('/api/agents/tenant/publish', { method: 'POST', body: JSON.stringify({ sourceName }) }),
}
