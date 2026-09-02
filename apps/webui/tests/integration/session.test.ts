import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Pool } from 'pg'
import { upsertPrincipal, type Principal } from '@server/features/auth/principalRepository'
import {
  createWebSession,
  deleteWebSession,
  findActiveSessionByDigest,
  replaceSessionTokens,
  touchSession,
} from '@server/features/auth/sessionRepository'
import { digestToken, generateSessionToken } from '@server/security/sessionToken'
import { decryptToken, encryptToken } from '@server/security/tokenCipher'
import { createTestDatabase, destroyTestDatabase } from './helpers'

const HMAC_KEY = Buffer.from('integration-test-hmac-key-32-bytes-ok!')
const AES_KEY = Buffer.alloc(32, 7)

describe('web sessions', () => {
  let pool: Pool
  let principalA: Principal
  let principalB: Principal

  beforeAll(async () => {
    pool = await createTestDatabase()
    principalA = await upsertPrincipal(pool, {
      mossUserId: 'moss-user-a',
      orgId: 'org-1',
      username: 'test_a',
    })
    principalB = await upsertPrincipal(pool, {
      mossUserId: 'moss-user-b',
      orgId: 'org-1',
      username: 'test_b',
    })
  })

  afterAll(async () => {
    await destroyTestDatabase(pool)
  })

  test('cookie token is only stored as digest; roundtrip decrypt works', async () => {
    const token = generateSessionToken()
    const encrypted = encryptToken('moss-access-token-A', AES_KEY)
    const session = await createWebSession(pool, {
      principalId: principalA.id,
      tokenDigest: digestToken(token, HMAC_KEY),
      encrypted,
      accessExpiresAt: new Date(Date.now() + 3600_000),
      expiresAt: new Date(Date.now() + 7 * 86400_000),
    })

    const found = await findActiveSessionByDigest(pool, digestToken(token, HMAC_KEY))
    expect(found).not.toBeNull()
    expect(found!.id).toBe(session.id)
    expect(found!.principalId).toBe(principalA.id)

    // 原文可从库中密文恢复
    const plain = decryptToken(
      {
        ciphertext: found!.encryptedMossTokens,
        iv: found!.tokenIv,
        authTag: found!.tokenAuthTag,
      },
      AES_KEY,
    )
    expect(plain).toBe('moss-access-token-A')

    // 库中不保存 cookie 原文
    const raw = await pool.query('SELECT token_digest::text AS d FROM web_sessions WHERE id = $1', [
      session.id,
    ])
    expect(raw.rows[0]!.d).not.toContain(token)
  })

  test('sessions of different principals are isolated by digest', async () => {
    const tokenA = generateSessionToken()
    const tokenB = generateSessionToken()
    const sessionA = await createWebSession(pool, {
      principalId: principalA.id,
      tokenDigest: digestToken(tokenA, HMAC_KEY),
      encrypted: encryptToken('A-token', AES_KEY),
      accessExpiresAt: new Date(Date.now() + 3600_000),
      expiresAt: new Date(Date.now() + 7 * 86400_000),
    })
    const sessionB = await createWebSession(pool, {
      principalId: principalB.id,
      tokenDigest: digestToken(tokenB, HMAC_KEY),
      encrypted: encryptToken('B-token', AES_KEY),
      accessExpiresAt: new Date(Date.now() + 3600_000),
      expiresAt: new Date(Date.now() + 7 * 86400_000),
    })

    const viaA = await findActiveSessionByDigest(pool, digestToken(tokenA, HMAC_KEY))
    const viaB = await findActiveSessionByDigest(pool, digestToken(tokenB, HMAC_KEY))
    expect(viaA!.principalId).toBe(principalA.id)
    expect(viaA!.id).not.toBe(sessionB.id)
    expect(viaB!.principalId).toBe(principalB.id)
    expect(viaB!.id).not.toBe(sessionA.id)

    // 未知 digest 查不到任何 Session
    const unknown = await findActiveSessionByDigest(pool, digestToken(generateSessionToken(), HMAC_KEY))
    expect(unknown).toBeNull()
  })

  test('expired session is not returned', async () => {
    const token = generateSessionToken()
    await createWebSession(pool, {
      principalId: principalA.id,
      tokenDigest: digestToken(token, HMAC_KEY),
      encrypted: encryptToken('expiring', AES_KEY),
      accessExpiresAt: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() - 1000),
    })
    const found = await findActiveSessionByDigest(pool, digestToken(token, HMAC_KEY))
    expect(found).toBeNull()
  })

  test('replaceSessionTokens atomically swaps encrypted tokens', async () => {
    const token = generateSessionToken()
    const session = await createWebSession(pool, {
      principalId: principalA.id,
      tokenDigest: digestToken(token, HMAC_KEY),
      encrypted: encryptToken('old-token', AES_KEY),
      accessExpiresAt: new Date(Date.now() + 1000),
      expiresAt: new Date(Date.now() + 7 * 86400_000),
    })

    const next = encryptToken('refreshed-token', AES_KEY)
    await replaceSessionTokens(pool, session.id, next, new Date(Date.now() + 3600_000))

    const found = await findActiveSessionByDigest(pool, digestToken(token, HMAC_KEY))
    const plain = decryptToken(
      {
        ciphertext: found!.encryptedMossTokens,
        iv: found!.tokenIv,
        authTag: found!.tokenAuthTag,
      },
      AES_KEY,
    )
    expect(plain).toBe('refreshed-token')
    expect(found!.accessExpiresAt.getTime()).toBeGreaterThan(Date.now() + 3000_000)
  })

  test('touch and delete work', async () => {
    const token = generateSessionToken()
    const session = await createWebSession(pool, {
      principalId: principalB.id,
      tokenDigest: digestToken(token, HMAC_KEY),
      encrypted: encryptToken('t', AES_KEY),
      accessExpiresAt: new Date(Date.now() + 3600_000),
      expiresAt: new Date(Date.now() + 7 * 86400_000),
    })
    await new Promise((r) => setTimeout(r, 20))
    await touchSession(pool, session.id)
    await deleteWebSession(pool, session.id)
    expect(await findActiveSessionByDigest(pool, digestToken(token, HMAC_KEY))).toBeNull()
  })

  test('upsertPrincipal is idempotent per (org, moss_user_id) and refreshes login time', async () => {
    const again = await upsertPrincipal(pool, {
      mossUserId: 'moss-user-a',
      orgId: 'org-1',
      username: 'test_a_renamed',
    })
    expect(again.id).toBe(principalA.id)
    expect(again.username).toBe('test_a_renamed')
    expect(again.lastLoginAt.getTime()).toBeGreaterThanOrEqual(principalA.lastLoginAt.getTime())
  })
})
