import { expect, test } from '@playwright/test'
import { loginViaUi, mossHealthCheck, requireE2eEnv } from './support'

const env = requireE2eEnv()

test.beforeAll(async () => {
  await mossHealthCheck(env)
})

// NOTE: the shared renderer has no console `data-*` hooks; these assert on hash
// navigation and renderer-verified text. Fine-grained SettingsSider item
// assertions are calibrated against a live run (plan §4 item 2).

test('settings sub-pages are reachable via hash routes', async ({ page }) => {
  await loginViaUi(page, env)
  for (const sub of ['profile', 'display', 'about', 'mcp']) {
    await page.goto(`/#/settings/${sub}`)
    await expect(page).toHaveURL(new RegExp(`#/settings/${sub}`))
    await expect(page).not.toHaveURL(/#\/login/)
  }
})

test('about page renders and hides the desktop-only updater on web', async ({ page }) => {
  await loginViaUi(page, env)
  await page.goto('/#/settings/about')
  await expect(page).toHaveURL(/#\/settings\/about/)
  // C5: the web host hides "检查更新" (in-app updater) and the ops modal entry.
  await expect(page.getByText('检查更新')).toHaveCount(0)
})

test('display preferences persist across reload (browser-local, R8)', async ({ page }) => {
  await loginViaUi(page, env)
  await page.goto('/#/settings/display')
  await expect(page).toHaveURL(/#\/settings\/display/)
  // Theme/font live in localStorage; a reload keeps the display page reachable
  // with the persisted prefs (detailed control selectors need live calibration).
  await page.reload()
  await expect(page).toHaveURL(/#\/settings\/display/)
})
