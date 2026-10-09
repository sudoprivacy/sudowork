import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'

/**
 * web_principals 仓储：登录成功时 upsert（计划 2.1）。
 * 只保存身份映射，不保存任何 Moss 业务数据。
 */

export interface Principal {
  id: string
  mossUserId: string
  orgId: string
  username: string
  /** 自定义 Moss 地址登录时的身份地址（默认地址为 null）；身份键 = (地址, org, user) */
  mossBaseUrl: string | null
  createdAt: Date
  lastLoginAt: Date
}

const PRINCIPAL_COLUMNS = `id, moss_user_id AS "mossUserId", org_id AS "orgId",
  username, moss_base_url AS "mossBaseUrl", created_at AS "createdAt", last_login_at AS "lastLoginAt"`

export async function upsertPrincipal(
  pool: Pool,
  input: { mossUserId: string; orgId: string; username: string; mossBaseUrl?: string | null },
): Promise<Principal> {
  const { rows } = await pool.query<Principal>(
    // ON CONFLICT 目标须与 004 迁移的表达式唯一索引一致：(COALESCE(moss_base_url,''), org_id, moss_user_id)
    `INSERT INTO web_principals (id, moss_user_id, org_id, username, moss_base_url, created_at, last_login_at)
     VALUES ($1, $2, $3, $4, $5, now(), now())
     ON CONFLICT (COALESCE(moss_base_url, ''), org_id, moss_user_id) DO UPDATE
       SET username = EXCLUDED.username, last_login_at = now()
     RETURNING ${PRINCIPAL_COLUMNS}`,
    [randomUUID(), input.mossUserId, input.orgId, input.username, input.mossBaseUrl ?? null],
  )
  const row = rows[0]
  if (!row) throw new Error('upsertPrincipal returned no row')
  return row
}

export async function findPrincipalById(pool: Pool, id: string): Promise<Principal | null> {
  const { rows } = await pool.query<Principal>(
    `SELECT ${PRINCIPAL_COLUMNS} FROM web_principals WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}
