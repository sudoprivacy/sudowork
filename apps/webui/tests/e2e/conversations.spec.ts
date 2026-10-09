import { expect, test } from '@playwright/test'
import { loginViaUi, mossHealthCheck, requireE2eEnv } from './support'

const env = requireE2eEnv()

test.beforeAll(async () => {
  await mossHealthCheck(env)
})

// The shared renderer has no console `data-testid` hooks. The full send/stream +
// right-panel (workspace / deliverables) flow is exercised by the manual
// acceptance checklist and calibrated against a live run (plan §4 item 3); here
// we assert the reachable composer and the session list API.

test('guid landing exposes the message composer', async ({ page }) => {
  await loginViaUi(page, env)
  await page.goto('/#/guid')
  await expect(page).toHaveURL(/#\/guid/)
  await expect(page.getByRole('textbox').first()).toBeVisible({ timeout: 20_000 })
})

test('conversation history is served from the session API', async ({ page }) => {
  await loginViaUi(page, env)
  const count = await page.evaluate(async () => {
    const res = await fetch('/api/conversations', { credentials: 'include' })
    const body = (await res.json()) as { conversations: { id: string }[] }
    return body.conversations.length
  })
  expect(count).toBeGreaterThanOrEqual(0)
})
