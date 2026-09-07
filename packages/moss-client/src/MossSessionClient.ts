import { z } from 'zod'
import {
  MossContextResponseSchema,
  MossCreateSessionResponseSchema,
  MossResumeResponseSchema,
  MossSessionListResponseSchema,
  MossSessionSummarySchema,
  MossWorkspaceNodeSchema,
  type MossSessionSummary,
} from '@sudowork/contracts/conversations'
import { type MossCallContext, type MossFetch } from './MossHttpClient.js'

/**
 * Moss Session REST 端口（计划 Task 5）：
 * list/create/get/context/resume/terminate + workspace tree/file。
 * 不实现 PATCH/DELETE（基线不存在，计划 1.3）。
 * 每次调用传入 MossCallContext（access token + 会话生效的 moss 地址），支持登录页自定义地址。
 */

export interface MossSessionPort {
  list(ctx: MossCallContext): Promise<MossSessionSummary[]>
  get(ctx: MossCallContext, sessionId: string): Promise<MossSessionSummary | null>
  create(
    ctx: MossCallContext,
    input: { assistantName: string; enabledSkills: string[] },
  ): Promise<{ sessionId: string; wsUrl: string }>
  /** 用户级模型偏好（Moss 无会话级模型接口，PUT /api/v1/users/me/model）；建会话前设置使新会话采用该模型 */
  setUserModel(ctx: MossCallContext, modelId: string): Promise<void>
  /** 用户级模型偏好读取（GET /api/v1/users/me/model）；未设偏好时 null。上游无该端点等错误由调用方 catch */
  getUserModel(ctx: MossCallContext): Promise<string | null>
  context(ctx: MossCallContext, sessionId: string): Promise<unknown>
  resume(ctx: MossCallContext, sessionId: string): Promise<{ session: MossSessionSummary; wsUrl: string }>
  terminate(ctx: MossCallContext, sessionId: string): Promise<void>
  workspaceTree(ctx: MossCallContext, sessionId: string, path: string, search?: string): Promise<unknown>
  workspaceFileGet(ctx: MossCallContext, sessionId: string, path: string): Promise<unknown>
  workspaceFilePost(ctx: MossCallContext, sessionId: string, path: string, contentBase64: string): Promise<unknown>
  /** 会话级可用技能（部署版实测 GET /api/v1/sessions/:id/skills/available 200） */
  sessionSkillsAvailable(ctx: MossCallContext, sessionId: string): Promise<unknown>
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value)
}

function safeParse<T extends z.ZodTypeAny>(schema: T, json: unknown): z.infer<T> | null {
  const parsed = schema.safeParse(json)
  return parsed.success ? parsed.data : null
}

export function createMossSessionPort(mossFetch: MossFetch): MossSessionPort {
  return {
    async list(ctx) {
      const json = await mossFetch(ctx.baseUrl, { method: 'GET', path: '/api/v1/sessions', accessToken: ctx.accessToken })
      const parsed = MossSessionListResponseSchema.parse(json)
      return parsed.sessions
    },

    async get(ctx, sessionId) {
      const json = await mossFetch(ctx.baseUrl, {
        method: 'GET',
        path: `/api/v1/sessions/${encodeSegment(sessionId)}`,
        accessToken: ctx.accessToken,
      })
      // 上游单会话响应为 { session: <summary>, ... } 包装
      const wrapped = safeParse(z.object({ session: MossSessionSummarySchema }), json)
      return wrapped?.session ?? null
    },

    async create(ctx, input) {
      const json = await mossFetch(ctx.baseUrl, {
        method: 'POST',
        path: '/api/v1/sessions',
        accessToken: ctx.accessToken,
        body: {
          assistant_name: input.assistantName,
          enabled_skills: input.enabledSkills,
          // 对齐桌面端 MossWsConnection 默认（false）：工具执行走 control_request 审批，
          // 而非跳过权限。moss 服务端缺省值不可考，显式传递以确定行为。
          dangerously_skip_permissions: false,
        },
      })
      const parsed = MossCreateSessionResponseSchema.parse(json)
      return { sessionId: parsed.session_id, wsUrl: parsed.ws_url }
    },

    async setUserModel(ctx, modelId) {
      // body 键名与桌面端 MossSessionApi.setUserModelPreference 一致（camelCase modelId）
      await mossFetch(ctx.baseUrl, {
        method: 'PUT',
        path: '/api/v1/users/me/model',
        accessToken: ctx.accessToken,
        body: { modelId },
      })
    },

    async getUserModel(ctx) {
      const json = await mossFetch(ctx.baseUrl, {
        method: 'GET',
        path: '/api/v1/users/me/model',
        accessToken: ctx.accessToken,
      })
      // 上游响应形状未在仓库内可考（camelCase 与 snake_case 兼容读取），未设偏好返回 null
      const parsed = safeParse(z.object({ modelId: z.string().nullable().optional(), model_id: z.string().nullable().optional() }).passthrough(), json)
      return parsed?.modelId ?? parsed?.model_id ?? null
    },

    async context(ctx, sessionId) {
      const json = await mossFetch(ctx.baseUrl, {
        method: 'GET',
        path: `/api/v1/sessions/${encodeSegment(sessionId)}/context`,
        accessToken: ctx.accessToken,
      })
      return MossContextResponseSchema.parse(json)
    },

    async resume(ctx, sessionId) {
      const json = await mossFetch(ctx.baseUrl, {
        method: 'POST',
        path: `/api/v1/sessions/${encodeSegment(sessionId)}/resume`,
        accessToken: ctx.accessToken,
      })
      const parsed = MossResumeResponseSchema.parse(json)
      return { session: parsed.session, wsUrl: parsed.ws_url }
    },

    async terminate(ctx, sessionId) {
      await mossFetch(ctx.baseUrl, {
        method: 'POST',
        path: `/api/v1/sessions/${encodeSegment(sessionId)}/terminate`,
        accessToken: ctx.accessToken,
      })
    },

    async workspaceTree(ctx, sessionId, path, search = '') {
      const searchParams: Record<string, string> = {}
      if (path) searchParams.path = path
      if (search) searchParams.search = search
      const json = await mossFetch(ctx.baseUrl, {
        method: 'GET',
        path: `/api/v1/sessions/${encodeSegment(sessionId)}/workspace/tree`,
        accessToken: ctx.accessToken,
        searchParams,
      })
      const treeSchema = z.object({ root: MossWorkspaceNodeSchema })
      return safeParse(treeSchema, json)?.root ?? null
    },

    async workspaceFileGet(ctx, sessionId, path) {
      return mossFetch(ctx.baseUrl, {
        method: 'GET',
        path: `/api/v1/sessions/${encodeSegment(sessionId)}/workspace/file`,
        accessToken: ctx.accessToken,
        searchParams: { path },
      })
    },

    async workspaceFilePost(ctx, sessionId, path, contentBase64) {
      return mossFetch(ctx.baseUrl, {
        method: 'POST',
        path: `/api/v1/sessions/${encodeSegment(sessionId)}/workspace/file`,
        accessToken: ctx.accessToken,
        body: { path, content_base64: contentBase64 },
      })
    },

    async sessionSkillsAvailable(ctx, sessionId) {
      return mossFetch(ctx.baseUrl, {
        method: 'GET',
        path: `/api/v1/sessions/${encodeSegment(sessionId)}/skills/available`,
        accessToken: ctx.accessToken,
      })
    },
  }
}
