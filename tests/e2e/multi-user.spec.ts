import { expect, test } from '@playwright/test'
import { apiLogin, loginViaUi, mossHealthCheck, requireE2eEnv } from './support'

const env = requireE2eEnv()

test.beforeAll(async () => {
  await mossHealthCheck(env)
})

test('user A and B see isolated conversation lists', async ({ request }) => {
  const cookieA = await apiLogin(request, env, env.userA)
  const cookieB = await apiLogin(request, env, env.userB)

  const listA = await request.get('/api/conversations', { headers: { cookie: cookieA } })
  const listB = await request.get('/api/conversations', { headers: { cookie: cookieB } })
  expect(listA.status()).toBe(200)
  expect(listB.status()).toBe(200)

  const idsA = ((await listA.json()) as { conversations: { id: string }[] }).conversations.map((c) => c.id)
  const idsB = ((await listB.json()) as { conversations: { id: string }[] }).conversations.map((c) => c.id)
  const overlap = idsA.filter((id) => idsB.includes(id))
  expect(overlap, 'no shared conversation ids between users').toEqual([])
})

test('user B cannot read user A session context', async ({ request }) => {
  const cookieA = await apiLogin(request, env, env.userA)
  const listA = await request.get('/api/conversations', { headers: { cookie: cookieA } })
  const { conversations } = (await listA.json()) as { conversations: { id: string }[] }
  const target = conversations[0]?.id
  if (!target) return // 无会话时跳过（创建路径由 conversations.spec 覆盖）

  const cookieB = await apiLogin(request, env, env.userB)
  const cross = await request.get(`/api/conversations/${encodeURIComponent(target)}/context`, {
    headers: { cookie: cookieB },
  })
  expect(cross.status()).toBe(403)
})

test('two browser contexts of same user: single writer, observer read-only', async ({ browser }) => {
  test.setTimeout(150_000)
  const ctxA = await browser.newContext()
  const pageA = await ctxA.newPage()
  await loginViaUi(pageA, env)

  await pageA.waitForSelector('[data-testid^="agent-option-"]', { timeout: 30_000 })
  await pageA.locator('[data-testid^="agent-option-"]').first().click()
  await pageA.getByLabel('消息输入框').fill('请只回复两个字：收到')
  await pageA.getByRole('button', { name: '发送' }).click()
  await pageA.waitForSelector('[data-testid="conversation-page"]', { timeout: 60_000 })
  const url = pageA.url()
  const sessionId = url.split('/conversation/')[1]?.split(/[?#]/)[0] ?? ''
  expect(sessionId).toBeTruthy()

  // 第二个 context 打开同一会话（观察者）
  const ctxO = await browser.newContext()
  const pageO = await ctxO.newPage()
  await loginViaUi(pageO, env)
  await pageO.goto(`/conversation/${sessionId}`)
  await pageO.waitForSelector('[data-testid="conversation-page"]', { timeout: 30_000 })

  // 观察者也能看到流式输出（首条消息已随会话创建自动发送）
  const obsReply = pageO.locator('[data-testid="assistant-message"]').first()
  await expect(obsReply).toBeVisible({ timeout: 120_000 })

  // 观察者输入框为禁用（只读）
  await expect(pageO.getByLabel('消息输入框')).toBeDisabled()

  await ctxA.close()
  await ctxO.close()
})
