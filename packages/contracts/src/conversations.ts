import { z } from 'zod'

/**
 * 会话契约（计划 3.10 / Task 5）。
 * 浏览器 DTO 严格白名单：不返回 ws_url、work_dir/cwd/fullPath、Moss origin、原始错误 body。
 * 上游协议事实（2026-08 基线 acpBridge）：assistant 为增量(delta:true)；result 是 turn
 * 结束唯一权威信号；AskUserQuestion 以 tool_use(name='AskUserQuestion') 到达，回答用
 * parent_tool_use_id 指向该 tool_use 的 uuid；当前上游不发射 thinking/turn 级 interrupt。
 */

// ---------- Moss 上游类型（服务端内部，宽松白名单） ----------

export const MossSessionSummarySchema = z
  .object({
    sessionId: z.string(),
    userId: z.string(),
    orgId: z.string(),
    status: z.string(),
    assistantName: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
  })
  .passthrough()
export type MossSessionSummary = z.infer<typeof MossSessionSummarySchema>

export const MossSessionListResponseSchema = z.object({
  sessions: z.array(MossSessionSummarySchema),
})

export const MossCreateSessionResponseSchema = z
  .object({
    session_id: z.string(),
    ws_url: z.string(),
    work_dir: z.string().optional(),
  })
  .passthrough()

export const MossResumeResponseSchema = z
  .object({
    session: MossSessionSummarySchema,
    ws_url: z.string(),
  })
  .passthrough()

export const MossContextResponseSchema = z.object({
  session: MossSessionSummarySchema.optional(),
  context: z
    .object({
      customTitle: z.string().optional(),
      messages: z
        .array(
          z
            .object({
              type: z.enum(['user', 'assistant', 'tool_use', 'tool_result']),
              uuid: z.string().optional(),
            })
            .passthrough(),
        )
        .default([]),
    })
    .passthrough()
    .optional(),
})

export interface MossWorkspaceNode {
  name: string
  relativePath: string
  isFile: boolean
  isDir: boolean
  size?: number
  mtime?: number
  children?: MossWorkspaceNode[]
}

export const MossWorkspaceNodeSchema: z.ZodType<MossWorkspaceNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    relativePath: z.string(),
    isFile: z.boolean(),
    isDir: z.boolean(),
    size: z.number().optional(),
    mtime: z.number().optional(),
    children: z.array(MossWorkspaceNodeSchema).optional(),
  }),
)

// ---------- 浏览器请求/响应 DTO（白名单） ----------

export const CreateConversationRequestSchema = z.object({
  /** 空串 = 不指定智能体，由 Moss 走默认（部署版实测空 assistant_name 创建 200） */
  assistantName: z.string().trim().max(255),
  enabledSkills: z.array(z.string().min(1).max(255)).max(50).default([]),
})
export type CreateConversationRequest = z.infer<typeof CreateConversationRequestSchema>

export const ConversationListItemSchema = z.object({
  id: z.string(),
  status: z.string(),
  assistantName: z.string().nullable(),
  source: z.string().nullable(),
  /** 上游 epoch 毫秒时间戳；未知时为 null */
  lastActiveAt: z.number().nullable(),
  /** webui 本地元数据（Moss 无标题/置顶字段；无记录时 title=null / pinned=false） */
  title: z.string().nullable(),
  pinned: z.boolean(),
  /** 置顶排序键（pinned_at，epoch 毫秒）；未置顶为 null */
  pinnedAt: z.number().nullable(),
})
export type ConversationListItem = z.infer<typeof ConversationListItemSchema>

export const UpdateConversationMetaRequestSchema = z.object({
  /** 重命名（1-100 字符） */
  title: z.string().trim().min(1).max(100).optional(),
  /** 置顶/取消置顶 */
  pinned: z.boolean().optional(),
})
export type UpdateConversationMetaRequest = z.infer<typeof UpdateConversationMetaRequestSchema>

export const ReorderPinnedRequestSchema = z.object({
  /** 置顶区拖拽后的顺序（moss session id 列表） */
  orderedIds: z.array(z.string().min(1)).min(1).max(100),
})
export type ReorderPinnedRequest = z.infer<typeof ReorderPinnedRequestSchema>

export const ConversationContextDtoSchema = z.object({
  customTitle: z.string().nullable(),
  /** webui 本地标题（conversation_meta.title，与列表接口同源；Moss 上游无标题概念） */
  title: z.string().nullable(),
  messages: z.array(z.record(z.string(), z.unknown())),
})
export type ConversationContextDto = z.infer<typeof ConversationContextDtoSchema>

// ---------- 浏览器 ⇄ WebUI WS 协议 ----------

/** 浏览器 → WebUI（服务端 Zod 严校验后再转 Moss 协议） */
export const ClientOutboundMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('send'),
    text: z.string().min(1).max(32_768),
    images: z
      .array(
        z.object({
          mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
          /** base64（不含 data: 前缀），解码后单张 ≤ 配置限制 */
          data: z.string().min(1).max(15_000_000),
        }),
      )
      .max(4)
      .default([]),
  }),
  z.object({
    kind: z.literal('answer_question'),
    parentToolUseId: z.string().min(1),
    text: z.string().min(1).max(32_768),
  }),
  z.object({
    kind: z.literal('set_model'),
    modelId: z.string().min(1).max(255),
  }),
  z.object({
    /** 停止当前回复（转发上游 control_request interrupt） */
    kind: z.literal('stop'),
  }),
])
export type ClientOutboundMessage = z.infer<typeof ClientOutboundMessageSchema>

/** WebUI → 浏览器：上游事件白名单转发 + WebUI 控制事件 */
export const ServerInboundEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('upstream'), event: z.unknown() }),
  z.object({ kind: z.literal('writer'), isWriter: z.boolean() }),
  z.object({ kind: z.literal('lock'), state: z.enum(['idle', 'running', 'uncertain']) }),
  z.object({ kind: z.literal('error'), code: z.string(), message: z.string().optional() }),
])
export type ServerInboundEvent = z.infer<typeof ServerInboundEventSchema>

/** 上游事件转发白名单（其余类型一律丢弃，不透传给浏览器） */
export const UPSTREAM_EVENT_TYPES = new Set([
  'hello',
  'assistant',
  'tool_use',
  'result',
  'system',
  'thinking', // 当前上游不发射；保留兼容位，未来上游支持即生效
])
