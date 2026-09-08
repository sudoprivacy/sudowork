import { expect, test } from '@playwright/test'
import { loginViaUi, mossHealthCheck, requireE2eEnv } from './support'

const env = requireE2eEnv()

test.beforeAll(async () => {
  await mossHealthCheck(env)
})

// The shared renderer has no console `data-testid` hooks; assert on hash
// navigation + renderer-verified behavior. Card-level selectors are calibrated
// against a live run (plan §4 item 2).

test('agents page is reachable at its hash route', async ({ page }) => {
  await loginViaUi(page, env)
  await page.goto('/#/app/agent')
  await expect(page).toHaveURL(/#\/app\/agent/)
  await expect(page).not.toHaveURL(/#\/login/)
})

test('skills page is reachable at its hash route', async ({ page }) => {
  await loginViaUi(page, env)
  await page.goto('/#/app/skills')
  await expect(page).toHaveURL(/#\/app\/skills/)
  await expect(page).not.toHaveURL(/#\/login/)
})

test('plain user sees no create action on the agents page (C3 admin gating)', async ({ page }) => {
  await loginViaUi(page, env) // test user is role=user (non-admin)
  await page.goto('/#/app/agent')
  await expect(page).toHaveURL(/#\/app\/agent/)
  // C3 gates the create entry behind admin:settings on the web host.
  await expect(page.getByText('创建智能体')).toHaveCount(0)
})
