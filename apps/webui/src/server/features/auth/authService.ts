import type { Pool } from 'pg'
import type { AppConfig } from '../../config.js'
import type { MossAuthPort, MossCallContext } from '@sudowork/moss-client'
import { MossHttpError, MossNetworkError } from '@sudowork/moss-client'
import { digestToken, generateSessionToken } from '../../security/sessionToken.js'
import { decryptToken, encryptToken } from '../../security/tokenCipher.js'
import type { MossMe, MossTokenSet } from '@sudowork/contracts/auth'
import { findPrincipalById, upsertPrincipal, type Principal } from './principalRepository.js'
import {
  createWebSession,
  deleteWebSession,
  findActiveSessionByDigest,
  replaceSessionTokens,
  type WebSessionRow,
} from './sessionRepository.js'

/**
 * 认证编排（计划 3.1/3.7）：
 * - 凭证只用于调用 Moss login；不落库、不写日志
 * - 每个 Web Session 独立保存加密 token；access 即将过期时按 webSessionId single-flight 刷新
 * - 只读 401 刷新后重试一次； Moss 不可达时抛 MossUnavailableError（→503，不用陈旧权限）
 */

export interface AuthDeps {
  pool: Pool
  config: AppConfig
  mossAuth: MossAuthPort
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('invalid credentials')
    this.name = 'InvalidCredentialsError'
  }
}

export class MossUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`moss unavailable: ${(cause as Error)?.message ?? String(cause)}`)
    this.name = 'MossUnavailableError'
  }
}

/** moss 侧判定登录态失效（刷新被 401/403 拒绝）——全局错误中间件映射为 401 引导重新登录。 */
export class MossUnauthorizedError extends Error {
  constructor(cause: unknown) {
    super(`moss unauthorized: ${(cause as Error)?.message ?? String(cause)}`)
    this.name = 'MossUnauthorizedError'
  }
}

export interface LoginResult {
  cookieToken: string
  webSessionId: string
}

interface StoredTokens {
  accessToken: string
  refreshToken: string
  /** access token 实际到期时间（epoch ms） */
  expiresAt: number
}

const refreshInFlight = new Map<string, Promise<StoredTokens>>()

function mapLoginError(err: unknown): Error {
  if (err instanceof MossHttpError && (err.status === 400 || err.status === 401 || err.status === 403)) {
    return new InvalidCredentialsError()
  }
  if (err instanceof MossNetworkError) {
    return new MossUnavailableError(err)
  }
  return err instanceof Error ? err : new Error(String(err))
}

/**
 * 归一化登录期的 moss 地址：
 * - baseUrl：本次登录/该会话所有 moss 调用实际使用的地址（无自定义→配置默认）
 * - identityBaseUrl：落库到 principal/session 的身份地址（与配置同 origin→null，视为未自定义，
 *   避免同一 moss 下身份分裂）；仅真正自定义（异 origin）时非 null
 */
export function resolveLoginMoss(config: AppConfig, mossBaseUrl?: string): { baseUrl: string; identityBaseUrl: string | null } {
  if (!mossBaseUrl) return { baseUrl: config.moss.baseUrl, identityBaseUrl: null }
  const configuredOrigin = new URL(config.moss.baseUrl).origin
  const origin = new URL(mossBaseUrl).origin
  if (origin === configuredOrigin) return { baseUrl: config.moss.baseUrl, identityBaseUrl: null }
  return { baseUrl: origin, identityBaseUrl: origin }
}

function serializeTokens(tokens: MossTokenSet): StoredTokens {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  }
}

function decryptStored(deps: AuthDeps, session: WebSessionRow): Promise<StoredTokens> {
  return Promise.resolve(
    JSON.parse(
      decryptToken(
        {
          ciphertext: session.encryptedMossTokens,
          iv: session.tokenIv,
          authTag: session.tokenAuthTag,
        },
        deps.config.tokenAesKey,
      ),
    ) as StoredTokens,
  )
}

async function performLogin(
  deps: AuthDeps,
  tokens: MossTokenSet,
  me: MossMe,
  identityBaseUrl: string | null,
): Promise<LoginResult> {
  if (!me.organization) {
    // principal 需要组织归属；无组织的 Moss 账户不支持登录 WebUI
    throw new InvalidCredentialsError()
  }
  const principal = await upsertPrincipal(deps.pool, {
    mossUserId: me.user.id,
    orgId: me.organization.id,
    username: me.user.name,
    mossBaseUrl: identityBaseUrl,
  })

  // 登录成功总是生成全新 Web Session token（防 session fixation，计划 3.5）
  const cookieToken = generateSessionToken()
  const stored = serializeTokens(tokens)

  const session = await createWebSession(deps.pool, {
    principalId: principal.id,
    tokenDigest: digestToken(cookieToken, deps.config.sessionHmacKey),
    encrypted: encryptToken(JSON.stringify(stored), deps.config.tokenAesKey),
    accessExpiresAt: new Date(stored.expiresAt - 30_000),
    expiresAt: new Date(Date.now() + deps.config.session.ttlSeconds * 1000),
    mossBaseUrl: identityBaseUrl,
  })

  return { cookieToken, webSessionId: session.id }
}

async function fetchMe(deps: AuthDeps, accessToken: string, baseUrl: string): Promise<MossMe> {
  try {
    return await deps.mossAuth.me(accessToken, baseUrl)
  } catch (err) {
    if (err instanceof MossHttpError && err.status === 401) {
      throw new InvalidCredentialsError()
    }
    if (err instanceof MossNetworkError) {
      throw new MossUnavailableError(err)
    }
    throw err
  }
}

