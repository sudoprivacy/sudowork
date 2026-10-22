import { expect, test, type Page, type Route } from '@playwright/test'

const context = {
  display_name: '测试园区',
  logo_url: null,
  welcome_text: '欢迎咨询',
  contact_enabled: true,
  published_policy_version: 'wiki-test',
  consent_text: '本园区仅为招商对接目的处理您主动提交的联系方式。',
}

async function commonPublicRoute(route: Route, options: {
  onMessage?: (route: Route) => Promise<void>
  onContact?: (route: Route) => Promise<void>
  status?: { closing_at: number | null; closed: boolean }
} = {}): Promise<void> {
  const path = new URL(route.request().url()).pathname
  const method = route.request().method()
  if (path === '/public/consult/context') await route.fulfill({ json: context })
  else if (path === '/public/consult/quick-questions') await route.fulfill({ json: [{ id: 'q1', question: '有哪些算力支持？', sort_order: 1 }] })
  else if (path === '/public/consult/session') await route.fulfill({ json: { session_id: 'test-session', expires_at: Date.now() + 86_400_000 } })
  else if (path === '/public/consult/sessions') await route.fulfill({ status: 201, json: { session_id: 'test-session', expires_at: Date.now() + 86_400_000 } })
  else if (path.endsWith('/status')) await route.fulfill({ json: options.status ?? { closing_at: Date.now() + 30 * 60_000, closed: false } })
  else if (path.endsWith('/messages') && method === 'GET') await route.fulfill({ json: [] })
  else if (path.endsWith('/messages') && options.onMessage) await options.onMessage(route)
  else if (path.endsWith('/contact') && options.onContact) await options.onContact(route)
  else await route.fulfill({ status: 404, json: { error: 'NOT_FOUND' } })
}

async function openContact(page: Page): Promise<void> {
  await page.getByRole('button', { name: /联系园区/ }).click()
  await expect(page.getByRole('heading', { name: '留下联系方式' })).toBeVisible()
}

test('the consultation composer sends with Enter and only enables for a question', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined }))
  const sent: string[] = []
  await page.route('**/public/**', (route) => commonPublicRoute(route, {
    onMessage: async (messageRoute) => {
      expect(messageRoute.request().postDataJSON().client_request_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
      sent.push((messageRoute.request().postDataJSON() as { message: string }).message)
      await messageRoute.fulfill({ contentType: 'text/event-stream', body: 'event: delta\ndata: {"text":"已收到"}\n\nevent: done\ndata: {}\n\n' })
    },
  }))
  await page.goto('/consult')
  const input = page.locator('#question-input')
  const send = page.getByRole('button', { name: /发送问题/ })
  await expect(send).toBeDisabled()
  await input.fill('第一行')
  await expect(send).toBeEnabled()
  await input.press('Shift+Enter')
  await input.pressSequentially('第二行')
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 })
  expect(sent).toHaveLength(0)
  await input.press('Enter')
  await expect.poll(() => sent).toEqual(['第一行\n第二行'])
})

