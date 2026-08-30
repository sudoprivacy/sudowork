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
  // 默认 tab 为"智能体库"，切到"我的智能体"后断言 installed 列表
  await page.getByRole('button', { name: /我的智能体/ }).click()
  const cards = page.locator('[data-testid="assistant-card"]')
  await expect(cards.first()).toBeVisible({ timeout: 20_000 })
  expect(await cards.count()).toBeGreaterThanOrEqual(1)
})

test('skills page lists installed skills', async ({ page }) => {
  await loginViaUi(page, env)
  await page.goto('/skills')
  await page.waitForSelector('[data-testid="skills-page"]', { timeout: 20_000 })
  // 默认 tab 为"技能库"，切到"我的技能"后断言 installed 列表
  await page.getByRole('button', { name: /我的技能/ }).click()
  const cards = page.locator('[data-testid="skill-card"]')
  await expect(cards.first()).toBeVisible({ timeout: 20_000 })
  expect(await cards.count()).toBeGreaterThanOrEqual(1)
})

test('plain user sees no admin actions on agents page', async ({ page }) => {
  await loginViaUi(page, env) // test 用户为普通 role=user
  await page.goto('/agents')
  await page.waitForSelector('[data-testid="agents-page"]', { timeout: 20_000 })
  await expect(page.getByText('创建智能体')).toHaveCount(0)
})
