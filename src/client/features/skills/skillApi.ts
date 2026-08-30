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

export interface SkillItem {
  name: string
  description?: string
  enabled?: boolean
  icon?: string
  emoji?: string
  [key: string]: unknown
}

export const skillApi = {
  listInstalled: (): Promise<SkillItem[]> => api('/api/skills'),
  hubCategories: (): Promise<string[]> => api('/api/skills/hub/categories'),
  hubList: (params: Record<string, string> = {}): Promise<{ items?: SkillItem[] } & Record<string, unknown>> => {
    const qs = new URLSearchParams(params).toString()
    return api(`/api/skills/hub/list${qs ? `?${qs}` : ''}`)
  },
  install: (name: string) =>
    api('/api/skills/install', { method: 'POST', body: JSON.stringify({ name }) }),
  setEnabled: (name: string, enabled: boolean) =>
    api('/api/skills/enabled', { method: 'PATCH', body: JSON.stringify({ name, enabled }) }),
  uninstall: (name: string) =>
    api('/api/skills/uninstall', { method: 'POST', body: JSON.stringify({ name }) }),
  tenantList: (): Promise<Record<string, unknown>[]> => api('/api/skills/tenant'),
}