for (const viewport of [{ width: 1366, height: 900 }, { width: 375, height: 812 }]) {
  test(`consultation and direct contact work at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    let contactBody: Record<string, unknown> | undefined
    await page.route('**/public/**', (route) => commonPublicRoute(route, {
      onMessage: async (messageRoute) => messageRoute.fulfill({
        contentType: 'text/event-stream',
        body: 'event: delta\ndata: {"text":"算力服务可申请，具体以园区确认为准。"}\n\nevent: sources\ndata: [{"name":"算力政策.md","version":"wiki-test","section":"第 1 行"}]\n\nevent: done\ndata: {}\n\n',
      }),
      onContact: async (contactRoute) => {
        contactBody = contactRoute.request().postDataJSON() as Record<string, unknown>
        await contactRoute.fulfill({ status: 201, json: { submitted: true } })
      },
    }))
    await page.goto('/consult')
    await openContact(page)
    await expect(page.getByText(/先咨询您关心的问题/)).toBeVisible()
    await expect(page.getByText('P1', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '核验验证码' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /提交联系意向/ })).toBeDisabled()
    await page.getByRole('button', { name: '查看声明全文' }).click()
    await expect(page.getByText(context.consent_text, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '关闭联系表单' }).last().click()
    await page.locator('input[name="email"]').fill('visitor@example.com')
    await page.locator('input[name="consent"]').check()
    await page.getByRole('button', { name: /提交联系意向/ }).click()
    await expect.poll(() => contactBody).toMatchObject({ email: 'visitor@example.com', sms_code: '' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  })
}

test('phone contact requires CAPTCHA and verifies the SMS code during submission', async ({ page }) => {
  let isChallengePassed = false
  let sendAttempts = 0
  let contactBody: Record<string, unknown> | undefined
  await page.route('**/public/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/challenge') && route.request().method() === 'GET') {
      await route.fulfill({ json: { image: 'data:image/png;base64,iVBORw0KGgo=' } })
    } else if (path.endsWith('/challenge/verify')) {
      isChallengePassed = true
      await route.fulfill({ json: { verified: true } })
    } else if (path.endsWith('/contact-code')) {
      sendAttempts += 1
      await route.fulfill(isChallengePassed ? { json: { sent: true, expires_in: 300 } } : { status: 409, json: { error: 'CAPTCHA_REQUIRED' } })
    } else {
      await commonPublicRoute(route, {
        onContact: async (contactRoute) => {
          contactBody = contactRoute.request().postDataJSON() as Record<string, unknown>
          await contactRoute.fulfill({ status: 201, json: { submitted: true } })
        },
      })
    }
  })
  await page.goto('/consult')
  await openContact(page)
  await page.locator('input[name="phone"]').fill('13812345678')
  await page.getByRole('button', { name: '发送验证码' }).click()
  await expect(page.locator('#contact-challenge')).toBeVisible()
  await page.locator('#contact-challenge-answer').fill('ABCDE')
  await page.locator('#contact-challenge-submit').click()
  await expect(page.getByText('短信验证码已成功发送，60 秒后可重新发送。')).toBeVisible()
  expect(sendAttempts).toBe(1)
  await expect(page.locator('#send-code')).toBeDisabled()
  await page.locator('#phone-code').fill('123456')
  await page.locator('input[name="consent"]').check()
  await page.getByRole('button', { name: /提交联系意向/ }).click()
  await expect.poll(() => contactBody).toMatchObject({ phone: '13812345678', sms_code: '123456' })
})

test('contact CAPTCHA can reopen after every close and recover from failed verification', async ({ page }) => {
  let images = 0
  let sends = 0
  await page.route('**/public/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/challenge')) {
      expect(new URL(route.request().url()).searchParams.get('purpose')).toBe('contact')
      images++
      await route.fulfill({ json: { image: 'data:image/png;base64,iVBORw0KGgo=' } })
    } else if (path.endsWith('/challenge/verify')) {
      await route.fulfill({ status: 400, json: { error: 'Invalid challenge answer' } })
    } else if (path.endsWith('/contact-code')) {
      sends++
      await route.fulfill({ json: { sent: true } })
    } else await commonPublicRoute(route)
  })
  await page.goto('/consult')
  await openContact(page)
  await page.locator('input[name="phone"]').fill('13812345678')
  for (const close of ['button', 'escape', 'backdrop']) {
    await page.locator('#send-code').click()
    await expect(page.locator('#contact-challenge-answer')).toBeEnabled()
    if (close === 'button') await page.locator('#close-contact-challenge').click()
    else if (close === 'escape') await page.keyboard.press('Escape')
    else await page.locator('#contact-challenge').click({ position: { x: 2, y: 2 } })
    await expect(page.locator('#contact-challenge')).not.toBeVisible()
  }
  await page.locator('#send-code').click()
  await page.locator('#contact-challenge-answer').fill('ZZZZZ')
  await page.locator('#contact-challenge-submit').click()
  await expect(page.locator('#contact-challenge-note')).toHaveText('验证失败，请重试。')
  await expect(page.locator('#contact-challenge-answer')).toBeEnabled()
  await page.locator('#close-contact-challenge').click()
  await page.locator('#send-code').click()
  await expect(page.locator('#contact-challenge-answer')).toBeEnabled()
  await page.locator('#contact-challenge-answer').fill('ZZZZZ')
  await page.locator('#contact-challenge-submit').click()
  await expect(page.locator('#contact-challenge-note')).toHaveText('验证失败，请重试。')
  await page.locator('#contact-challenge-retry').click()
  await expect(page.locator('#contact-challenge-answer')).toBeEnabled()
  expect(images).toBe(6)
  expect(sends).toBe(0)
})

test('SMS cooldown survives form reopening and phone changes and ends after 60 seconds', async ({ page }) => {
  await page.clock.install()
  let images = 0
  let sends = 0
  await page.route('**/public/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/challenge')) {
      images++
      await route.fulfill({ json: { image: 'data:image/png;base64,iVBORw0KGgo=' } })
    } else if (path.endsWith('/challenge/verify')) await route.fulfill({ json: { verified: true } })
    else if (path.endsWith('/contact-code')) {
      sends++
      await route.fulfill({ json: { sent: true } })
    } else await commonPublicRoute(route)
  })
  await page.goto('/consult')
  await openContact(page)
  await page.locator('input[name="phone"]').fill('13812345678')
  await page.locator('#send-code').click()
  await page.locator('#contact-challenge-answer').fill('ABCDE')
  await page.locator('#contact-challenge-submit').click()
  await expect(page.locator('#code-note')).toContainText('短信验证码已成功发送')
  await expect(page.locator('#send-code')).toBeDisabled()
  await page.locator('#close-contact').click()
  await openContact(page)
  await page.locator('input[name="phone"]').fill('13912345678')
  await page.clock.runFor(59_000)
  await expect(page.locator('#send-code')).toBeDisabled()
  expect(sends).toBe(1)
  await page.clock.runFor(1000)
  await expect(page.locator('#send-code')).toBeEnabled()
  await expect(page.locator('#send-code')).toHaveText('发送验证码')
  await page.locator('#send-code').click()
  await expect(page.locator('#contact-challenge-answer')).toBeEnabled()
  expect(images).toBe(2)
  expect(sends).toBe(1)
})

test('contact image errors and rate limits remain visible and recover on retry', async ({ page }) => {
  await page.clock.install()
  let images = 0
  await page.route('**/public/**', async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/challenge')) {
      images++
      if (images === 1) await route.fulfill({ status: 503, json: { error: 'UNAVAILABLE' } })
      else if (images === 2) await route.fulfill({ status: 429, headers: { 'Retry-After': '2' }, json: { error: 'RATE_LIMITED' } })
      else await route.fulfill({ json: { image: 'data:image/png;base64,iVBORw0KGgo=' } })
    } else await commonPublicRoute(route)
  })
  await page.goto('/consult')
  await openContact(page)
  await page.locator('input[name="phone"]').fill('13812345678')
  await page.locator('#send-code').click()
  await expect(page.locator('#contact-challenge-note')).toHaveText('图形验证码加载失败，请重试。')
  await page.locator('#contact-challenge-retry').click()
  await expect(page.locator('#contact-challenge-retry')).toBeDisabled()
  await page.locator('#close-contact-challenge').click()
  await page.locator('#send-code').click()
  await expect(page.locator('#contact-challenge')).toBeVisible()
  await expect(page.locator('#contact-challenge-note')).toContainText('秒后重试')
  await page.clock.runFor(2000)
  await page.locator('#contact-challenge-retry').click()
  await expect(page.locator('#contact-challenge-answer')).toBeEnabled()
  expect(images).toBe(3)
})

test('late verification cannot send SMS after cancellation, and failed SMS allows retry', async ({ page }) => {
  let verifyRoute: Route | undefined
  let sends = 0
  let isDelayed = true
  await page.route('**/public/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/challenge')) await route.fulfill({ json: { image: 'data:image/png;base64,iVBORw0KGgo=' } })
    else if (path.endsWith('/challenge/verify')) {
      if (isDelayed) verifyRoute = route
      else await route.fulfill({ json: { verified: true } })
    } else if (path.endsWith('/contact-code')) {
      sends++
      await route.fulfill({ status: 502, json: { error: 'SMS_UNAVAILABLE' } })
    } else await commonPublicRoute(route)
  })
  await page.goto('/consult')
  await openContact(page)
  await page.locator('input[name="phone"]').fill('13812345678')
  await page.locator('#send-code').click()
  await page.locator('#contact-challenge-answer').fill('ABCDE')
  await page.locator('#contact-challenge-submit').click()
  await expect.poll(() => Boolean(verifyRoute)).toBe(true)
  await expect(page.locator('#contact-challenge-submit')).toBeDisabled()
  await page.locator('#close-contact-challenge').click()
  await verifyRoute!.fulfill({ json: { verified: true } })
  isDelayed = false
  await page.locator('#send-code').click()
  await page.locator('#contact-challenge-answer').fill('ABCDE')
  await page.locator('#contact-challenge-submit').click()
  await expect(page.locator('#code-note')).toHaveText('短信服务暂不可用，请稍后再试。')
  await expect(page.locator('#send-code')).toBeEnabled()
  expect(sends).toBe(1)
})

test('late image and verification responses cannot resume a cancelled or changed phone operation', async ({ page }) => {
  let imageRoute: Route | undefined
  let verifyRoute: Route | undefined
  let images = 0
  let sends = 0
  await page.route('**/public/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/challenge')) {
      if (++images === 1) imageRoute = route
      else await route.fulfill({ json: { image: 'data:image/png;base64,iVBORw0KGgo=' } })
    } else if (path.endsWith('/challenge/verify')) verifyRoute = route
    else if (path.endsWith('/contact-code')) {
      sends++
      await route.fulfill({ json: { sent: true } })
    } else await commonPublicRoute(route)
  })
  await page.goto('/consult')
  await openContact(page)
  await page.locator('input[name="phone"]').fill('13812345678')
  await page.locator('#send-code').click()
  await expect.poll(() => Boolean(imageRoute)).toBe(true)
  await page.locator('#close-contact-challenge').click()
  await imageRoute!.fulfill({ json: { image: 'data:image/png;base64,iVBORw0KGgo=' } })
  await expect(page.locator('#contact-challenge')).not.toBeVisible()
  await page.locator('#send-code').click()
  await page.locator('#contact-challenge-answer').fill('ABCDE')
  await page.locator('#contact-challenge-submit').click()
  await expect.poll(() => Boolean(verifyRoute)).toBe(true)
  // Simulate a phone input change while the modal verification is pending.
  await page.locator('input[name="phone"]').evaluate((element: HTMLInputElement) => {
    element.value = '13912345678'
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await verifyRoute!.fulfill({ json: { verified: true } })
  await expect(page.locator('#contact-challenge')).not.toBeVisible()
  await expect(page.locator('#send-code')).toBeEnabled()
  expect(sends).toBe(0)
})

test('stable errors, lifecycle warning and closed-session retry are visible', async ({ page }) => {
  let sessionCount = 0
  let messageCount = 0
  await page.route('**/public/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    if (path === '/public/consult/sessions') {
      sessionCount += 1
      await route.fulfill({ status: 201, json: { session_id: `session-${sessionCount}` } })
    } else if (path === '/public/consult/session') {
      await route.fulfill({ json: { session_id: `session-${sessionCount}` } })
    } else if (path.endsWith('/status')) {
      await route.fulfill({ json: { closing_at: Date.now() + 3 * 60_000, closed: false } })
    } else if (path.endsWith('/messages') && method === 'POST') {
      messageCount += 1
      await route.fulfill(messageCount === 1 ? { status: 401, json: { error: 'Session expired' } } : { contentType: 'text/event-stream', body: 'event: delta\ndata: {"text":"新会话回答"}\n\nevent: done\ndata: {}\n\n' })
    } else if (path.endsWith('/contact')) {
      await route.fulfill({ status: 409, json: { error: 'PHONE_CODE_INVALID' } })
    } else await commonPublicRoute(route)
  })
  await page.goto('/consult')
  await expect(page.locator('#session-reminder')).toContainText('2:')
  await page.locator('#question-input').fill('继续咨询')
  await page.getByRole('button', { name: /发送问题/ }).click()
  await expect(page.getByText(/本次咨询会话已结束/)).toBeVisible()
  await expect(page.locator('#question-input')).toHaveValue('\u7ee7\u7eed\u54a8\u8be2')
  await page.getByRole('button', { name: /\u53d1\u9001\u95ee\u9898/ }).click()
  await expect(page.getByText('\u65b0\u4f1a\u8bdd\u56de\u7b54')).toBeVisible()
  expect(sessionCount).toBe(1)
  await openContact(page)
  await page.locator('input[name="phone"]').fill('13812345678')
  await page.locator('#phone-code').fill('000000')
  await page.locator('input[name="consent"]').check()
  await page.getByRole('button', { name: /提交联系意向/ }).click()
  await expect(page.getByText('短信验证码错误或已过期，请重新获取。')).toBeVisible()
})

test('capacity refusal retains the question and allows retry after the server cooldown', async ({ page }) => {
  let attempts = 0
  await page.route('**/public/**', (route) => commonPublicRoute(route, {
    onMessage: async (messageRoute) => {
      attempts++
      await messageRoute.fulfill(attempts === 1
        ? { status: 503, headers: { 'Retry-After': '1' }, json: { error: 'SESSION_CAPACITY_REACHED' } }
        : { contentType: 'text/event-stream', body: 'event: delta\ndata: {"text":"retry succeeded"}\n\nevent: done\ndata: {}\n\n' })
    },
  }))
  await page.goto('/consult')
  await page.locator('#question-input').fill('question')
  const send = page.getByRole('button', { name: /\u53d1\u9001\u95ee\u9898/ })
  await send.click()
  await expect(page.getByText('\u5f53\u524d\u54a8\u8be2\u4eba\u6570\u8f83\u591a\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002')).toBeVisible()
  await expect(page.locator('#question-input')).toHaveValue('question')
  await expect(send).toBeDisabled()
  await expect(send).toBeEnabled()
  await send.click()
  await expect(page.getByText('retry succeeded')).toBeVisible()
  expect(attempts).toBe(2)
})

test('refresh restores history and a cookie identity change preserves the draft without sending', async ({ page }) => {
  let identity = 'test-session'
  let sent = 0
  await page.route('**/public/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/public/consult/session') await route.fulfill({ json: { session_id: identity } })
    else if (path.endsWith('/messages') && route.request().method() === 'GET') {
      await route.fulfill({ json: [{ redacted_question: 'historical question', redacted_answer: 'historical answer', source_refs: [] }] })
    } else await commonPublicRoute(route, { onMessage: async messageRoute => { sent++; await messageRoute.fulfill({ status: 500 }) } })
  })
  await page.goto('/consult')
  await expect(page.getByText('historical answer')).toBeVisible()
  await page.reload()
  await expect(page.getByText('historical answer')).toHaveCount(1)
  await page.locator('#question-input').fill('unsent draft')
  identity = 'another-session'
  await page.getByRole('button', { name: /\u53d1\u9001\u95ee\u9898/ }).click()
  await expect(page.getByText('\u54a8\u8be2\u4f1a\u8bdd\u5df2\u66f4\u65b0\uff0c\u8bf7\u786e\u8ba4\u540e\u518d\u6b21\u63d0\u4ea4\u3002')).toBeVisible()
  await expect(page.locator('#question-input')).toHaveValue('unsent draft')
  expect(sent).toBe(0)
})

test('answer concurrency refusal retains the draft and observes retry timing', async ({ page }) => {
  await page.route('**/public/**', route => commonPublicRoute(route, {
    onMessage: async messageRoute => messageRoute.fulfill({ status: 429, headers: { 'Retry-After': '1' }, json: { error: 'concurrent_limit' } }),
  }))
  await page.goto('/consult')
  await page.locator('#question-input').fill('concurrent question')
  const send = page.locator('#question-form button[type="submit"]')
  await send.click()
  await expect(page.locator('#question-input')).toHaveValue('concurrent question')
  await expect(send).toBeDisabled()
  await expect(send).toBeEnabled()
})

test('out of order identity reads cannot send an old draft into the new session', async ({ page }) => {
  let firstRead: Route | undefined
  let reads = 0
  let sent = 0
  await page.route('**/public/**', async route => {
    if (new URL(route.request().url()).pathname === '/public/consult/session') {
      reads++
      if (reads === 1) { firstRead = route; return }
      await route.fulfill({ json: { session_id: 'replacement' } })
    } else await commonPublicRoute(route, {
      onMessage: async messageRoute => { sent++; await messageRoute.fulfill({ status: 500 }) },
    })
  })
  await page.goto('/consult')
  await page.locator('#question-input').fill('original session draft')
  await page.locator('#question-form button[type="submit"]').click()
  await expect.poll(() => Boolean(firstRead)).toBe(true)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(() => reads).toBe(2)
  await expect(page.locator('.system-message')).toBeVisible()
  await firstRead!.fulfill({ json: { session_id: 'test-session' } })
  await expect(page.locator('#question-input')).toHaveValue('original session draft')
  await expect(page.locator('#question-form button[type="submit"]')).toBeEnabled()
  expect(sent).toBe(0)
})
