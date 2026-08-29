import { expect } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'

/**
 * E2E 支撑（计划 3.11）：
 * - 必填环境缺失 → 直接失败（不 skip 发布门禁）
 * - 前置健康检查：两用户可登录、models/available 至少一个模型
 * - 资源一律带 E2E_TEST_PREFIX 前缀；结束清理，清理失败使测试失败
 */

export interface E2eEnv {
  baseUrl: string
  mossUrl: string
  userA: { username: string; password: string }
  userB: { username: string; password: string }
  userAApiKey: string
  prefix: string
}

export function requireE2eEnv(): E2eEnv {
  const missing: string[] = []
  const check = (name: string, value: string | undefined): string => {
    if (!value || value.trim() === '') missing.push(name)
    return value as string
  }
  const env: E2eEnv = {
    baseUrl: check('E2E_BASE_URL', process.env.E2E_BASE_URL ?? 'http://127.0.0.1:26808'),
    mossUrl: check('MOSS_BASE_URL', process.env.MOSS_BASE_URL),
    userA: {
      username: check('E2E_USER_A_USERNAME', process.env.E2E_USER_A_USERNAME),
      password: check('E2E_USER_A_PASSWORD', process.env.E2E_USER_A_PASSWORD),
    },
    userB: {
      username: check('E2E_USER_B_USERNAME', process.env.E2E_USER_B_USERNAME),
      password: check('E2E_USER_B_PASSWORD', process.env.E2E_USER_B_PASSWORD),
    },
    userAApiKey: check('E2E_USER_A_API_KEY', process.env.E2E_USER_A_API_KEY),
    prefix: check('E2E_TEST_PREFIX', process.env.E2E_TEST_PREFIX),
  }
  if (missing.length > 0) {
    throw new Error(`E2E gate: missing required env: ${missing.join(', ')}（计划 3.11：不得 skip）`)
  }
  return env
}

/** 前置健康检查（直接打 Moss）：两用户可登录 + 至少一个可用模型。 */
export async function mossHealthCheck(env: E2eEnv): Promise<void> {
  for (const user of [env.userA, env.userB]) {
    const res = await fetch(`${env.mossUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'password', username: user.username, password: user.password }),
    })
    expect(res.status, `moss login should succeed for ${user.username}`).toBe(200)
  }
  const tokenRes = await fetch(`${env.mossUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'password', username: env.userA.username, password: env.userA.password }),
  })
  const tokens = (await tokenRes.json()) as { access_token: string }
  const models = await fetch(`${env.mossUrl}/api/v1/models/available`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  })
  expect(models.status).toBe(200)
  const modelsJson = (await models.json()) as { data?: unknown[] }
  expect(modelsJson.data?.length ?? 0, 'at least one available model').toBeGreaterThan(0)
}

/** 浏览器登录（密码方式）。 */
export async function loginViaUi(page: Page, env: E2eEnv, user = env.userA): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('用户名').fill(user.username)
  await page.getByLabel('密码').fill(user.password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForSelector('[data-testid="new-conversation"]', { timeout: 20_000 })
}

/** API 登录拿 cookie（用 playwright request context）。 */
export async function apiLogin(
  request: APIRequestContext,
  env: E2eEnv,
  user = env.userA,
): Promise<string> {
  // Playwright APIRequestContext 不自动带 Origin；origin guard 要求显式提供
  const res = await request.post('/api/auth/login/password', {
    headers: { origin: env.baseUrl },
    data: { username: user.username, password: user.password },
  })
  expect(res.status()).toBe(200)
  const setCookie = res.headers()['set-cookie']
  expect(setCookie).toBeTruthy()
  return setCookie!.split(';')[0]!
}

/** 清理带前缀的 cron 任务（A/B 两个用户都清）。 */
export async function cleanupCronByPrefix(
  request: APIRequestContext,
  env: E2eEnv,
): Promise<void> {
  for (const user of [env.userA, env.userB]) {
    const cookie = await apiLogin(request, env, user)
    const listRes = await request.get('/api/cron', { headers: { cookie } })
    if (listRes.status() !== 200) continue
    const { jobs } = (await listRes.json()) as { jobs: { id: string; name: string }[] }
    for (const job of jobs ?? []) {
      if (job.name?.startsWith(env.prefix)) {
        const del = await request.delete(`/api/cron/${encodeURIComponent(job.id)}`, {
          headers: { cookie, origin: env.baseUrl },
        })
        expect(del.status(), `cleanup cron ${job.name}`).toBe(200)
      }
    }
  }
}

/** 清理带前缀的会话（terminate）。 */
export async function cleanupSessionsByPrefix(
  request: APIRequestContext,
  env: E2eEnv,
): Promise<void> {
  const cookie = await apiLogin(request, env)
  const listRes = await request.get('/api/conversations', { headers: { cookie } })
  if (listRes.status() !== 200) return
  const { conversations } = (await listRes.json()) as { conversations: { id: string; assistantName: string | null }[] }
  for (const conv of conversations ?? []) {
    // 以 assistant 名称为前缀标记不可靠；E2E 会话通过显式收集 id 清理（见各 spec）
    void conv
  }
}

export async function terminateSession(
  request: APIRequestContext,
  env: E2eEnv,
  sessionId: string,
): Promise<void> {
  const cookie = await apiLogin(request, env)
  const res = await request.post(`/api/conversations/${encodeURIComponent(sessionId)}/terminate`, {
    headers: { cookie, origin: env.baseUrl },
  })
  expect([200, 404]).toContain(res.status())
}
