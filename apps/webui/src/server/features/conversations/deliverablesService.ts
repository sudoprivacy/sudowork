/**
 * 交付物提取（从 Moss context 的 tool_use 重建——Moss 无 Sudowork 本地 marker，此为唯一持久数据源）。
 * 数据路径（部署版实测确证）：context.messages 中 type==='tool_use' 且 name 属于文件写入类工具
 * （实测集合：write_file；实施按 getConversationContext 实际取值维护）→ JSON.parse(input)
 * （input 是 JSON 字符串，兼容对象形态）取 .path → kind 映射（写入→create / 编辑→edit）
 * → timestamp 作 createdAt → size/mime 从 workspace tree 匹配补齐。
 */
import type { ConversationDeps } from './conversationService.js'
import { requireOwnSession } from './conversationService.js'

/** 文件写入类工具名 → kind（部署版实测 write_file；新增工具按实测补充） */
const WRITE_TOOLS = new Map<string, 'create' | 'edit'>([
  ['write_file', 'create'],
  ['edit_file', 'edit'],
])

export interface DeliverableItem {
  name: string
  relativePath: string
  kind: 'create' | 'edit'
  ext: string
  size: number | null
  mime: string | null
  createdAt: string
}

function parseToolInput(input: unknown): Record<string, unknown> | null {
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input) as unknown
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  if (input && typeof input === 'object') return input as Record<string, unknown>
  return null
}

/** 展平 workspace tree，收集文件 node（用于补齐 size/mime） */
function flattenFiles(node: unknown, out: { relativePath: string; size?: number }[]): void {
  if (!node || typeof node !== 'object') return
  const n = node as { isFile?: boolean; isDir?: boolean; relativePath?: string; size?: number; children?: unknown[] }
  if (n.isFile && typeof n.relativePath === 'string') {
    out.push({ relativePath: n.relativePath, size: typeof n.size === 'number' ? n.size : undefined })
  }
  if (Array.isArray(n.children)) {
    for (const child of n.children) flattenFiles(child, out)
  }
}

function mimeOf(ext: string): string {
  const map: Record<string, string> = {
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    ts: 'text/typescript',
    json: 'application/json',
    md: 'text/markdown',
    txt: 'text/plain',
    csv: 'text/csv',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    pdf: 'application/pdf',
  }
  return map[ext] ?? 'application/octet-stream'
}

export async function getDeliverables(
  deps: ConversationDeps,
  principal: Parameters<typeof requireOwnSession>[1],
  sessionId: string,
  accessToken: string,
): Promise<{ items: DeliverableItem[] }> {
  await requireOwnSession(deps, principal, sessionId, accessToken)

  const [contextJson, treeJson] = await Promise.all([
    deps.moss.context(accessToken, sessionId),
    deps.moss.workspaceTree(accessToken, sessionId, '').catch(() => null),
  ])

  const files: { relativePath: string; size?: number }[] = []
  const treeRoot = (treeJson as { root?: unknown } | null)?.root
  if (treeRoot) flattenFiles(treeRoot, files)
  const fileByPath = new Map(files.map((f) => [f.relativePath, f]))

  const messages = ((contextJson as { context?: { messages?: unknown[] } } | null)?.context?.messages ?? []) as Record<string, unknown>[]
  const items = new Map<string, DeliverableItem>()
  for (const msg of messages) {
    if (msg.type !== 'tool_use') continue
    const kind = WRITE_TOOLS.get(String(msg.name ?? ''))
    if (!kind) continue
    const input = parseToolInput(msg.input)
    const rawPath = input?.path
    if (typeof rawPath !== 'string' || rawPath === '') continue
    // 路径归一：Moss 侧为容器内绝对路径，取 workspace 相对段
    const relativePath = rawPath.replace(/^\/+/, '').replace(/^workspace\//, '')
    const name = relativePath.split('/').pop() ?? relativePath
    const ext = (name.split('.').pop() ?? '').toLowerCase()
    const stat = fileByPath.get(relativePath)
    const createdAt = typeof msg.timestamp === 'string' ? msg.timestamp : ''
    const existing = items.get(relativePath)
    // 同路径按时间最新胜出（对齐 Sudowork DeliverablesService 的 last-write-wins）
    if (existing && existing.createdAt >= createdAt) continue
    items.set(relativePath, {
      name,
      relativePath,
      kind,
      ext,
      size: typeof stat?.size === 'number' ? stat.size : null,
      mime: stat ? mimeOf(ext) : null,
      createdAt,
    })
  }

  return { items: [...items.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
}
