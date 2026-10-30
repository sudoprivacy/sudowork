import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import express from 'express'
import type { Pool } from 'pg'
import { expect, test } from '@playwright/test'
import { createMossAuthPort, mossRequest } from '@sudowork/moss-client'
import { createApp, registerApiRoutes, registerStaticSpa } from '../../src/server/app'
import type { AppConfig } from '../../src/server/config'
import { createTestDatabase, destroyTestDatabase } from '../integration/helpers'

test.use({ channel: 'chrome', launchOptions: { executablePath: process.env.E2E_CHROME_PATH } })

// The production SPA, HTTP server, PostgreSQL sessions and Moss adapter are real.
// This fixture owns the upstream HTTP contract; real Vault persistence is covered
// by Moss's installed-daemon acceptance and the production browser journey.
interface StoredSecret {
  namespace: string
  key: string
  value: string
  isEnabled: boolean
}

const secrets = new Map<string, StoredSecret>()
const requests: Array<{ owner: string; method: string; path: string }> = []
let pool: Pool | undefined
let upstream: Server | undefined
let web: Server | undefined
let origin = ''

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  return `http://127.0.0.1:${address.port}`
}

async function close(server: Server | undefined): Promise<void> {
  if (!server) return
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}

test.beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error('An isolated PostgreSQL fixture is required')
  pool = await createTestDatabase()
  const moss = express()
  moss.use(express.json())
  moss.post('/api/v1/auth/login', (req, res) => {
    const owner = req.body.username
    if (!['vault-alice', 'vault-bob'].includes(owner) || req.body.password !== 'fixture-password') {
      res.status(401).json({ error: 'invalid_credentials' })
      return
    }
    res.json({
      access_token: `fixture-${owner}`,
      refresh_token: `refresh-${owner}`,
      token_type: 'Bearer',
      expires_in: 3600,
    })
  })
  moss.use((req, res, next) => {
    const owner = req.get('Authorization')?.replace(/^Bearer fixture-/, '')
    if (owner !== 'vault-alice' && owner !== 'vault-bob') {
      res.status(401).json({ error: 'invalid_token' })
      return
    }
    res.locals.owner = owner
    requests.push({ owner, method: req.method, path: req.path })
    next()
  })
  moss.get('/api/v1/auth/me', (_req, res) => {
    res.json({
      user: { id: res.locals.owner, name: res.locals.owner },
      organization: { id: 'fixture-org', name: 'Fixture' },
      scopes: [],
      role: 'user',
    })
  })
  moss.get('/api/v1/config/items', (_req, res) => {
    res.json({
      success: true,
      data: [
        {
          id: 1,
          name: 'ShareOne',
          pinyin: 'shareone',
          scope: 'user',
          entries: [{ id: 1, name: 'ShareOne Key', config_key: 'shareone_key', required: 1 }],
        },
        {
          id: 2,
          name: 'Ent Vault',
          pinyin: 'entvault',
          scope: 'system',
          entries: [{ id: 2, name: 'Ent Key', config_key: 'ent_key', required: 1 }],
        },
        {
          id: 3,
          name: 'Dept Vault',
          pinyin: 'deptvault',
          scope: 'department',
          entries: [{ id: 3, name: 'Dept Key', config_key: 'dept_key', required: 1 }],
        },
      ],
    })
  })
  moss.get('/api/v1/me/authorized-system-configs', (_req, res) => {
    res.json({
      success: true,
      data: [
        { id: 2, name: 'Ent Vault', pinyin: 'entvault', scope: 'system' },
        { id: 3, name: 'Dept Vault', pinyin: 'deptvault', scope: 'department' },
      ],
    })
  })
  moss.get('/api/v1/me/secrets', (_req, res) => {
    res.json({
      success: true,
      data: [...secrets.values()]
        .filter((secret) => secret.namespace === `user:${res.locals.owner}:shareone`)
        .map(({ namespace, key, isEnabled }) => ({
          namespace,
          key,
          enabled: isEnabled,
          status: isEnabled ? 'enabled' : 'disabled',
          version: 1,
        })),
    })
  })
  moss.use('/api/v1/me/secrets/:namespace/:key', (req, res, next) => {
    if (req.params.namespace !== `user:${res.locals.owner}:shareone`) {
      res.status(403).json({ success: false, error: { code: 'forbidden' } })
      return
    }
    next()
  })
  moss.all('/api/v1/me/secrets/:namespace/:key', (req, res) => {
    const namespace = String(req.params.namespace)
    const key = String(req.params.key)
    const address = `${namespace}/${key}`
    if (req.method === 'PUT') {
      secrets.set(address, {
        namespace,
        key,
        value: String(req.body.value),
        isEnabled: secrets.get(address)?.isEnabled ?? false,
      })
      res.json({ success: true })
    } else if (req.method === 'DELETE') {
      secrets.delete(address)
      res.json({ success: true })
    } else if (req.method === 'GET') {
      const stored = secrets.get(address)
      res.json(
        stored
          ? { success: true, data: { value: stored.value } }
          : { success: false, error: { code: 'not_found' } },
      )
    } else {
      res.sendStatus(405)
    }
  })
  moss.post('/api/v1/me/secrets/:namespace/:key/:action', (req, res) => {
    const secret = secrets.get(`${req.params.namespace}/${req.params.key}`)
    if (!secret || !['enable', 'disable'].includes(String(req.params.action))) {
      res.status(404).json({ success: false, error: { code: 'not_found' } })
      return
    }
    secret.isEnabled = req.params.action === 'enable'
    res.json({ success: true })
  })
  upstream = createServer(moss)
  const mossOrigin = await listen(upstream)
  web = createServer()
  origin = await listen(web)
  const config: AppConfig = {
    server: { host: '127.0.0.1', port: Number(new URL(origin).port) },
    publicOrigin: origin,
    trustProxy: false,
    moss: {
      baseUrl: mossOrigin,
      wsBaseUrl: mossOrigin.replace('http:', 'ws:'),
      allowedOrigins: [],
    },
    session: { ttlSeconds: 3600 },
    upload: { maxFileBytes: 1024, maxFilesPerRequest: 1, maxTotalBytes: 1024 },
    isProduction: false,
    databaseUrl: '',
    sessionHmacKey: Buffer.alloc(32, 5),
    tokenAesKey: Buffer.alloc(32, 7),
    cookieSecure: false,
  }
  const app = createApp({ publicOrigin: origin })
  registerApiRoutes(app, { config, pool, mossAuth: createMossAuthPort(mossRequest) })
  registerStaticSpa(app, join(process.cwd(), 'dist/client'))
  web.on('request', app)
})

