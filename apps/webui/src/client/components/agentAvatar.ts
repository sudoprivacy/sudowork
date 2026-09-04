/**
 * 智能体头像解析（agents 与 conversations 两个 feature 共用的单一入口）。
 * moss 返回的 avatar 可能是：绝对 URL（hub=COS 图床）、emoji 字符、data: URI、
 * moss 相对路径（tenant=/uploads/tenant-assistant-avatars/<file>）。
 * 相对路径浏览器不可直达 moss（容器网络地址），须经 webui 同源代理转发。
 */

/** tenant 相对路径头像的 webui 同源代理端点，须与后端 conversationRoutes 的 zod 白名单同口径 */
export const AGENT_AVATAR_PROXY_PATH = '/api/conversations/agent-avatar'

/** moss 相对路径头像的唯一生成形态（moss saveTenantAssistantAvatar） */
const MOSS_TENANT_AVATAR_PREFIX = '/uploads/tenant-assistant-avatars/'

export type ResolvedAgentAvatar = { kind: 'emoji' | 'image'; value: string } | null

// 单个 emoji（含 ZWJ 序列，如 👨‍💻）；与 AgentsPage 原本地实现同口径，收敛到此处统一使用
const EMOJI_AVATAR_REGEX = /^(?:\p{Emoji_Presentation}|\p{Emoji}️)(?:‍(?:\p{Emoji_Presentation}|\p{Emoji}️))*$/u

export function resolveAgentAvatar(avatar: string | null | undefined): ResolvedAgentAvatar {
  const value = (avatar ?? '').trim()
  if (!value) return null
  if (/^(?:https?:|data:)/i.test(value)) return { kind: 'image', value }
  if (EMOJI_AVATAR_REGEX.test(value)) return { kind: 'emoji', value }
  if (value.startsWith(MOSS_TENANT_AVATAR_PREFIX)) {
    return { kind: 'image', value: `${AGENT_AVATAR_PROXY_PATH}?path=${encodeURIComponent(value)}` }
  }
  // 其余形态（其他相对路径、blob: 等）不生成必然 400 的代理 URL，交各处兜底图标
  return null
}
