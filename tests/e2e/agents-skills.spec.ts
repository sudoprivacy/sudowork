import { expect, test } from '@playwright/test'
import { loginViaUi, mossHealthCheck, requireE2eEnv } from './support'

const env = requireE2eEnv()

test.beforeAll(async () => {
  await mossHealthCheck(env)
})

test('agents page lists installed agents', async ({ page }) => {
  await loginViaUi(page, env)
  await page.goto('/agents')
  await page.waitForSelector('[data-testid="agents-page"]', { timeout: 20_000 })
  const cards = page.locator('[data-testid="assistant-card"]')
  expect(await cards.count()).toBeGreaterThanOrEqual(1)
})

test('skills page lists installed skills', async ({ page }) => {
  await loginViaUi(page, env)
  await page.goto('/skills')
  await page.waitForSelector('[data-testid="skills-page"]', { timeout: 20_000 })
  const cards = page.locator('[data-testid="skill-card"]')
  expect(await cards.count()).toBeGreaterThanOrEqual(1)
})

test('plain user sees no admin actions on agents page', async ({ page }) => {
  await loginViaUi(page, env) // test 用户为普通 role=user
  await page.goto('/agents')
  await page.waitForSelector('[data-testid="agents-page"]', { timeout: 20_000 })
  await expect(page.getByText('创建智能体')).toHaveCount(0)
})