export async function loginWithPassword(
  deps: AuthDeps,
  input: { username: string; password: string; mossBaseUrl?: string },
): Promise<LoginResult> {
  const { baseUrl, identityBaseUrl } = resolveLoginMoss(deps.config, input.mossBaseUrl)
  let tokens: MossTokenSet
  try {
    tokens = await deps.mossAuth.loginWithPassword({ username: input.username, password: input.password }, baseUrl)
  } catch (err) {
    throw mapLoginError(err)
  }
  // 登录期无 session：me 必须走 resolveLoginMoss 的 baseUrl（用配置默认会向错误 moss 拿 me 致失败）
  const me = await fetchMe(deps, tokens.access_token, baseUrl)
  return performLogin(deps, tokens, me, identityBaseUrl)
}

export async function loginWithApiKey(deps: AuthDeps, apiKey: string, mossBaseUrl?: string): Promise<LoginResult> {
  const { baseUrl, identityBaseUrl } = resolveLoginMoss(deps.config, mossBaseUrl)
  let tokens: MossTokenSet
  try {
    tokens = await deps.mossAuth.loginWithApiKey(apiKey, baseUrl)
  } catch (err) {
    throw mapLoginError(err)
  }
  const me = await fetchMe(deps, tokens.access_token, baseUrl)
  return performLogin(deps, tokens, me, identityBaseUrl)
}

/** 按 webSessionId 进程内 single-flight 刷新；成功后原子替换加密 token（计划 3.1）。 */
async function refreshTokensFor(deps: AuthDeps, session: WebSessionRow): Promise<StoredTokens> {
  const existing = refreshInFlight.get(session.id)
  if (existing) return existing

  const task = (async () => {
    const stored = await decryptStored(deps, session)
    const tokens = await deps.mossAuth.refresh(stored.refreshToken, session.mossBaseUrl ?? deps.config.moss.baseUrl)
    const next = serializeTokens(tokens)
    await replaceSessionTokens(
      deps.pool,
      session.id,
      encryptToken(JSON.stringify(next), deps.config.tokenAesKey),
      new Date(next.expiresAt - 30_000),
    )
    return next
  })()

  refreshInFlight.set(session.id, task)
  try {
    return await task
  } finally {
    refreshInFlight.delete(session.id)
  }
}

export interface ResolvedSession {
  webSession: WebSessionRow
  principal: Principal
  me: MossMe
  tokens: StoredTokens
}

/** GET /api/auth/session 流程（计划 3.7）。返回 null 表示 Session 已失效。 */
export async function resolveSession(
  deps: AuthDeps,
  cookieToken: string,
): Promise<ResolvedSession | null> {
  const session = await findActiveSessionByDigest(
    deps.pool,
    digestToken(cookieToken, deps.config.sessionHmacKey),
  )
  if (!session) return null

  const principal = await findPrincipalById(deps.pool, session.principalId)
  if (!principal) return null

  let stored = await decryptStored(deps, session)

  // 即将过期（<60s）→ 先刷新；失败则继续用旧 token，由下方 me 决定去留
  if (stored.expiresAt - Date.now() < 60_000) {
    try {
      stored = await refreshTokensFor(deps, session)
    } catch {
      // 忽略，继续
    }
  }

  const sessionBaseUrl = session.mossBaseUrl ?? deps.config.moss.baseUrl
  let me: MossMe
  try {
    me = await deps.mossAuth.me(stored.accessToken, sessionBaseUrl)
  } catch (err) {
    if (err instanceof MossHttpError && err.status === 401) {
      try {
        stored = await refreshTokensFor(deps, session)
        me = await deps.mossAuth.me(stored.accessToken, sessionBaseUrl)
      } catch {
        return null
      }
    } else if (err instanceof MossNetworkError) {
      throw new MossUnavailableError(err)
    } else {
      throw err
    }
  }

  return { webSession: session, principal, me, tokens: stored }
}

/** 登出：只删除本地 Web Session（计划 1.3：不调用 Moss logout）。 */
export async function logout(deps: AuthDeps, webSessionId: string): Promise<void> {
  await deleteWebSession(deps.pool, webSessionId)
}

/**
 * 供 Conversation 等后续 feature 复用：按 session 行拿到 MossCallContext（access token + 该会话生效地址）。
 * 地址：session.mossBaseUrl（自定义登录）优先，否则配置默认。
 * 刷新失败不再静默回退旧 token：moss 拒绝刷新（401/403）说明登录态已失效，
 * 抛 MossUnauthorizedError（→401 引导重新登录）；网络类错误原样上抛（→503，不误报登录过期）。
 */
export async function getMossContext(deps: AuthDeps, session: WebSessionRow): Promise<MossCallContext> {
  const baseUrl = session.mossBaseUrl ?? deps.config.moss.baseUrl
  const stored = await decryptStored(deps, session)
  if (stored.expiresAt - Date.now() < 60_000) {
    try {
      const refreshed = await refreshTokensFor(deps, session)
      return { accessToken: refreshed.accessToken, baseUrl }
    } catch (err) {
      if (err instanceof MossHttpError && (err.status === 401 || err.status === 403)) {
        throw new MossUnauthorizedError(err)
      }
      throw err
    }
  }
  return { accessToken: stored.accessToken, baseUrl }
}
