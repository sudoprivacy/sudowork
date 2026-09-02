import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { EncryptedToken } from '../../security/tokenCipher.js'

/**
 * web_sessions 仓储（计划 3.1）：
 * - 浏览器只保存随机 HttpOnly Cookie；库中只存 HMAC 摘要
 * - 每个 Web Session 独立保存加密后的 Moss token（AES-256-GCM）
 */

export interface WebSessionRow {
  id: string
  principalId: string
  tokenDigest: Buffer
  encryptedMossTokens: Buffer
  tokenIv: Buffer
  tokenAuthTag: Buffer
  accessExpiresAt: Date
  expiresAt: Date
  createdAt: Date
  lastSeenAt: Date
}

const SESSION_COLUMNS = `id, principal_id AS "principalId", token_digest AS "tokenDigest",
  encrypted_moss_tokens AS "encryptedMossTokens", token_iv AS "tokenIv",
  token_auth_tag AS "tokenAuthTag", access_expires_at AS "accessExpiresAt",
  expires_at AS "expiresAt", created_at AS "createdAt", last_seen_at AS "lastSeenAt"`

export interface CreateWebSessionInput {
  principalId: string
  tokenDigest: Buffer
  encrypted: EncryptedToken
  accessExpiresAt: Date
  expiresAt: Date
}

export async function createWebSession(
  pool: Pool,
  input: CreateWebSessionInput,
): Promise<WebSessionRow> {
  const { rows } = await pool.query<WebSessionRow>(
    `INSERT INTO web_sessions
       (id, token_digest, principal_id, encrypted_moss_tokens, token_iv, token_auth_tag,
        access_expires_at, expires_at, created_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
     RETURNING ${SESSION_COLUMNS}`,
    [
      randomUUID(),
      input.tokenDigest,
      input.principalId,
      input.encrypted.ciphertext,
      input.encrypted.iv,
      input.encrypted.authTag,
      input.accessExpiresAt,
      input.expiresAt,
    ],
  )
  const row = rows[0]
  if (!row) throw new Error('createWebSession returned no row')
  return row
}

/** 只返回未过期（expires_at > now()）的 Session。 */
export async function findActiveSessionByDigest(
  pool: Pool,
  tokenDigest: Buffer,
): Promise<WebSessionRow | null> {
  const { rows } = await pool.query<WebSessionRow>(
    `SELECT ${SESSION_COLUMNS}
     FROM web_sessions
     WHERE token_digest = $1 AND expires_at > now()`,
    [tokenDigest],
  )
  return rows[0] ?? null
}

export async function findSessionById(pool: Pool, id: string): Promise<WebSessionRow | null> {
  const { rows } = await pool.query<WebSessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM web_sessions WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}

export async function touchSession(pool: Pool, id: string): Promise<void> {
  await pool.query('UPDATE web_sessions SET last_seen_at = now() WHERE id = $1', [id])
}

/** 原子替换某 Web Session 的加密 Moss token 与到期时间（token 刷新用，计划 3.1）。 */
export async function replaceSessionTokens(
  pool: Pool,
  id: string,
  encrypted: EncryptedToken,
  accessExpiresAt: Date,
): Promise<void> {
  await pool.query(
    `UPDATE web_sessions
     SET encrypted_moss_tokens = $2, token_iv = $3, token_auth_tag = $4,
         access_expires_at = $5, last_seen_at = now()
     WHERE id = $1`,
    [id, encrypted.ciphertext, encrypted.iv, encrypted.authTag, accessExpiresAt],
  )
}

export async function deleteWebSession(pool: Pool, id: string): Promise<void> {
  await pool.query('DELETE FROM web_sessions WHERE id = $1', [id])
}
