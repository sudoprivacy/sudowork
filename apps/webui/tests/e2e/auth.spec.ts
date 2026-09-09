import { expect, test } from '@playwright/test'
import { apiLogin, loginViaUi, mossHealthCheck, requireE2eEnv } from './support'

const env = requireE2eEnv()

test.beforeAll(async () => {
  await mossHealthCheck(env)
})

test('password login lands on the app (leaves the login route)', async ({ page }) => {
  await loginViaUi(page, env)
  // Shared-renderer landing is the guid page; assert we left /#/login.
  await expect(page).not.toHaveURL(/#\/login/)
  await expect(page.getByRole('textbox').first()).toBeVisible({ timeout: 20_000 })
})

test('api key login succeeds via API (cookie issued)', async ({ request }) => {
  const res = await request.post('/api/auth/login/api-key', {
    headers: { origin: env.baseUrl },
    data: { apiKey: env.userAApiKey },
  })
  expect(res.status()).toBe(200)
  const setCookie = res.headers()['set-cookie']
  expect(setCookie).toContain('sudowork_session=')
  const cookie = setCookie!.split(';')[0]!
  const session = await request.get('/api/auth/session', { headers: { cookie } })
  expect(session.status()).toBe(200)
  const body = (await session.json()) as { user: { name: string } }
  expect(body.user.name).toBe(env.userA.username)
})

test('wrong password shows the unified error and stays on login', async ({ page }) => {
  await page.goto('/#/login')
  await page.getByPlaceholder('请输入用户名').fill(env.userA.username)
  await page.getByPlaceholder('请输入密码').fill('definitely-wrong')
  await page.getByRole('button', { name: '登录' }).click()
  // Renderer shows the error via an Arco Message toast (see C1 web branch).
  await expect(page.getByText('用户名或密码错误')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveURL(/#\/login/)
})

test('logout clears session and returns to login', async ({ page }) => {
  await loginViaUi(page, env)
  // Session invalidation is the durable signal: after logout, hitting a
  // protected hash route returns to the login page.
  await page.evaluate(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
  })
  await page.goto('/#/app/agent')
  await page.waitForURL(/#\/login/, { timeout: 20_000 })
})

test('session restore (GET /api/auth/session) after reload', async ({ page }) => {
  await loginViaUi(page, env)
  await page.reload()
  // C1 refresh web branch re-hydrates the session from /api/auth/session.
  await expect(page).not.toHaveURL(/#\/login/, { timeout: 20_000 })
})

test('api helper sanity', async ({ request }) => {
  const cookie = await apiLogin(request, env)
  expect(cookie).toMatch(/^sudowork_session=/)
})
