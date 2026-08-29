import type { Pool } from 'pg'

/**
 * conversation_locks 事务锁（计划 3.8）：
 * - 第一次发送：无 writer 或 writer=当前 → 原子取得写权并进入 running；否则 409
 * - 收到 result → idle（保留 writer 直到断开或主动离开）
 * - writer 在 idle 断开 → 清空 writer
 * - writer 在 running 断开或 WebUI 重启 → uncertain 并清空 writer
 * - uncertain：只允许 terminate（成功后删除 lock）或新建会话
 */

export type LockState = 'idle' | 'running' | 'uncertain'

export type AcquireWriteResult =
  | { ok: true; state: 'running' }
  | { ok: false; reason: 'BUSY'; holderWebSessionId: string | null }
  | { ok: false; reason: 'UNCERTAIN' }

export async function acquireWriteLock(
  pool: Pool,
  input: { principalId: string; mossSessionId: string; webSessionId: string },
): Promise<AcquireWriteResult> {
  const { rows } = await pool.query(
    `INSERT INTO conversation_locks (principal_id, moss_session_id, writer_web_session_id, state, updated_at)
     VALUES ($1, $2, $3, 'running', now())
     ON CONFLICT (principal_id, moss_session_id) DO UPDATE
       SET writer_web_session_id = $3, state = 'running', updated_at = now()
       WHERE conversation_locks.state <> 'uncertain'
         AND (conversation_locks.writer_web_session_id IS NULL
              OR conversation_locks.writer_web_session_id = $3)
     RETURNING state`,
    [input.principalId, input.mossSessionId, input.webSessionId],
  )
  if (rows[0]) return { ok: true, state: 'running' }

  const existing = await pool.query<{ state: string; writer_web_session_id: string | null }>(
    `SELECT state, writer_web_session_id FROM conversation_locks
     WHERE principal_id = $1 AND moss_session_id = $2`,
    [input.principalId, input.mossSessionId],
  )
  const row = existing.rows[0]
  if (!row) return { ok: true, state: 'running' } // 竞态下被删除，重试由调用方决定
  if (row.state === 'uncertain') return { ok: false, reason: 'UNCERTAIN' }
  return { ok: false, reason: 'BUSY', holderWebSessionId: row.writer_web_session_id }
}

/** 收到 Moss result 后：running → idle，保留 writer。 */
export async function releaseToIdle(
  pool: Pool,
  input: { principalId: string; mossSessionId: string },
): Promise<void> {
  await pool.query(
    `UPDATE conversation_locks SET state = 'idle', updated_at = now()
     WHERE principal_id = $1 AND moss_session_id = $2`,
    [input.principalId, input.mossSessionId],
  )
}

/** writer 在 idle 断开：立即清空 writer（会话可被其他设备接管）。 */
export async function clearWriterIfIdle(
  pool: Pool,
  input: { principalId: string; mossSessionId: string; webSessionId: string },
): Promise<void> {
  await pool.query(
    `UPDATE conversation_locks SET writer_web_session_id = NULL, updated_at = now()
     WHERE principal_id = $1 AND moss_session_id = $2
       AND writer_web_session_id = $3 AND state = 'idle'`,
    [input.principalId, input.mossSessionId, input.webSessionId],
  )
}

/** writer 在 running 断开：state → uncertain 并清空 writer（不自动重发）。 */
export async function markUncertain(
  pool: Pool,
  input: { principalId: string; mossSessionId: string; webSessionId: string },
): Promise<void> {
  await pool.query(
    `UPDATE conversation_locks SET state = 'uncertain', writer_web_session_id = NULL, updated_at = now()
     WHERE principal_id = $1 AND moss_session_id = $2
       AND writer_web_session_id = $3 AND state = 'running'`,
    [input.principalId, input.mossSessionId, input.webSessionId],
  )
}

/** terminate 成功后删除 lock（uncertain 的唯一出口之一）。 */
export async function deleteLock(
  pool: Pool,
  input: { principalId: string; mossSessionId: string },
): Promise<void> {
  await pool.query(
    `DELETE FROM conversation_locks WHERE principal_id = $1 AND moss_session_id = $2`,
    [input.principalId, input.mossSessionId],
  )
}

/** 服务启动时：遗留 running → uncertain（计划 2.1）。 */
export async function startupRecovery(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE conversation_locks SET state = 'uncertain', writer_web_session_id = NULL, updated_at = now()
     WHERE state = 'running'`,
  )
  return rowCount ?? 0
}

export async function getLock(
  pool: Pool,
  input: { principalId: string; mossSessionId: string },
): Promise<{ state: LockState; writerWebSessionId: string | null } | null> {
  const { rows } = await pool.query(
    `SELECT state, writer_web_session_id AS "writerWebSessionId"
     FROM conversation_locks WHERE principal_id = $1 AND moss_session_id = $2`,
    [input.principalId, input.mossSessionId],
  )
  return rows[0] ?? null
}
