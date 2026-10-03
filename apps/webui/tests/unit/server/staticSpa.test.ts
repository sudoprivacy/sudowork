import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import request from 'supertest'
import { afterEach, describe, expect, test } from 'vitest'
import { registerStaticSpa } from '@server/app'

let fixtureDir: string | undefined
afterEach(async () => {
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true })
})

describe('production SPA assets', () => {
  test('serves current chunks, rejects missing chunks and keeps page fallback', async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), 'webui-static-'))
    await mkdir(join(fixtureDir, 'assets'))
    await writeFile(join(fixtureDir, 'index.html'), '<html>SPA fixture</html>')
    await writeFile(join(fixtureDir, 'assets', 'current.js'), 'export default 42')
    const app = express()
    registerStaticSpa(app, fixtureDir)
    const current = await request(app).get('/assets/current.js').expect(200)
    expect(current.headers['content-type']).toContain('javascript')
    for (const path of ['/assets/old-deployment.js', '/assets/missing.css']) {
      const missing = await request(app).get(path).expect(404)
      expect(missing.text).not.toContain('SPA fixture')
    }
    expect((await request(app).get('/conversation/qa').expect(200)).text).toContain('SPA fixture')
    await request(app).get('/api/missing').expect(404)
  })
})
