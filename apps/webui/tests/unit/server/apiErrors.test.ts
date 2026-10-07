// @vitest-environment node
import express from 'express'
import request from 'supertest'
import { describe, expect, test } from 'vitest'
import { MossHttpError, MossNetworkError } from '@sudowork/moss-client'
import { onApiError } from '@server/app'

function setup(error?: Error) {
  const app = express()
  app.use(express.json({ limit: '1kb' }))
  app.post('/request', (_req, res, next) => {
    if (error) next(error)
    else res.json({ ok: true })
  })
  app.use(onApiError)
  return app
}

describe('API error status semantics', () => {
  test.each([400, 401, 403, 404, 409, 422, 429])(
    'preserves upstream %i without leaking its body',
    async (status) => {
      const app = setup(new MossHttpError(status, 'secret upstream body /private/path', '/private'))
      const response = await request(app).post('/request').send({})
      expect(response.status).toBe(status)
      expect(response.body).toEqual({
        error:
          status === 401 ? 'MOSS_UNAUTHORIZED' : status === 403 ? 'MOSS_FORBIDDEN' : 'MOSS_ERROR',
      })
      expect(response.text).not.toContain('secret')
    },
  )

  test.each([500, 502, 503])('maps upstream %i to a gateway failure', async (status) => {
    const response = await request(setup(new MossHttpError(status, 'internal', '/private')))
      .post('/request')
      .send({})
    expect(response.status).toBe(502)
  })

  test('reports unreachable Moss as unavailable', async () => {
    const response = await request(
      setup(new MossNetworkError('/request', new Error('unreachable'))),
    )
      .post('/request')
      .send({})
    expect(response.status).toBe(503)
    expect(response.body).toEqual({ error: 'MOSS_UNAVAILABLE' })
  })

  test('rejects malformed JSON as a client error', async () => {
    const response = await request(setup())
      .post('/request')
      .set('Content-Type', 'application/json')
      .send('{"unfinished":')
    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: 'INVALID_JSON' })
  })

  test('keeps the body size limit', async () => {
    const response = await request(setup())
      .post('/request')
      .send({ value: 'x'.repeat(2000) })
    expect(response.status).toBe(413)
    expect(response.body).toEqual({ error: 'FILE_TOO_LARGE' })
  })

  test('keeps unexpected failures generic', async () => {
    const response = await request(setup(new Error('password=private')))
      .post('/request')
      .send({})
    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: 'INTERNAL' })
  })
})
