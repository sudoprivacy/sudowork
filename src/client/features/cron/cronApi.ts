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

export interface CronSchedule {
  kind: 'at' | 'every' | 'cron'
  value: string
  tz?: string
  description?: string
}

export interface CronJob {
  id: string
  name: string
  enabled: boolean
  schedule: CronSchedule
  payloadMessage?: string
  conversationMode: 'new' | 'reuse'
  boundSessionId?: string | null
  assistantId?: string | null
  assistantName?: string | null
  nextRunAt?: number | null
  lastRunAt?: number | null
  lastStatus?: string | null
  [key: string]: unknown
}

export const cronApi = {
  list: (): Promise<{ jobs: CronJob[]; canCreate: boolean }> => api('/api/cron'),
  get: (id: string): Promise<CronJob> => api(`/api/cron/${encodeURIComponent(id)}`),
  create: (body: Record<string, unknown>) =>
    api<CronJob>('/api/cron', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Record<string, unknown>) =>
    api<CronJob>(`/api/cron/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  remove: (id: string) => api(`/api/cron/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  trigger: (id: string) =>
    api(`/api/cron/${encodeURIComponent(id)}/trigger`, { method: 'POST' }),
  runs: (id: string, limit = 20): Promise<unknown> =>
    api(`/api/cron/${encodeURIComponent(id)}/runs?limit=${limit}`),
}
