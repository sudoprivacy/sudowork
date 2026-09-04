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
 */

export interface MossAuthPort {
  loginWithPassword(input: { username: string; password: string }): Promise<MossTokenSet>
  loginWithApiKey(apiKey: string): Promise<MossTokenSet>
  refresh(refreshToken: string): Promise<MossTokenSet>
  me(accessToken: string): Promise<MossMe>
}

export function createMossAuthPort(mossFetch: MossFetch, baseUrl: string): MossAuthPort {
  return {
    async loginWithPassword(input) {
      const json = await mossFetch(baseUrl, {
        method: 'POST',
        path: '/api/v1/auth/login',
        body: { grant_type: 'password', username: input.username, password: input.password },
      })
      return MossTokenSetSchema.parse(json)
    },
    async loginWithApiKey(apiKey) {
      const json = await mossFetch(baseUrl, {
        method: 'POST',
        path: '/api/v1/auth/login',
        body: { grant_type: 'api_key', api_key: apiKey },
      })
      return MossTokenSetSchema.parse(json)
    },
    async refresh(refreshToken) {
      const json = await mossFetch(baseUrl, {
        method: 'POST',
        path: '/api/v1/auth/token',
        body: { grant_type: 'refresh_token', refresh_token: refreshToken },
      })
      return MossTokenSetSchema.parse(json)
    },
    async me(accessToken) {
      const json = await mossFetch(baseUrl, {
        method: 'GET',
        path: '/api/v1/auth/me',
        accessToken,
      })
      return MossMeSchema.parse(json)
    },
  }
}
