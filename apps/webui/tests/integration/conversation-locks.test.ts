import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Pool } from 'pg'
import { upsertPrincipal } from '@server/features/auth/principalRepository'
import { createWebSession } from '@server/features/auth/sessionRepository'
import { digestToken, generateSessionToken } from '@server/security/sessionToken'
import { encryptToken } from '@server/security/tokenCipher'
import {
  acquireWriteLock,
  clearWriterIfIdle,
  deleteLock,
  getLock,
  markUncertain,
  releaseToIdle,
  startupRecovery,
} from '@server/features/conversations/lockRepository'
import { createTestDatabase, destroyTestDatabase } from './helpers'

const HMAC_KEY = Buffer.from('integration-test-hmac-key-32-bytes-ok!')
const AES_KEY = Buffer.alloc(32, 7)

describe('conversation_locks（计划 3.8）', () => {
  let pool: Pool
  let principalId: string
  let W1: string
  let W2: string

  beforeAll(async () => {
    pool = await createTestDatabase()
    const principal = await upsertPrincipal(pool, {
      mossUserId: 'moss-a',
      orgId: 'org-1',
      username: 'user_a',
    })
    principalId = principal.id

    const mkSession = async (): Promise<string> => {
      const s = await createWebSession(pool, {
        principalId,
        tokenDigest: digestToken(generateSessionToken(), HMAC_KEY),
        encrypted: encryptToken('t', AES_KEY),
        accessExpiresAt: new Date(Date.now() + 3600_000),
        expiresAt: new Date(Date.now() + 86400_000),
      })
      return s.id
    }
    W1 = await mkSession()
    W2 = await mkSession()
  })

  afterAll(async () => {
    await destroyTestDatabase(pool)
  })

  const SID = `sess-${randomUUID().slice(0, 8)}`

  test('first writer atomically acquires running lock', async () => {
    const res = await acquireWriteLock(pool, {
      principalId,
      mossSessionId: SID,
      webSessionId: W1,
    })
    expect(res).toEqual({ ok: true, state: 'running' })
    expect(await getLock(pool, { principalId, mossSessionId: SID })).toEqual({
      state: 'running',
      writerWebSessionId: W1,
    })
  })

  test('second device gets BUSY while running', async () => {
    const res = await acquireWriteLock(pool, {
      principalId,
      mossSessionId: SID,
      webSessionId: W2,
    })
    expect(res).toEqual({ ok: false, reason: 'BUSY', holderWebSessionId: W1 })
  })

  test('same writer can re-acquire (send multiple turns)', async () => {
    const res = await acquireWriteLock(pool, {
      principalId,
      mossSessionId: SID,
      webSessionId: W1,
    })
    expect(res).toEqual({ ok: true, state: 'running' })
  })

  test('result releases to idle but keeps writer; idle disconnect clears writer; next device takes over', async () => {
    await releaseToIdle(pool, { principalId, mossSessionId: SID })
    expect(await getLock(pool, { principalId, mossSessionId: SID })).toEqual({
      state: 'idle',
      writerWebSessionId: W1,
    })

    // writer 在 idle 断开 → 清空 writer
    await clearWriterIfIdle(pool, { principalId, mossSessionId: SID, webSessionId: W1 })
    expect(await getLock(pool, { principalId, mossSessionId: SID })).toEqual({
      state: 'idle',
      writerWebSessionId: null,
    })

    // 其他设备接管
    const res = await acquireWriteLock(pool, {
      principalId,
      mossSessionId: SID,
      webSessionId: W2,
    })
    expect(res).toEqual({ ok: true, state: 'running' })
  })

  test('running writer disconnect marks uncertain and blocks writes', async () => {
    await markUncertain(pool, { principalId, mossSessionId: SID, webSessionId: W2 })
    expect(await getLock(pool, { principalId, mossSessionId: SID })).toEqual({
      state: 'uncertain',
      writerWebSessionId: null,
    })

    const res = await acquireWriteLock(pool, {
      principalId,
      mossSessionId: SID,
      webSessionId: W1,
    })
    expect(res).toEqual({ ok: false, reason: 'UNCERTAIN' })

    // uncertain 的出口：删除 lock（terminate 成功后）
    await deleteLock(pool, { principalId, mossSessionId: SID })
    expect(await getLock(pool, { principalId, mossSessionId: SID })).toBeNull()
  })

  test('startupRecovery turns leftover running into uncertain', async () => {
    await acquireWriteLock(pool, { principalId, mossSessionId: 'sess-boot', webSessionId: W1 })
    const count = await startupRecovery(pool)
    expect(count).toBeGreaterThanOrEqual(1)
    expect(await getLock(pool, { principalId, mossSessionId: 'sess-boot' })).toEqual({
      state: 'uncertain',
      writerWebSessionId: null,
    })
  })

  test('locks are isolated per principal', async () => {
    const other = await upsertPrincipal(pool, {
      mossUserId: 'moss-b',
      orgId: 'org-1',
      username: 'user_b',
    })
    await acquireWriteLock(pool, { principalId, mossSessionId: 'sess-x', webSessionId: W1 })
    const res = await acquireWriteLock(pool, {
      principalId: other.id,
      mossSessionId: 'sess-x',
      webSessionId: W2,
    })
    expect(res).toEqual({ ok: true, state: 'running' })
  })
})
