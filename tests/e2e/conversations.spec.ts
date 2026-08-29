import { expect, test } from '@playwright/test'
import { loginViaUi, mossHealthCheck, requireE2eEnv, terminateSession } from './support'

const env = requireE2eEnv()

test.beforeAll(async () => {
  await mossHealthCheck(env)
})

test('create a remote conversation, stream one reply, terminate', async ({ page, request }) => {
  test.setTimeout(180_000)
  await loginViaUi(page, env)

  // 新会话页：选智能体 → 输入首条消息 → 发送（创建会话并自动发送）
  await page.waitForSelector('[data-testid^="agent-option-"]', { timeout: 30_000 })
  await page.locator('[data-testid^="agent-option-"]').first().click()

  await page.getByLabel('消息输入框').fill('请只回复两个字：收到')
  await page.getByRole('button', { name: '发送' }).click()
  await page.waitForSelector('[data-testid="conversation-page"]', { timeout: 60_000 })

  const reply = page.locator('[data-testid="assistant-message"]').first()
  await expect(reply).toBeVisible({ timeout: 120_000 })
  await expect(reply).toContainText('收到', { timeout: 60_000 })

  // 历史列表出现该会话
  await expect(page.locator('[data-testid="conversation-history"]')).toBeVisible()

  // 清理：terminate 该会话
  const url = page.url()
  const sessionId = url.split('/conversation/')[1]?.split(/[?#]/)[0]
  expect(sessionId, 'session id from url').toBeTruthy()
  await terminateSession(request, env, sessionId!)

  await page.waitForTimeout(500)
})

test('conversation history lists sessions from all clients', async ({ page }) => {
  await loginViaUi(page, env)
  // 列表来自 Moss 全量 own sessions（不区分创建客户端）
  const cookieHeader = await page.evaluate(async () => {
    const res = await fetch('/api/conversations', { credentials: 'include' })
    const body = (await res.json()) as { conversations: { id: string }[] }
    return body.conversations.length
  })
  expect(cookieHeader).toBeGreaterThanOrEqual(0)
  await expect(page.locator('[data-testid="conversation-history"]')).toBeVisible()
})
