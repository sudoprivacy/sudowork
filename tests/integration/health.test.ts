import request from 'supertest'
import { describe, expect, test } from 'vitest'
import { createApp } from '@server/app'

describe('GET /health/live', () => {
  test('returns 200 with status ok', async () => {
    const res = await request(createApp({ publicOrigin: 'http://localhost:5173' })).get(
      '/health/live',
    )
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })
})
