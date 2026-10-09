import {
  MossMeSchema,
  MossTokenSetSchema,
  type MossMe,
  type MossTokenSet,
} from '@sudowork/contracts/auth'
import { MossHttpError, type MossFetch } from './MossHttpClient.js'

/**
 * Moss 认证端口（计划 3.1/3.7）：
 * - POST /api/v1/auth/login（grant_type=password / api_key）
 * - POST /api/v1/auth/token（grant_type=refresh_token）
 * - GET  /api/v1/auth/me
 * 端口接口化，便于契约测试与集成测试注入桩实现。
 * 每个方法尾部传入 baseUrl（登录期无 session，地址由 resolveLoginMoss 决定；登录后取 session 地址）。
 */

/** Result of phone login. Registration uses its own endpoint. */
export type MossPhoneLoginResult = { kind: 'tokens'; tokens: MossTokenSet }

export interface MossAuthPort {
  loginWithPassword(input: { username: string; password: string }, baseUrl: string): Promise<MossTokenSet>
  loginWithApiKey(apiKey: string, baseUrl: string): Promise<MossTokenSet>
  /** Ask moss to mint and deliver a code. Returns the resend cooldown. */
  sendPhoneCode(phone: string, baseUrl: string): Promise<{ nextSendIn: number }>
  loginWithPhone(input: { phone: string; code: string }, baseUrl: string): Promise<MossPhoneLoginResult>
  registerWithPhone(
    input: { phone: string; code: string; nickname: string; invitationCode: string },
    baseUrl: string,
  ): Promise<MossTokenSet>
  refresh(refreshToken: string, baseUrl: string): Promise<MossTokenSet>
  me(accessToken: string, baseUrl: string): Promise<MossMe>
}


/** Raised when the control plane refuses a send until the cooldown elapses. */
export class SmsRateLimitedError extends Error {
  constructor(readonly retryAfterSec: number, message?: string) {
    super(message || 'Please wait before requesting another code')
    this.name = 'SmsRateLimitedError'
  }
}

function rateLimitBody(err: unknown): { msg?: string; next_send_in?: number } | null {
  if (!(err instanceof MossHttpError) || err.status !== 429) return null
  try {
    return JSON.parse(err.bodyText) as { msg?: string; next_send_in?: number }
  } catch {
    return {}
  }
}

function rateLimitRetryAfter(err: unknown): number | null {
  const body = rateLimitBody(err)
  if (!body) return null
  return typeof body.next_send_in === 'number' ? body.next_send_in : 60
}

function rateLimitMessage(err: unknown): string | undefined {
  return rateLimitBody(err)?.msg
}

export function createMossAuthPort(mossFetch: MossFetch): MossAuthPort {
  return {
    async loginWithPassword(input, baseUrl) {
      const json = await mossFetch(baseUrl, {
        method: 'POST',
        path: '/api/v1/auth/login',
        body: { grant_type: 'password', username: input.username, password: input.password },
      })
      return MossTokenSetSchema.parse(json)
    },
    async loginWithApiKey(apiKey, baseUrl) {
      const json = await mossFetch(baseUrl, {
        method: 'POST',
        path: '/api/v1/auth/login',
        body: { grant_type: 'api_key', api_key: apiKey },
      })
      return MossTokenSetSchema.parse(json)
    },
    async sendPhoneCode(phone, baseUrl) {
      let json: { success?: boolean; next_send_in?: number; msg?: string }
      try {
        json = (await mossFetch(baseUrl, {
          method: 'POST',
          path: '/api/v1/auth/send-code',
          body: { phone },
        })) as { success?: boolean; next_send_in?: number; msg?: string }
      } catch (err) {
        // A rate-limited send is a 429 carrying how long to wait. Letting it
        // surface as a generic transport failure would show the person an error
        // where the UI could show a countdown.
        const retryAfter = rateLimitRetryAfter(err)
        if (retryAfter !== null) throw new SmsRateLimitedError(retryAfter, rateLimitMessage(err))
        throw err
      }
      if (!json?.success) throw new Error(json?.msg || 'Failed to send verification code')
      return { nextSendIn: typeof json.next_send_in === 'number' ? json.next_send_in : 60 }
    },
    async loginWithPhone(input, baseUrl) {
      // Phone login wraps its token payload in `data`; registration is a
      // separate endpoint and an unknown phone is an HTTP error.
      const json = (await mossFetch(baseUrl, {
        method: 'POST',
        path: '/api/v1/auth/login',
        body: { phone: input.phone, code: input.code },
      })) as {
        success?: boolean
        data?: unknown
        msg?: string
      }
      if (!json?.success || !json.data) throw new Error(json?.msg || 'Phone login failed')
      return { kind: 'tokens', tokens: MossTokenSetSchema.parse(json.data) }
    },
    async registerWithPhone(input, baseUrl) {
      const json = (await mossFetch(baseUrl, {
        method: 'POST',
        path: '/api/v1/auth/register',
        body: {
          phone: input.phone,
          code: input.code,
          nickname: input.nickname,
          invitation_code: input.invitationCode,
        },
      })) as { success?: boolean; data?: unknown; msg?: string }
      if (!json?.success || !json.data) throw new Error(json?.msg || 'Registration failed')
      return MossTokenSetSchema.parse(json.data)
    },
    async refresh(refreshToken, baseUrl) {
      const json = await mossFetch(baseUrl, {
        method: 'POST',
        path: '/api/v1/auth/token',
        body: { grant_type: 'refresh_token', refresh_token: refreshToken },
      })
      return MossTokenSetSchema.parse(json)
    },
    async me(accessToken, baseUrl) {
      const json = await mossFetch(baseUrl, {
        method: 'GET',
        path: '/api/v1/auth/me',
        accessToken,
      })
      return MossMeSchema.parse(json)
    },
  }
}
