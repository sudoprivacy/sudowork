import { expect, test } from '@playwright/test'

for (const viewport of [
  { width: 1366, height: 900 },
  { width: 375, height: 812 },
]) {
  test(`consultation and optional contact work at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    let contactSubmitted = false
    await page.route('**/public/**', async (route) => {
      const url = new URL(route.request().url())
      const path = url.pathname
      if (path === '/public/consult/context') {
        await route.fulfill({
          json: {
            display_name: '测试园区',
            logo_url: null,
            welcome_text: '请提出您的问题',
            contact_enabled: true,
            published_policy_version: 'v1',
          },
        })
      } else if (path === '/public/consult/quick-questions') {
        await route.fulfill({
          json: [{ id: 'q1', question: '有哪些算力支持？', sort_order: 1 }],
        })
      } else if (path === '/public/consult/sessions') {
        await route.fulfill({
          status: 201,
          headers: {
            'set-cookie': 'park_session=test-session; HttpOnly; SameSite=Lax; Path=/public',
          },
          json: {
            session_id: 'test-session',
            expires_at: Date.now() + 86_400_000,
          },
        })
      } else if (path.endsWith('/messages') && route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'event: delta\ndata: {"text":"算力服务可申请，具体以园区确认为准。"}\n\nevent: sources\ndata: [{"name":"算力政策","version":"v1","section":"第一条"}]\n\nevent: done\ndata: {}\n\n',
        })
      } else if (path.endsWith('/contact')) {
        contactSubmitted = true
        await route.fulfill({ status: 201, json: { submitted: true } })
      } else {
        await route.fulfill({ status: 404, json: { error: 'NOT_FOUND' } })
      }
    })
    await page.goto('/consult')
    await expect(page.getByText('测试园区').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /联系园区/ })).toHaveCount(1)
    await expect(page.getByText('云栖智谷 · 公开咨询')).toHaveCount(0)
    await expect(page.getByText('匿名提问 · 无需登录')).toHaveCount(0)
    await page.getByRole('button', { name: '有哪些算力支持？' }).click()
    await expect(page.getByText('算力服务可申请，具体以园区确认为准。')).toBeVisible()
    await expect(page.getByText('算力政策')).toBeVisible()
    await page.getByRole('button', { name: /联系园区/ }).click()
    await expect(page.getByRole('heading', { name: '留下联系方式' })).toBeVisible()
    await page.locator('input[name="email"]').fill('visitor@example.com')
    await page.locator('input[name="consent"]').check()
    await page.getByRole('button', { name: /提交联系意向/ }).click()
    await expect.poll(() => contactSubmitted).toBe(true)
    const width = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(width).toBeLessThanOrEqual(1)
  })
}

test('CAPTCHA and phone verification recover the public journey', async ({ page }) => {
  let isChallengePassed = false
  let isPhoneVerified = false
  let isContactSubmitted = false
  await page.route('**/public/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/public/consult/context') {
      await route.fulfill({
        json: {
          display_name: '测试园区',
          logo_url: null,
          welcome_text: '欢迎咨询',
          contact_enabled: true,
          published_policy_version: 'v1',
        },
      })
    } else if (path === '/public/consult/quick-questions') {
      await route.fulfill({ json: [] })
    } else if (path === '/public/consult/sessions') {
      await route.fulfill({
        status: 201,
        json: { session_id: 'test-session', expires_at: Date.now() + 86_400_000 },
      })
    } else if (path.endsWith('/messages')) {
      await route.fulfill(
        isChallengePassed
          ? {
              status: 200,
              contentType: 'text/event-stream',
              body: 'event: delta\ndata: {"text":"请参考园区政策。"}\n\nevent: sources\ndata: []\n\nevent: done\ndata: {}\n\n',
            }
          : { status: 429, json: { error: 'CAPTCHA_REQUIRED' } },
      )
    } else if (path.endsWith('/challenge')) {
      await route.fulfill({
        json: {
          image:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==',
        },
      })
    } else if (path.endsWith('/challenge/verify')) {
      isChallengePassed = true
      await route.fulfill({ json: { verified: true } })
    } else if (path.endsWith('/contact-code/verify')) {
      isPhoneVerified = true
      await route.fulfill({ json: { verified: true } })
    } else if (path.endsWith('/contact-code')) {
      await route.fulfill({ json: { sent: true, expires_in: 300 } })
    } else if (path.endsWith('/contact')) {
      isContactSubmitted = true
      await route.fulfill({ status: 201, json: { submitted: true } })
    } else {
      await route.fulfill({ status: 404, json: { error: 'NOT_FOUND' } })
    }
  })
  await page.goto('/consult')
  await page.locator('#question-input').fill('园区有哪些服务？')
  await page.getByRole('button', { name: /发送问题/ }).click()
  await expect(page.getByText('请先完成安全验证')).toBeVisible()
  await expect(page.locator('#challenge-image')).toHaveAttribute('src', /^data:image\/png;base64,/)
  await page.locator('#challenge-answer').fill('ABCDE')
  await page.getByRole('button', { name: '验证并继续' }).click()
  await expect(page.getByText('请先完成安全验证')).toBeHidden()
  await page.getByRole('button', { name: /发送问题/ }).click()
  await expect(page.getByText('请参考园区政策。')).toBeVisible()
  await page.getByRole('button', { name: /联系园区/ }).click()
  await page.locator('input[name="phone"]').fill('13812345678')
  await page.getByRole('button', { name: '发送验证码' }).click()
  await expect(page.getByText('验证码已发送，请查看短信。')).toBeVisible()
  await page.locator('#phone-code').fill('123456')
  await page.getByRole('button', { name: '核验验证码' }).click()
  await expect.poll(() => isPhoneVerified).toBe(true)
  await page.locator('input[name="consent"]').check()
  await page.getByRole('button', { name: /提交联系意向/ }).click()
  await expect.poll(() => isContactSubmitted).toBe(true)
})
