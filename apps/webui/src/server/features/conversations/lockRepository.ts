import type { Pool } from 'pg'

/**
 * One prompt delivery gate per Moss control session.
 * New turns require idle; an existing turn can retain its writer.
 * Completion or a known unsent failure restores idle. Losing an accepted turn
 * preserves uncertainty until completion, termination, or a live idle observation
 * followed by an atomic acquisition of the observed uncertain lock version.
 */

export type LockState = 'idle' | 'running' | 'uncertain'

export type AcquireWriteResult =
  | { ok: true; state: 'running' }
  | { ok: false; reason: 'BUSY'; holderWebSessionId: string | null }
  | { ok: false; reason: 'UNCERTAIN' }

export async function acquireWriteLock(
  pool: Pool,
  input: {
    principalId: string
    mossSessionId: string
    webSessionId: string
    isExistingTurnAllowed?: boolean
  },
): Promise<AcquireWriteResult> {
  const { rows } = await pool.query(
    `INSERT INTO conversation_locks (principal_id, moss_session_id, writer_web_session_id, state, updated_at)
     VALUES ($1, $2, $3, 'running', now())
     ON CONFLICT (principal_id, moss_session_id) DO UPDATE
       SET writer_web_session_id = $3, state = 'running', updated_at = now()
       WHERE conversation_locks.state <> 'uncertain'
         AND (conversation_locks.state = 'idle'
              OR ($4::boolean AND (conversation_locks.writer_web_session_id IS NULL
                                   OR conversation_locks.writer_web_session_id = $3)))
     RETURNING state`,
    [
      input.principalId,
      input.mossSessionId,
      input.webSessionId,
      input.isExistingTurnAllowed ?? true,
    ],
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

/** Release a known unsent operation only while its writer still holds the running lock. */
export async function releaseToIdleIfHeld(
  pool: Pool,
  input: { principalId: string; mossSessionId: string; webSessionId: string },
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE conversation_locks SET state = 'idle', updated_at = now()
     WHERE principal_id = $1 AND moss_session_id = $2
       AND state = 'running' AND writer_web_session_id = $3`,
    [input.principalId, input.mossSessionId, input.webSessionId],
  )
  return (rowCount ?? 0) > 0
}

/** Capture the exact uncertain transition before observing the execution. */
export async function getUncertainLockVersion(
  pool: Pool,
  input: { principalId: string; mossSessionId: string },
): Promise<string | null> {
  const { rows } = await pool.query<{ version: string }>(
    `SELECT updated_at::text AS version FROM conversation_locks
     WHERE principal_id=$1 AND moss_session_id=$2 AND state='uncertain'`,
    [input.principalId, input.mossSessionId],
  )
  return rows[0]?.version ?? null
}

/** Admit only the new explicit send, if no lock transition occurred during its probe. */
export async function acquireRecoveredWriteLock(
  pool: Pool,
  input: { principalId: string; mossSessionId: string; webSessionId: string; version: string },
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE conversation_locks SET state='running', writer_web_session_id=$3, updated_at=now()
     WHERE principal_id=$1 AND moss_session_id=$2 AND state='uncertain' AND updated_at=$4::timestamptz`,
    [input.principalId, input.mossSessionId, input.webSessionId, input.version],
  )
  return (rowCount ?? 0) > 0
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
