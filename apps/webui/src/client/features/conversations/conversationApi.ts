import type { ConversationContextDto, ConversationListItem } from '@sudowork/contracts/conversations'
import { ApiError } from '@client/features/auth/authApi'

export interface ConversationOptions {
  models: { id: string; name: string }[]
  agents: {
    name: string
    displayName: string
    emoji: string
    description: string
    avatar: string
    defaultInitPrompt: string
    promptsI18n: { 'zh-CN': string[] }
  }[]
  skills: { name: string; displayName: string; description: string; icon: string; emoji: string }[]
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

export function updateConversationMeta(
  id: string,
  update: { title?: string; pinned?: boolean },
): Promise<{ ok: true }> {
  return api(`/api/conversations/${encodeURIComponent(id)}/meta`, {
    method: 'PATCH',
    body: JSON.stringify(update),
  })
}

export function reorderPinnedConversations(orderedIds: string[]): Promise<{ ok: true }> {
  return api('/api/conversations/meta/reorder', { method: 'POST', body: JSON.stringify({ orderedIds }) })
}

/** 删除会话（本地 meta + Moss terminate，对齐 Sudowork 删除语义） */
export function deleteConversation(id: string): Promise<{ ok: true }> {
  return api(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function createConversation(input: {
  assistantName: string
  enabledSkills: string[]
  modelId?: string
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

export interface WorkspaceNode {
  name: string
  relativePath: string
  isFile: boolean
  isDir: boolean
  size?: number
  mtime?: number
  children?: WorkspaceNode[]
}

/**
 * 工作区文件树（服务端返回裸根节点——MossSessionClient 已在上游解包 `{root}`；
 * `path` 用于目录懒加载、`search` 用于服务端搜索，moss 两者均支持）。
 */
export function getWorkspaceTree(
  id: string,
  path = '',
  search = '',
): Promise<WorkspaceNode | null> {
  const params: string[] = []
  if (path) params.push(`path=${encodeURIComponent(path)}`)
  if (search) params.push(`search=${encodeURIComponent(search)}`)
  const q = params.length > 0 ? `?${params.join('&')}` : ''
  return api(`/api/conversations/${encodeURIComponent(id)}/workspace/tree${q}`)
}

export function getWorkspaceFile(
  id: string,
  path: string,
): Promise<{ name: string; relativePath: string; mime: string; content: string; size: number }> {
  return api(`/api/conversations/${encodeURIComponent(id)}/workspace/file?path=${encodeURIComponent(path)}`)
}

/** 上传文件到会话工作区（base64）；超限由服务端返回 413 FILE_TOO_LARGE。 */
export function uploadWorkspaceFile(id: string, path: string, file: File): Promise<unknown> {
  return file.arrayBuffer().then((buf) => {
    let binary = ''
    const bytes = new Uint8Array(buf)
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return api(`/api/conversations/${encodeURIComponent(id)}/workspace/file`, {
      method: 'POST',
      body: JSON.stringify({ path, contentBase64: btoa(binary) }),
    })
  })
}

export interface SessionSkill {
  name: string
  displayName: string
  description: string
  icon: string
  /** 会话技能快照：icon 为图标名时图片走 iconUrl（moss 由 icon 是否为 URL 派生） */
  iconUrl: string
  emoji: string | null
  color: string
}

export function getSessionSkills(id: string): Promise<{ skills: SessionSkill[] }> {
  return api(`/api/conversations/${encodeURIComponent(id)}/skills/available`)
}

export interface DeliverableItem {
  name: string
  relativePath: string
  kind: 'create' | 'edit'
  ext: string
  size: number | null
  mime: string | null
  createdAt: string
}

export function getDeliverables(id: string): Promise<{ items: DeliverableItem[] }> {
  return api(`/api/conversations/${encodeURIComponent(id)}/deliverables`)
}
