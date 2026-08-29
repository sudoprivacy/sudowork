import express, { type Express } from 'express'
import request from 'supertest'
import { describe, expect, test } from 'vitest'
import {
  createOriginGuard,
  noStore,
  securityHeaders,
} from '@server/security/requestSecurity'

const PUBLIC_ORIGIN = 'http://localhost:5273'

function buildApp(): Express {
  const app = express()
  app.use(securityHeaders)
  app.use(noStore)
  app.use(createOriginGuard(PUBLIC_ORIGIN))
  app.post('/mutate', (_req, res) => res.json({ ok: true }))
  app.get('/read', (_req, res) => res.json({ ok: true }))
  return app
}

describe('requestSecurity', () => {
  test('state-changing request with matching Origin passes', async () => {
    const res = await request(buildApp()).post('/mutate').set('Origin', PUBLIC_ORIGIN)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  test('state-changing request with foreign Origin is rejected', async () => {
    const res = await request(buildApp()).post('/mutate').set('Origin', 'https://evil.example')
    expect(res.status).toBe(403)
  })

  test('state-changing request without Origin requires same-origin Sec-Fetch-Site', async () => {
    const ok = await request(buildApp())
      .post('/mutate')
      .set('Sec-Fetch-Site', 'same-origin')
    expect(ok.status).toBe(200)

    const noneOk = await request(buildApp()).post('/mutate').set('Sec-Fetch-Site', 'none')
    expect(noneOk.status).toBe(200)

    const cross = await request(buildApp())
      .post('/mutate')
      .set('Sec-Fetch-Site', 'cross-site')
    expect(cross.status).toBe(403)
  })

  test('state-changing request with neither Origin nor Sec-Fetch-Site is rejected', async () => {
    const res = await request(buildApp()).post('/mutate')
    expect(res.status).toBe(403)
  })

  test('read-only requests are not blocked by origin guard', async () => {
    const res = await request(buildApp()).get('/read').set('Origin', 'https://evil.example')
    expect(res.status).toBe(200)
  })

  test('responses carry Cache-Control: no-store and helmet headers', async () => {
    const res = await request(buildApp()).get('/read')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBeDefined()
  })
})
