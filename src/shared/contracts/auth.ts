import { z } from 'zod'

/**
 * 认证契约（计划 3.7）：前后端共用的 Zod schema。
 * 浏览器永远收不到 Moss 原始 token，只收到白名单字段。
 */

/** Moss 登录/刷新响应（基线 auth/service.ts:248-251）。 */
export const MossTokenSetSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive(),
})
export type MossTokenSet = z.infer<typeof MossTokenSetSchema>

/** Moss GET /api/v1/auth/me 响应（必要字段白名单）。 */
export const MossMeSchema = z.object({
  user: z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
    })
    .passthrough(),
  organization: z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
    })
    .nullable(),
  scopes: z.array(z.string()),
  role: z.string(),
})
export type MossMe = z.infer<typeof MossMeSchema>

export const LoginPasswordRequestSchema = z.object({
  username: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(1024),
})
export type LoginPasswordRequest = z.infer<typeof LoginPasswordRequestSchema>

export const LoginApiKeyRequestSchema = z.object({
  apiKey: z.string().trim().min(1).max(512),
})
export type LoginApiKeyRequest = z.infer<typeof LoginApiKeyRequestSchema>

/** GET /api/auth/session 的浏览器响应（白名单 DTO）。 */
export const SessionResponseSchema = z.object({
  user: z.object({ id: z.string(), name: z.string() }),
  organization: z.object({ id: z.string(), name: z.string() }).nullable(),
  role: z.string(),
  scopes: z.array(z.string()),
})
export type SessionResponse = z.infer<typeof SessionResponseSchema>

export const ErrorResponseSchema = z.object({ error: z.string() })
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>
