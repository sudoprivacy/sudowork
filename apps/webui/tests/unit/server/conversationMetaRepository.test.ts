import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import {
  getConversationMeta,
  updateConversationMeta,
} from '../../../src/server/features/conversations/conversationMetaRepository.js'

describe('conversation metadata archive', () => {
  it('persists the first pin when no metadata row exists yet', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })

    await updateConversationMeta({ query } as unknown as Pool, 'principal', 'session', {
      pinned: true,
    })

    const [sql, params] = query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('pinned, pinned_at')
    expect(sql).toContain('pinned = $3')
    expect(params).toEqual(['principal', 'session', true])
  })

  it('archives a previously untracked conversation and unpins it atomically', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })

    await updateConversationMeta({ query } as unknown as Pool, 'principal', 'session', {
      pinned: true,
      archived: true,
    })

    const [sql, params] = query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('archived, archived_at')
    expect(sql).toContain('archived = $3')
    expect(sql).toContain('pinned = false')
    expect(sql).not.toContain('pinned = $')
    expect(params).toEqual(['principal', 'session', true])
  })

  it('maps archive state and restores it without changing other metadata', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            title: 'Saved',
            pinned: false,
            pinned_at: null,
            archived: true,
            archived_at: '42',
            model_id: 'model',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
    const pool = { query } as unknown as Pool

    await expect(getConversationMeta(pool, 'principal', 'session')).resolves.toEqual({
      title: 'Saved',
      pinned: false,
      pinnedAt: null,
      archived: true,
      archivedAt: 42,
      modelId: 'model',
    })

    await updateConversationMeta(pool, 'principal', 'session', { archived: false })
    const [sql, params] = query.mock.calls[1] as [string, unknown[]]
    expect(sql).toContain('archived = $3')
    expect(sql).toContain('archived_at = NULL')
    expect(params).toEqual(['principal', 'session', false])
  })
})
