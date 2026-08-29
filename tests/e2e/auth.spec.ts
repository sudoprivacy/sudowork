import { expect, test } from '@playwright/test'
import { apiLogin, loginViaUi, mossHealthCheck, requireE2eEnv } from './support'

const env = requireE2eEnv()

test.beforeAll(async () => {
  await mossHealthCheck(env)
})

test('password login enters the app shell', async ({ page }) => {
  await loginViaUi(page, env)
  await expect(page.getByText('智能体').first()).toBeVisible()
  await expect(page.getByText('技能库').first()).toBeVisible()
  await expect(page.getByText('定时任务').first()).toBeVisible()
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

test('wrong password shows unified error and stays on login', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('用户名').fill(env.userA.username)
  await page.getByLabel('密码').fill('definitely-wrong')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('alert')).toHaveText('用户名或密码错误')
  await expect(page).toHaveURL(/\/login/)
})

test('logout clears session and returns to login', async ({ page }) => {
  await loginViaUi(page, env)
  await page.getByText(env.userA.username, { exact: false }).first().click()
  await page.getByText('退出登录').click()
  await page.waitForURL(/\/login/, { timeout: 20_000 })
  // 会话已失效：直接访问受保护路由回到登录页
  await page.goto('/guid')
  await page.waitForURL(/\/login/, { timeout: 20_000 })
})

test('session restore (GET /api/auth/session) after reload', async ({ page, request }) => {
  void request
  await loginViaUi(page, env)
  await page.reload()
  await page.waitForSelector('[data-testid="new-conversation"]', { timeout: 20_000 })
})

test('api helper sanity', async ({ request }) => {
  const cookie = await apiLogin(request, env)
  expect(cookie).toMatch(/^sudowork_session=/)
})
