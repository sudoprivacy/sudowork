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
import { type MossFetch } from './MossHttpClient.js'

/**
 * Moss Session REST 端口（计划 Task 5）：
 * list/create/get/context/resume/terminate + workspace tree/file。
 * 不实现 PATCH/DELETE（基线不存在，计划 1.3）。
 */

export interface MossSessionPort {
  /** 计划 3.2：每次请求由调用方传入该 Web Session 自己的 access token。 */
  list(accessToken: string): Promise<MossSessionSummary[]>
  get(accessToken: string, sessionId: string): Promise<MossSessionSummary | null>
  create(
    accessToken: string,
    input: { assistantName: string; enabledSkills: string[] },
  ): Promise<{ sessionId: string; wsUrl: string }>
  context(accessToken: string, sessionId: string): Promise<unknown>
  resume(accessToken: string, sessionId: string): Promise<{ session: MossSessionSummary; wsUrl: string }>
  terminate(accessToken: string, sessionId: string): Promise<void>
  workspaceTree(accessToken: string, sessionId: string, path: string, search?: string): Promise<unknown>
  workspaceFileGet(accessToken: string, sessionId: string, path: string): Promise<unknown>
  workspaceFilePost(accessToken: string, sessionId: string, path: string, contentBase64: string): Promise<unknown>
  /** 会话级可用技能（部署版实测 GET /api/v1/sessions/:id/skills/available 200） */
  sessionSkillsAvailable(accessToken: string, sessionId: string): Promise<unknown>
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value)
}

function safeParse<T extends z.ZodTypeAny>(schema: T, json: unknown): z.infer<T> | null {
  const parsed = schema.safeParse(json)
  return parsed.success ? parsed.data : null
}

export function createMossSessionPort(mossFetch: MossFetch, baseUrl: string): MossSessionPort {
  return {
    async list(accessToken) {
      const json = await mossFetch(baseUrl, { method: 'GET', path: '/api/v1/sessions', accessToken })
      const parsed = MossSessionListResponseSchema.parse(json)
      return parsed.sessions
    },

    async get(accessToken, sessionId) {
      const json = await mossFetch(baseUrl, {
        method: 'GET',
        path: `/api/v1/sessions/${encodeSegment(sessionId)}`,
        accessToken,
      })
      // 上游单会话响应为 { session: <summary>, ... } 包装
      const wrapped = safeParse(z.object({ session: MossSessionSummarySchema }), json)
      return wrapped?.session ?? null
    },

    async create(accessToken, input) {
      const json = await mossFetch(baseUrl, {
        method: 'POST',
        path: '/api/v1/sessions',
        accessToken,
        body: {
          assistant_name: input.assistantName,
          enabled_skills: input.enabledSkills,
        },
      })
      const parsed = MossCreateSessionResponseSchema.parse(json)
      return { sessionId: parsed.session_id, wsUrl: parsed.ws_url }
    },

    async context(accessToken, sessionId) {
      const json = await mossFetch(baseUrl, {
        method: 'GET',
        path: `/api/v1/sessions/${encodeSegment(sessionId)}/context`,
        accessToken,
      })
      return MossContextResponseSchema.parse(json)
    },

    async resume(accessToken, sessionId) {
      const json = await mossFetch(baseUrl, {
        method: 'POST',
        path: `/api/v1/sessions/${encodeSegment(sessionId)}/resume`,
        accessToken,
      })
      const parsed = MossResumeResponseSchema.parse(json)
      return { session: parsed.session, wsUrl: parsed.ws_url }
    },

    async terminate(accessToken, sessionId) {
      await mossFetch(baseUrl, {
        method: 'POST',
        path: `/api/v1/sessions/${encodeSegment(sessionId)}/terminate`,
        accessToken,
      })
    },

    async workspaceTree(accessToken, sessionId, path, search = '') {
      const searchParams: Record<string, string> = {}
      if (path) searchParams.path = path
      if (search) searchParams.search = search
      const json = await mossFetch(baseUrl, {
        method: 'GET',
        path: `/api/v1/sessions/${encodeSegment(sessionId)}/workspace/tree`,
        accessToken,
        searchParams,
      })
      const treeSchema = z.object({ root: MossWorkspaceNodeSchema })
      return safeParse(treeSchema, json)?.root ?? null
    },

    async workspaceFileGet(accessToken, sessionId, path) {
      return mossFetch(baseUrl, {
        method: 'GET',
        path: `/api/v1/sessions/${encodeSegment(sessionId)}/workspace/file`,
        accessToken,
        searchParams: { path },
      })
    },

    async workspaceFilePost(accessToken, sessionId, path, contentBase64) {
      return mossFetch(baseUrl, {
        method: 'POST',
        path: `/api/v1/sessions/${encodeSegment(sessionId)}/workspace/file`,
        accessToken,
        body: { path, content_base64: contentBase64 },
      })
    },

    async sessionSkillsAvailable(accessToken, sessionId) {
      return mossFetch(baseUrl, {
        method: 'GET',
        path: `/api/v1/sessions/${encodeSegment(sessionId)}/skills/available`,
        accessToken,
      })
    },
  }
}