test.afterAll(async () => {
  const results = await Promise.allSettled([
    close(web),
    close(upstream),
    pool ? destroyTestDatabase(pool) : Promise.resolve(),
  ])
  const errors = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason)
  if (errors.length) throw new AggregateError(errors, 'Vault browser fixture cleanup failed')
})

test('Vault form saves, enables and restores after a full reload with owner isolation', async ({
  page,
  context,
  browser,
}, testInfo) => {
  const login = await context.request.post(`${origin}/api/auth/login/password`, {
    headers: { origin },
    data: { username: 'vault-alice', password: 'fixture-password' },
  })
  expect(login.status()).toBe(200)
  const path = '/api/v1/me/secrets/user%3Avault-alice%3Ashareone/shareone_key'
  const fixture = 'QA_ONLY_VAULT_BROWSER_ROUNDTRIP'
  const openForm = async () => {
    await page.getByRole('tab', { name: /我的凭据|My credentials/i }).click()
    await page.locator('.arco-collapse-item-header').filter({ hasText: 'ShareOne' }).click()
  }
  await page.goto(`${origin}/#/settings/channels`)
  await openForm()
  const field = page.getByPlaceholder(/ShareOne Key/)
  await expect(field).toHaveValue('')
  await field.fill(fixture)
  await page.getByRole('button', { name: /^(保存|Save)$/ }).click()
  await expect
    .poll(() => secrets.get('user:vault-alice:shareone/shareone_key')?.isEnabled)
    .toBe(true)
  expect(secrets.get('user:vault-alice:shareone/shareone_key')?.value).toBe(fixture)
  await page.reload()
  await openForm()
  await expect(field).toHaveValue(fixture)
  await expect(field).toBeInViewport({ ratio: 1 })
  await expect(field).toHaveAttribute('type', 'password')
  await expect(page.getByRole('switch')).toBeChecked()
  await page.screenshot({ path: testInfo.outputPath('vault-restored.png'), animations: 'disabled' })
  const browserStorage = await page.evaluate(() => JSON.stringify(localStorage))
  expect(browserStorage).not.toContain('fixture-vault-alice')
  expect(browserStorage).not.toContain(fixture)
  const other = await browser.newContext()
  try {
    const signedIn = await other.request.post(`${origin}/api/auth/login/password`, {
      headers: { origin },
      data: { username: 'vault-bob', password: 'fixture-password' },
    })
    expect(signedIn.status()).toBe(200)
    const refused = await other.request.get(`${origin}${path}`, {
      headers: { Authorization: 'Bearer fixture-vault-alice' },
    })
    expect(refused.status()).toBe(403)
    expect(await refused.json()).toEqual({ success: false, error: { code: 'forbidden' } })
  } finally {
    await other.close()
  }
  expect(requests).toContainEqual({ owner: 'vault-alice', method: 'PUT', path })
  const deleted = await context.request.delete(`${origin}${path}`, { headers: { origin } })
  expect(deleted.status()).toBe(200)
  expect(secrets.size).toBe(0)
  await page.reload()
  await openForm()
  await expect(field).toHaveValue('')
  await expect(page.getByRole('switch')).not.toBeChecked()
})

test('enterprise and department sections render read-only ahead of user credentials', async ({
  page,
  context,
}) => {
  const login = await context.request.post(`${origin}/api/auth/login/password`, {
    headers: { origin },
    data: { username: 'vault-alice', password: 'fixture-password' },
  })
  expect(login.status()).toBe(200)
  await page.goto(`${origin}/#/settings/channels`)
  await page.getByRole('tab', { name: /我的凭据|My credentials/i }).click()

  const enterpriseTitle = page.getByText(/企业凭据|Enterprise Credentials/)
  const departmentTitle = page.getByText(/部门凭据|Department Credentials/)
  const userTitle = page.getByText(/用户凭据|User Credentials/)
  await expect(enterpriseTitle).toBeVisible()
  await expect(departmentTitle).toBeVisible()
  await expect(userTitle).toBeVisible()

  const [enterpriseBox, departmentBox, userBox] = await Promise.all([
    enterpriseTitle.boundingBox(),
    departmentTitle.boundingBox(),
    userTitle.boundingBox(),
  ])
  expect(enterpriseBox!.y).toBeLessThan(departmentBox!.y)
  expect(departmentBox!.y).toBeLessThan(userBox!.y)

  // Locked values are masked and disabled; no plaintext ever reaches the page.
  await page.locator('.arco-collapse-item-header').filter({ hasText: 'Ent Vault' }).click()
  const lockedInputs = page.locator('input[disabled]')
  await expect(lockedInputs.first()).toHaveValue('*****')
  const body = await page.locator('body').innerText()
  expect(body).not.toContain('ent_key')
})
