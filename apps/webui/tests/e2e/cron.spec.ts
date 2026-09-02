import { expect, test } from '@playwright/test'
import { apiLogin, cleanupCronByPrefix, loginViaUi, mossHealthCheck, requireE2eEnv } from './support'

const env = requireE2eEnv()

test.beforeAll(async () => {
  await mossHealthCheck(env)
})

test.afterAll(async ({ request }) => {
  // 计划 3.11：清理失败使 E2E 失败
  await cleanupCronByPrefix(request, env)
})

test('cron CRUD with prefix and runs endpoint', async ({ request }) => {
  const cookie = await apiLogin(request, env)
  const name = `${env.prefix}-job-1`

  // 创建
  const create = await request.post('/api/cron', {
    headers: { cookie, origin: env.baseUrl },
    data: {
      name,
      schedule: { kind: 'every', value: '60m' },
      conversationMode: 'new',
    },
  })
  expect(create.status()).toBe(201)
  const job = (await create.json()) as { id?: string; name?: string }
  const jobId = job.id ?? (job as { data?: { id: string } }).data?.id
  expect(jobId, 'created job id').toBeTruthy()

  try {
    // 列表可见（且为本用户）
    const list = await request.get('/api/cron', { headers: { cookie } })
    expect(list.status()).toBe(200)
    const { jobs } = (await list.json()) as { jobs: { name: string }[] }
    expect(jobs.some((j) => j.name === name)).toBe(true)

    // 详情
    const detail = await request.get(`/api/cron/${encodeURIComponent(jobId!)}`, { headers: { cookie } })
    expect([200, 201]).toContain(detail.status())

    // runs
    const runs = await request.get(`/api/cron/${encodeURIComponent(jobId!)}/runs?limit=5`, {
      headers: { cookie },
    })
    expect(runs.status()).toBe(200)
  } finally {
    // 删除
    const del = await request.delete(`/api/cron/${encodeURIComponent(jobId!)}`, {
      headers: { cookie, origin: env.baseUrl },
    })
    expect(del.status(), `delete failed: ${await del.text()}`).toBe(200)
  }
})

test('cron page renders jobs table', async ({ page, request }) => {
  const cookie = await apiLogin(request, env)
  const name = `${env.prefix}-ui-job`
  const create = await request.post('/api/cron', {
    headers: { cookie, origin: env.baseUrl },
    data: { name, schedule: { kind: 'every', value: '60m' }, conversationMode: 'new' },
  })
  expect(create.status()).toBe(201)

  try {
    await loginViaUi(page, env)
    await page.goto('/cron')
    await page.waitForSelector('[data-testid="cron-page"]', { timeout: 20_000 })
    await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 })
  } finally {
    const jobId = ((await create.json()) as { id?: string }).id
    if (jobId) {
      await request.delete(`/api/cron/${encodeURIComponent(jobId)}`, {
        headers: { origin: env.baseUrl },
      })
    }
  }
})
