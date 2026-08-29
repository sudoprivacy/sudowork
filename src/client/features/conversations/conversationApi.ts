import type { ConversationContextDto, ConversationListItem } from '@shared/contracts/conversations'
import { ApiError } from '@client/features/auth/authApi'

export interface ConversationOptions {
  models: { id: string; name: string }[]
  agents: { name: string }[]
  skills: { name: string }[]
}

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

export function listConversations(): Promise<{ conversations: ConversationListItem[] }> {
  return api('/api/conversations')
}

export function createConversation(input: {
  assistantName: string
  enabledSkills: string[]
}): Promise<{ id: string }> {
  return api('/api/conversations', { method: 'POST', body: JSON.stringify(input) })
}

export function getConversationContext(id: string): Promise<ConversationContextDto> {
  return api(`/api/conversations/${encodeURIComponent(id)}/context`)
}

export function terminateConversation(id: string): Promise<{ ok: true }> {
  return api(`/api/conversations/${encodeURIComponent(id)}/terminate`, { method: 'POST' })
}

export function getConversationOptions(): Promise<ConversationOptions> {
  return api('/api/conversations/options')
}
