import express, { type Express } from 'express'
import request from 'supertest'
import { describe, expect, test } from 'vitest'
import {
  createOriginGuard,
  createSecurityHeaders,
  noStore,
} from '@server/security/requestSecurity'

const PUBLIC_ORIGIN = 'http://localhost:5273'

function buildApp(imageOrigins?: string, warn?: (message: string) => void): Express {
  const app = express()
  app.use(createSecurityHeaders(imageOrigins, warn))
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

  test.each([undefined, '', '   ', ',,'])(
    'empty image origin config keeps the default img-src (%s)',
    async (raw) => {
      const res = await request(buildApp(raw)).get('/read')
      const csp = String(res.headers['content-security-policy'])
      expect(csp).toContain("img-src 'self' data:")
      expect(csp).not.toContain('https://sudowork-hub-1309794936.cos.ap-beijing.myqcloud.com')
    },
  )

  test('valid image origins are normalized, deduplicated, and added to img-src', async () => {
    const res = await request(
      buildApp(
        'https://IMAGES.example.test:443/, https://cdn.example.test:8443, https://images.example.test',
      ),
    ).get('/read')
    const csp = String(res.headers['content-security-policy'])
    const imgSrc = csp.split(';').find((directive) => directive.startsWith('img-src '))

    expect(imgSrc).toBe(
      "img-src 'self' data: https://images.example.test https://cdn.example.test:8443",
    )
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'self'")
  })

  test('invalid image origins are ignored without exposing their values', async () => {
    const warnings: string[] = []
    const secret = 'https://user:super-secret@credentials.example.test'
    const invalid = [
      '/relative',
      'data:',
      'file:///tmp/icon.png',
      'https:',
      'https://*.example.test',
      'https://semi;host.example.test',
      secret,
      'https://path.example.test/icons',
      'https://query.example.test?x=1',
      'https://hash.example.test#icon',
      'https://white space.example.test',
      'https://control\tcharacter.example.test',
    ]
    const res = await request(
      buildApp(['https://valid.example.test', ...invalid].join(','), (message) =>
        warnings.push(message),
      ),
    ).get('/read')
    const csp = String(res.headers['content-security-policy'])
    const imgSrc = csp.split(';').find((directive) => directive.startsWith('img-src '))

    expect(imgSrc).toBe("img-src 'self' data: https://valid.example.test")
    expect(warnings).toHaveLength(invalid.length)
    expect(warnings.every((message) => message.includes('CSP_IMG_SRC_ORIGINS'))).toBe(true)
    expect(warnings.join('\n')).not.toContain('super-secret')
    expect(warnings.join('\n')).not.toContain(secret)
    expect(imgSrc).not.toContain('https: https:')
    expect(imgSrc).not.toContain('*')
  })
})
