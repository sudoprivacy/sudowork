import {
  MossMeSchema,
  MossTokenSetSchema,
  type MossMe,
  type MossTokenSet,
} from '@sudowork/contracts/auth'
import { type MossFetch } from './MossHttpClient.js'

/**
 * Moss 认证端口（计划 3.1/3.7）：
 * - POST /api/v1/auth/login（grant_type=password / api_key）
 * - POST /api/v1/auth/token（grant_type=refresh_token）
 * - GET  /api/v1/auth/me
 * 端口接口化，便于契约测试与集成测试注入桩实现。
 * 每个方法尾部传入 baseUrl（登录期无 session，地址由 resolveLoginMoss 决定；登录后取 session 地址）。
 */

export interface MossAuthPort {
  loginWithPassword(input: { username: string; password: string }, baseUrl: string): Promise<MossTokenSet>
  loginWithApiKey(apiKey: string, baseUrl: string): Promise<MossTokenSet>
  refresh(refreshToken: string, baseUrl: string): Promise<MossTokenSet>
  me(accessToken: string, baseUrl: string): Promise<MossMe>
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
