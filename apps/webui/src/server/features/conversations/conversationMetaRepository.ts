import type { Pool } from 'pg'

/**
 * conversation_meta 仓储（标题/置顶，Moss 无对应字段的本地存储）。
 * principal 维度隔离；pinned_at 兼作置顶排序键（拖拽排序时重写，对齐 Sudowork sortOrder 语义）。
 */

export interface ConversationMeta {
  title: string | null
  pinned: boolean
  pinnedAt: number | null
  /** 会话所选模型（getConversationMetaMap 的列表场景不提供该字段） */
  modelId?: string | null
}

export async function getConversationMeta(
  pool: Pool,
  principalId: string,
  mossSessionId: string,
): Promise<ConversationMeta | null> {
  const { rows } = await pool.query<{
    title: string | null
    pinned: boolean
    pinned_at: string | null
    model_id: string | null
  }>(
    `SELECT title, pinned, pinned_at, model_id FROM conversation_meta
     WHERE principal_id = $1 AND moss_session_id = $2`,
    [principalId, mossSessionId],
  )
  const row = rows[0]
  if (!row) return null
  return {
    title: row.title,
    pinned: row.pinned,
    pinnedAt: row.pinned_at === null ? null : Number(row.pinned_at),
    modelId: row.model_id,
  }
}

/** 批量取（列表合并用），一次查询 */
export async function getConversationMetaMap(
  pool: Pool,
  principalId: string,
  mossSessionIds: string[],
): Promise<Map<string, ConversationMeta>> {
  const map = new Map<string, ConversationMeta>()
  if (mossSessionIds.length === 0) return map
  const { rows } = await pool.query<{ moss_session_id: string; title: string | null; pinned: boolean; pinned_at: string | null }>(
    `SELECT moss_session_id, title, pinned, pinned_at FROM conversation_meta
     WHERE principal_id = $1 AND moss_session_id = ANY($2)`,
    [principalId, mossSessionIds],
  )
  for (const row of rows) {
    map.set(row.moss_session_id, {
      title: row.title,
      pinned: row.pinned,
      pinnedAt: row.pinned_at === null ? null : Number(row.pinned_at),
    })
  }
  return map
}

/** 会话模型写入（不存在则插入；不覆盖标题/置顶字段） */
export async function upsertConversationModel(
  pool: Pool,
  principalId: string,
  mossSessionId: string,
  modelId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO conversation_meta (principal_id, moss_session_id, model_id, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (principal_id, moss_session_id) DO UPDATE
       SET model_id = $3, updated_at = now()`,
    [principalId, mossSessionId, modelId],
  )
}

/** 标题写入（不存在则插入；不覆盖置顶字段） */
export async function upsertConversationTitle(
  pool: Pool,
  principalId: string,
  mossSessionId: string,
  title: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO conversation_meta (principal_id, moss_session_id, title, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (principal_id, moss_session_id) DO UPDATE
       SET title = $3, updated_at = now()`,
    [principalId, mossSessionId, title],
  )
}

export interface MetaUpdate {
  title?: string
  pinned?: boolean
}

/** 重命名/置顶（部分更新）。置顶时若 pinned_at 为空则写入当前时间。 */
export async function updateConversationMeta(
  pool: Pool,
  principalId: string,
  mossSessionId: string,
  update: MetaUpdate,
): Promise<void> {
  // INSERT 列须随 title 动态补齐：行不存在时走 INSERT，若 title 不进列则新行标题恒为 NULL
  const insertCols = ['principal_id', 'moss_session_id', 'updated_at']
  const insertVals = ['$1', '$2', 'now()']
  const params: unknown[] = [principalId, mossSessionId]
  const sets: string[] = ['updated_at = now()']
  if (update.title !== undefined) {
    params.push(update.title)
    insertCols.push('title')
    insertVals.push(`$${params.length}`)
    sets.push(`title = $${params.length}`)
  }
  if (update.pinned !== undefined) {
    params.push(update.pinned)
    sets.push(`pinned = $${params.length}`)
    if (update.pinned) sets.push('pinned_at = COALESCE(pinned_at, (extract(epoch from now()) * 1000)::bigint)')
    else sets.push('pinned_at = NULL')
  }
  await pool.query(
    `INSERT INTO conversation_meta (${insertCols.join(', ')})
     VALUES (${insertVals.join(', ')})
     ON CONFLICT (principal_id, moss_session_id) DO UPDATE SET ${sets.join(', ')}`,
    params,
  )
}

/** 拖拽排序：按顺序重写置顶项的 pinned_at（gap 步进，对齐 Sudowork sortOrderHelpers） */
export async function reorderPinnedConversations(
  pool: Pool,
  principalId: string,
  orderedIds: string[],
): Promise<void> {
  const gap = 1000
  await pool.query('BEGIN')
  try {
    for (let i = 0; i < orderedIds.length; i++) {
      await pool.query(
        `UPDATE conversation_meta SET pinned_at = $3, updated_at = now()
         WHERE principal_id = $1 AND moss_session_id = $2 AND pinned`,
        [principalId, orderedIds[i], (i + 1) * gap],
      )
    }
    await pool.query('COMMIT')
  } catch (err) {
    await pool.query('ROLLBACK')
    throw err
  }
}

/** 删除会话元数据（DELETE 会话时连带） */
export async function deleteConversationMeta(
  pool: Pool,
  principalId: string,
  mossSessionId: string,
): Promise<void> {
  await pool.query(
    `DELETE FROM conversation_meta WHERE principal_id = $1 AND moss_session_id = $2`,
    [principalId, mossSessionId],
  )
}
