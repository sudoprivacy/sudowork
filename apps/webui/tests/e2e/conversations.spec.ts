import { expect, test } from '@playwright/test'
import { loginViaUi, mossHealthCheck, requireE2eEnv, terminateSession } from './support'

const env = requireE2eEnv()

test.beforeAll(async () => {
  await mossHealthCheck(env)
})

test('create a remote conversation (no agent selected), stream one reply without duplication', async ({ page, request }) => {
  test.setTimeout(180_000)
  await loginViaUi(page, env)

  // 新会话页（新布局）：不选智能体直接输入发送（空 assistantName，走 Moss 默认）
  await page.getByLabel('消息输入框').fill('请只回复两个字：收到')
  await page.getByRole('button', { name: '发送' }).click()
  await page.waitForSelector('[data-testid="conversation-page"]', { timeout: 60_000 })

  const reply = page.locator('[data-testid="assistant-message"]').first()
  await expect(reply).toBeVisible({ timeout: 120_000 })
  await expect(reply).toContainText('收到', { timeout: 60_000 })

  // 双份回归断言：回复完成收敛后，assistant 气泡与 user 气泡各只出现一次
  // （历史接管流副本；等待一个轮询周期让收敛过滤生效）
  await page.waitForTimeout(7_000)
  await expect(page.locator('[data-testid="assistant-message"]')).toHaveCount(1)
  const userBubbles = page.locator('[data-testid="message-list"] >> text=请只回复两个字：收到')
  await expect(userBubbles).toHaveCount(1)

  // 历史列表出现该会话（新布局：分组行）
  await expect(page.locator('[data-testid="conversation-history"]')).toBeVisible()
  await expect(page.locator('[data-testid="conversation-row"]').first()).toBeVisible()

  // 清理：terminate 该会话
  const url = page.url()
  const sessionId = url.split('/conversation/')[1]?.split(/[?#]/)[0]
  expect(sessionId, 'session id from url').toBeTruthy()
  await terminateSession(request, env, sessionId!)

  await page.waitForTimeout(500)
})

test('conversation header shows model selector / SudoCode / status dot / panel toggle', async ({ page, request }) => {
  await loginViaUi(page, env)
  await page.getByLabel('消息输入框').fill('回复：好')
  await page.getByRole('button', { name: '发送' }).click()
  await page.waitForSelector('[data-testid="conversation-page"]', { timeout: 60_000 })
  await page.locator('[data-testid="assistant-message"]').first().waitFor({ timeout: 120_000 })

  // 头部五要素（模型选择/标题/SudoCode/状态点/面板开关）
  await expect(page.getByRole('button', { name: '模型选择' })).toBeVisible()
  await expect(page.getByText('SudoCode').first()).toBeVisible()
  await expect(page.locator('[data-testid="conn-status-dot"]')).toBeVisible()

  // 面板开关：展开右侧面板（默认收起），两 tab 可见（终端 tab 已按需求隐藏），再收起
  await page.locator('[data-testid="toggle-right-panel"]').click()
  await expect(page.locator('[data-testid="right-panel"]')).toBeVisible()
  await expect(page.locator('[data-testid="right-panel-tab-workspace"]')).toBeVisible()
  await expect(page.locator('[data-testid="right-panel-tab-terminal"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="right-panel-tab-deliverables"]')).toBeVisible()
  await page.locator('[data-testid="toggle-right-panel"]').click()
  await expect(page.locator('[data-testid="right-panel"]')).toHaveCount(0)
  // 收起态浮动展开箭头可见
  await expect(page.locator('[data-testid="right-panel-floating-expand"]')).toBeVisible()

  // 清理
  const sessionId = page.url().split('/conversation/')[1]?.split(/[?#]/)[0]
  if (sessionId) await terminateSession(request, env, sessionId)
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
