import { expect, test } from '@playwright/test'
import { loginViaUi, mossHealthCheck, requireE2eEnv } from './support'

const env = requireE2eEnv()

test.beforeAll(async () => {
  await mossHealthCheck(env)
})

test('settings sider has exactly four items', async ({ page }) => {
  await loginViaUi(page, env)
  await page.goto('/settings/profile')
  await page.waitForSelector('[data-settings-id]', { timeout: 20_000 })
  const ids = await page.locator('[data-settings-id]').evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.settingsId),
  )
  expect(ids.sort()).toEqual(['about', 'display', 'mcp', 'profile'])
})

test('profile page shows identity without password change', async ({ page }) => {
  await loginViaUi(page, env)
  await page.goto('/settings/profile')
  await page.waitForSelector('[data-testid="profile-page"]', { timeout: 20_000 })
  await expect(page.getByText('用户名')).toBeVisible()
  await expect(page.getByText('修改密码')).toHaveCount(0)
})

test('display preferences persist', async ({ page }) => {
  await loginViaUi(page, env)
  await page.goto('/settings/display')
  await page.waitForSelector('[data-testid="display-page"]', { timeout: 20_000 })
  await page.getByText('深色').click()
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(800)
  await page.reload()
  await page.waitForSelector('[data-testid="display-page"]', { timeout: 20_000 })
  const darkChecked = await page.getByText('深色').getAttribute('class')
  expect(darkChecked).toBeTruthy()
})

test('about page shows webui version and moss endpoint', async ({ page }) => {
  await loginViaUi(page, env)
  await page.goto('/settings/about')
  await page.waitForSelector('[data-testid="about-page"]', { timeout: 20_000 })
  await expect(page.getByText('sudowork-webui')).toBeVisible()
})

test('mcp settings page renders', async ({ page }) => {
  await loginViaUi(page, env)
  await page.goto('/settings/mcp')
  await page.waitForSelector('[data-testid="mcp-settings-page"]', { timeout: 20_000 })
})
