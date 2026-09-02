import { describe, expect, test, vi } from 'vitest'
import { createMossCronPort } from '@server/moss/MossCronClient'

const BASE = 'http://moss.test'
const TK = 'tk'

describe('MossCronPort request shapes（修订版 3.9）', () => {
  test('CRUD/trigger/runs paths match baseline routes', async () => {
    const mock = vi.fn().mockResolvedValue({ jobs: [] })
    const port = createMossCronPort(mock, BASE)
    await port.list(TK)
    await port.get(TK, 'j1')
    await port.create(TK, { name: 'n', schedule: { kind: 'cron', value: '0 9 * * *' } })
    await port.update(TK, 'j1', { enabled: false })
    await port.remove(TK, 'j1')
    await port.trigger(TK, 'j1')
    await port.runs(TK, 'j1', 20)

    const calls = mock.mock.calls.map(
      (c) =>
        (c[1] as { method: string; path: string; searchParams?: Record<string, string> }),
    )
    expect(calls.map((c) => `${c.method} ${c.path}${c.searchParams ? `?${new URLSearchParams(c.searchParams)}` : ''}`)).toEqual([
      'GET /api/v1/cron/jobs',
      'GET /api/v1/cron/jobs/j1',
      'POST /api/v1/cron/jobs',
      'PATCH /api/v1/cron/jobs/j1',
      'DELETE /api/v1/cron/jobs/j1',
      'POST /api/v1/cron/jobs/j1/trigger',
      'GET /api/v1/cron/jobs/j1/runs?limit=20',
    ])
    expect(mock.mock.calls.every((c) => (c[1] as { accessToken?: string }).accessToken === TK)).toBe(true)
  })

  test('admin list uses /api/v1/admin/cron/jobs', async () => {
    const mock = vi.fn().mockResolvedValue({ data: [] })
    const port = createMossCronPort(mock, BASE)
    await port.adminList(TK)
    expect(mock).toHaveBeenCalledWith(BASE, {
      method: 'GET',
      path: '/api/v1/admin/cron/jobs',
      accessToken: TK,
    })
  })

  test('schedule body uses value field (never expr)', async () => {
    const mock = vi.fn().mockResolvedValue({ ok: true })
    const port = createMossCronPort(mock, BASE)
    const body = {
      name: 'daily',
      schedule: { kind: 'every' as const, value: '30m', tz: 'Asia/Shanghai' },
      conversationMode: 'new' as const,
      assistantName: 'helper',
    }
    await port.create(TK, body)
    const sent = mock.mock.calls[0]![1] as { body: Record<string, unknown> }
    expect(sent.body).toEqual(body)
    expect(JSON.stringify(sent.body)).not.toContain('expr')
  })
})
