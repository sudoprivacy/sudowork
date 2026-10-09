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

  const idsA = ((await listA.json()) as { conversations: { id: string }[] }).conversations.map(
    (c) => c.id,
  )
  const idsB = ((await listB.json()) as { conversations: { id: string }[] }).conversations.map(
    (c) => c.id,
  )
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

test('two browser contexts of the same user each reach an authenticated composer', async ({
  browser,
}) => {
  // The collaboration takeover flow (observer picks up after the writer's turn)
  // depends on renderer stream selectors calibrated against a live run
  // (plan §4 item 3); here we assert both contexts authenticate independently
  // and land on a usable composer.
  const ctxA = await browser.newContext()
  const pageA = await ctxA.newPage()
  await loginViaUi(pageA, env)
  await pageA.goto('/#/guid')
  await expect(pageA.getByRole('textbox').first()).toBeVisible({ timeout: 20_000 })

  const ctxB = await browser.newContext()
  const pageB = await ctxB.newPage()
  await loginViaUi(pageB, env)
  await pageB.goto('/#/guid')
  await expect(pageB.getByRole('textbox').first()).toBeVisible({ timeout: 20_000 })

  await ctxA.close()
  await ctxB.close()
})
