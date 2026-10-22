import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const parkUrl = `http://127.0.0.1:${process.env.PARK_E2E_PORT ?? '4176'}`
const mossUrl = `http://127.0.0.1:${process.env.PARK_E2E_MOSS_PORT ?? '4174'}`
const parkApi = `${parkUrl}/park/api/v1/parks/park-1`

async function roleContext(
  context: BrowserContext,
  role: 'leader' | 'recruiter' | 'operator',
): Promise<void> {
  const landing = {
    leader: '/park/overview',
    recruiter: '/park/leads',
    operator: '/park/admin/policies',
  }[role]
  const login = await context.newPage()
  try {
    await login.goto(`${parkUrl}/park/login`)
    await login.getByLabel('账号').fill(role)
    await login.getByLabel('密码').fill('park-test-password')
    await login.getByRole('button', { name: '进入园区管理' }).click()
    await expect(login).toHaveURL(`${parkUrl}${landing}`)
    const cookie = (await context.cookies(`${parkUrl}/park/overview`)).find(
      (item) => item.name === 'park_session',
    )
    expect(cookie?.path).toBe('/park')
    expect(
      (await context.cookies(`${parkUrl}/public/consult/context`)).some(
        (item) => item.name === 'park_session',
      ),
    ).toBe(false)
  } finally {
    await login.close()
  }
}

async function beginConsultation(page: Page): Promise<string> {
  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/public/consult/sessions' &&
      response.request().method() === 'POST',
  )
  await page.goto('/consult')
  await expect(page.locator('#park-name')).toHaveText('测试园区')
  await expect(page.locator('#question-input')).toBeVisible()
  await expect(page.locator('#contact-section')).toBeHidden()
  const quickQuestions = await page.locator('#question-chips button').count()
  expect(quickQuestions).toBeGreaterThanOrEqual(4)
  expect(quickQuestions).toBeLessThanOrEqual(8)
  expect(
    (await page.context().cookies(`${parkUrl}/park/login`)).some(
      (cookie) => cookie.name === 'park_session',
    ),
  ).toBe(false)
  return ((await (await created).json()) as { session_id: string }).session_id
}

async function askHighIntentQuestion(page: Page): Promise<void> {
  await page
    .locator('#question-input')
    .fill('我们是人工智能企业，下个月需要 200 平米场地和算力，如何入驻？')
  await page.getByRole('button', { name: /发送问题/ }).click()
  await expect(page.getByText(/算力服务可申请/)).toBeVisible()
}

test('an expired consultation session is replaced and the question is retried once', async ({
  page,
}) => {
  await beginConsultation(page)
  await page.context().addCookies([
    {
      name: 'park_session',
      value: 'stale-session',
      domain: '127.0.0.1',
      path: '/public',
    },
  ])
  const messageStatuses: number[] = []
  page.on('response', (response) => {
    if (
      new URL(response.url()).pathname.endsWith('/messages') &&
      response.request().method() === 'POST'
    ) {
      messageStatuses.push(response.status())
    }
  })
  await page
    .locator('#question-input')
    .fill('我们是人工智能企业，下个月需要 200 平米场地和算力，如何入驻？')
  await page.locator('#question-form button[type=submit]').click()
  await expect.poll(() => messageStatuses).toEqual([401, 200])
  await expect(page.getByText(/算力服务可申请/)).toBeVisible()
  const cookie = (await page.context().cookies(`${parkUrl}/public/`)).find(
    (item) => item.name === 'park_session',
  )
  expect(cookie?.value).not.toBe('stale-session')
})

test('an old cookie with a different path cannot hide the current consultation session', async ({
  page,
}) => {
  await beginConsultation(page)
  await page.context().addCookies([
    {
      name: 'park_session',
      value: 'stale-session',
      domain: '127.0.0.1',
      path: '/public/',
    },
  ])
  const messageStatuses: number[] = []
  page.on('response', (response) => {
    if (
      new URL(response.url()).pathname.endsWith('/messages') &&
      response.request().method() === 'POST'
    ) {
      messageStatuses.push(response.status())
    }
  })
  await askHighIntentQuestion(page)
  expect(messageStatuses).toEqual([200])
})

test('park login grants only park roles and keeps the session within /park', async ({
  browser,
}) => {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.goto(`${parkUrl}/park/overview`)
    await expect(page).toHaveURL(`${parkUrl}/park/login`)
    expect((await page.request.get(`${parkUrl}/park/api/v1/parks/park-1/me`)).status()).toBe(401)
    expect((await page.request.post(`${parkUrl}/park/api/auth/agent-workspace`)).status()).toBe(404)
    expect(
      (
        await page.request.post(`${parkUrl}/park/api/auth/login/password`, {
          headers: { origin: 'https://attacker.example' },
          data: { username: 'leader', password: 'park-test-password' },
        })
      ).status(),
    ).toBe(403)
    await page.getByLabel('账号').fill('visitor')
    await page.getByLabel('密码').fill('park-test-password')
    await page.getByRole('button', { name: '进入园区管理' }).click()
    await expect(page.getByRole('alert')).toContainText('没有园区管理权限')
    await expect(page).toHaveURL(`${parkUrl}/park/login`)
    expect((await page.request.get(`${parkUrl}/guid`)).status()).toBe(404)
    await page.getByLabel('账号').fill('leader')
    await page.getByLabel('密码').fill('park-test-password')
    await page.getByRole('button', { name: '进入园区管理' }).click()
    await expect(page).toHaveURL(`${parkUrl}/park/overview`)
    expect(
      (await page.request.get(`${parkUrl}/park/api/v1/parks/other-park/metrics`)).status(),
    ).toBe(403)
    expect((await page.request.get(`${parkUrl}/park/api/v1/parks/%ZZ/metrics`)).status()).toBe(400)
    expect((await page.request.get(`${parkApi}/unknown`)).status()).toBe(404)
    expect((await page.request.get(`${parkUrl}/api/auth/session`)).status()).toBe(404)
    await page.getByRole('button', { name: '退出登录' }).click()
    await expect(page).toHaveURL(`${parkUrl}/park/login`)
    expect(
      (await context.cookies(`${parkUrl}/park/overview`)).some(
        (cookie) => cookie.name === 'park_session',
      ),
    ).toBe(false)
  } finally {
    await context.close()
  }
})

test('each park role is limited to its own API operations', async ({ browser }) => {
  const cases = [
    { role: 'leader', allowed: 'metrics', denied: ['leads', 'admin/config'] },
    { role: 'recruiter', allowed: 'leads', denied: ['metrics', 'admin/config'] },
    { role: 'operator', allowed: 'admin/config', denied: ['metrics', 'leads'] },
  ] as const
  for (const item of cases) {
    const context = await browser.newContext()
    try {
      await roleContext(context, item.role)
      const page = await context.newPage()
      expect((await page.request.get(`${parkApi}/${item.allowed}`)).status()).toBe(200)
      for (const endpoint of item.denied) {
        expect((await page.request.get(`${parkApi}/${endpoint}`)).status(), endpoint).toBe(403)
      }
    } finally {
      await context.close()
    }
  }
})

test('unauthenticated and forbidden park requests reach the audit and compliance views', async ({
  browser,
  request,
}) => {
  const path = `${parkApi}/leads`
  expect((await request.get(path)).status()).toBe(401)
  expect((await request.get(`${mossUrl}/api/v1/parks/park-1/leads`)).status()).toBe(401)
  const leader = await browser.newContext()
  const operator = await browser.newContext()
  try {
    await roleContext(leader, 'leader')
    expect((await leader.request.get(path)).status()).toBe(403)
    await roleContext(operator, 'operator')
    const audit = await operator.request.get(`${parkApi}/admin/audit-events`)
    expect(audit.status()).toBe(200)
    const events = (await audit.json()) as Array<{ path: string; response_status: number }>
    expect(
      events.some(
        (event) => event.path === '/api/v1/parks/park-1/leads' && event.response_status === 401,
      ),
    ).toBe(true)
    expect(
      events.some(
        (event) => event.path === '/api/v1/parks/park-1/leads' && event.response_status === 403,
      ),
    ).toBe(true)
    const compliance = await leader.request.get(`${parkApi}/compliance/summary`)
    expect(compliance.status()).toBe(200)
    const summary = (await compliance.json()) as { audit_failures: { auth_rejections: number } }
    expect(summary.audit_failures.auth_rejections).toBeGreaterThanOrEqual(2)
  } finally {
    await leader.close()
    await operator.close()
  }
})

for (const viewport of [
  { width: 1366, height: 900 },
  { width: 375, height: 812 },
]) {
  test(`contacted visitor becomes a converted lead visible to the leader at ${viewport.width}px`, async ({
    browser,
    page,
  }) => {
    await page.setViewportSize(viewport)
    const sessionId = await beginConsultation(page)
    await askHighIntentQuestion(page)
    await page.getByRole('button', { name: /联系园区/ }).click()
    await page.locator('input[name="email"]').fill('journey@example.com')
    await page.locator('input[name="consent"]').check()
    await page.getByRole('button', { name: /提交联系意向/ }).click()
    await expect(page.getByText('联系意向已提交，园区工作人员可按所留方式与您联系。')).toBeVisible()

    const recruiterContext = await browser.newContext()
    try {
      await roleContext(recruiterContext, 'recruiter')
      const recruiter = await recruiterContext.newPage()
      let leadId = ''
      await expect
        .poll(async () => {
          const response = await recruiter.request.get(`${parkApi}/leads`)
          if (response.status() !== 200) return false
          const rows = (await response.json()) as Array<{
            id: string
            source_session_id: string
            has_contact: boolean
          }>
          const row = rows.find((item) => item.source_session_id === sessionId)
          leadId = row?.id ?? ''
          return row?.has_contact ?? false
        })
        .toBe(true)
      await recruiter.goto(`${parkUrl}/park/leads/${leadId}`)
      await expect(recruiter.getByRole('heading', { name: '线索详情' })).toBeVisible()
      await expect(recruiter.getByText('journey@example.com')).toBeVisible()
      await recruiter.getByRole('button', { name: '认领' }).click()
      await recruiter.getByRole('textbox', { name: '跟进内容' }).fill('已联系并确认入驻需求')
      await recruiter.getByRole('button', { name: '提交跟进' }).click()
      await expect(recruiter.getByText('已联系并确认入驻需求')).toBeVisible()
      await recruiter.getByRole('button', { name: '关闭线索' }).click()
      await expect
        .poll(async () => {
          const response = await recruiter.request.get(`${parkApi}/leads/${leadId}`)
          return ((await response.json()) as { status: string }).status
        })
        .toBe('converted')
    } finally {
      await recruiterContext.close()
    }

    const leaderContext = await browser.newContext()
    try {
      await roleContext(leaderContext, 'leader')
      const leader = await leaderContext.newPage()
      await leader.goto(`${parkUrl}/park/overview`)
      await expect(leader.getByRole('heading', { name: '经营总览' })).toBeVisible()
      const metrics = await leader.request.get(`${parkApi}/metrics`)
      expect(metrics.status()).toBe(200)
      const cards = (
        (await metrics.json()) as { cards: { contacted_leads: number; converted_leads: number } }
      ).cards
      expect(cards.contacted_leads).toBeGreaterThanOrEqual(1)
      expect(cards.converted_leads).toBeGreaterThanOrEqual(1)
      await leader.goto(`${parkUrl}/park/leads/summary`)
      await expect(leader.getByRole('heading', { name: '线索汇总' })).toBeVisible()
      const summary = await leader.request.get(`${parkApi}/leads/summary`)
      expect(summary.status()).toBe(200)
      expect(
        ((await summary.json()) as { distribution: { converted: number } }).distribution.converted,
      ).toBeGreaterThanOrEqual(1)
    } finally {
      await leaderContext.close()
    }
  })
}

test('high intent visitor without contact stays an anonymous potential lead', async ({
  browser,
  page,
}) => {
  const sessionId = await beginConsultation(page)
  await askHighIntentQuestion(page)
  for (const question of ['入驻条件有哪些？', '200 平米场地租金与算力支持如何申请？']) {
    const answered = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/public/sessions/${sessionId}/messages` &&
        response.request().method() === 'POST',
    )
    await page.locator('#question-input').fill(question)
    await page.getByRole('button', { name: /发送问题/ }).click()
    expect((await answered).status()).toBe(200)
    await expect(page.locator('.assistant-message').last()).not.toContainText(
      '正在查询已发布的园区资料…',
    )
  }
  const recruiterContext = await browser.newContext()
  try {
    await roleContext(recruiterContext, 'recruiter')
    const recruiter = await recruiterContext.newPage()
    await expect
      .poll(async () => {
        const response = await recruiter.request.get(`${parkApi}/leads`)
        if (response.status() !== 200) return false
        const rows = (await response.json()) as Array<{
          source_session_id: string
          has_contact: boolean
          display_name: string
        }>
        const row = rows.find((item) => item.source_session_id === sessionId)
        return row?.has_contact === false && row.display_name.includes('匿名潜在线索')
      })
      .toBe(true)
    await recruiter.goto(`${parkUrl}/park/leads`)
    await expect(recruiter.getByRole('heading', { name: '招商线索' })).toBeVisible()
    await expect(
      recruiter.getByText('匿名潜在线索（待补充联系方式/待人工观察）').first(),
    ).toBeVisible()
  } finally {
    await recruiterContext.close()
  }
})

test('phone contact follows the SMS log, verification, consent and recruiter view', async ({
  browser,
  page,
  request,
}) => {
  const sessionId = await beginConsultation(page)
  await askHighIntentQuestion(page)
  await page.getByRole('button', { name: /联系园区/ }).click()
  const phone = '13812345678'
  await page.locator('input[name="phone"]').fill(phone)
  await page.locator('input[name="consent"]').check()

  const contactPath = `/public/sessions/${sessionId}/contact`
  const unverified = await page.request.post(contactPath, { data: { phone, consent: true } })
  expect(unverified.status()).toBe(409)

  await page.getByRole('button', { name: '发送验证码' }).click()
  await expect(page.locator('#contact-challenge')).toBeVisible()
  const challengeAnswer = (await (await request.get(`${mossUrl}/__test__/captcha-answer`)).json()) as { answer: string }
  await page.locator('#contact-challenge-answer').fill(challengeAnswer.answer)
  await page.locator('#contact-challenge-submit').click()
  await expect(page.locator('#code-note')).toContainText('短信验证码已成功发送')
  const smsLogResponse = await request.get(`${mossUrl}/__test__/sms-log`)
  expect(smsLogResponse.status()).toBe(200)
  const smsLog = (await smsLogResponse.json()) as Array<{ phone: string; code: string }>
  const sent = smsLog.findLast((entry) => entry.phone === phone)
  expect(sent?.code).toMatch(/^\d{6}$/)

  await page.locator('#phone-code').fill(sent!.code === '000000' ? '999999' : '000000')
  await page.getByRole('button', { name: /提交联系意向/ }).click()
  await expect(page.getByText('短信验证码错误或已过期，请重新获取。')).toBeVisible()
  const stillUnverified = await page.request.post(contactPath, { data: { phone, consent: true } })
  expect(stillUnverified.status()).toBe(409)

  await page.locator('#phone-code').fill(sent!.code)
  await page.getByRole('button', { name: /提交联系意向/ }).click()
  await expect(page.getByText('联系意向已提交，园区工作人员可按所留方式与您联系。')).toBeVisible()

  const recruiterContext = await browser.newContext()
  try {
    await roleContext(recruiterContext, 'recruiter')
    const recruiter = await recruiterContext.newPage()
    const rowsResponse = await recruiter.request.get(`${parkApi}/leads`)
    expect(rowsResponse.status()).toBe(200)
    const rows = (await rowsResponse.json()) as Array<{ id: string; source_session_id: string }>
    const leadId = rows.find((row) => row.source_session_id === sessionId)?.id
    expect(leadId).toBeTruthy()
    const detailResponse = await recruiter.request.get(`${parkApi}/leads/${leadId}`)
    expect(detailResponse.status()).toBe(200)
    const detail = (await detailResponse.json()) as {
      contact_status: string
      contact: {
        phone: string
        phone_verified_at: number
        consent_text: string
        consent_at: number
        retention_until: number
      }
    }
    expect(detail.contact_status).toBe('verified')
    expect(detail.contact.phone).toBe(phone)
    expect(detail.contact.phone_verified_at).toBeGreaterThan(0)
    expect(detail.contact.consent_text).toBe('本园区仅为招商对接目的处理您主动提交的联系方式。')
    expect(detail.contact.consent_at).toBeGreaterThan(0)
    expect(detail.contact.retention_until).toBeGreaterThan(detail.contact.consent_at)
  } finally {
    await recruiterContext.close()
  }
})

test('all fourteen internal routes render the data for their assigned role', async ({
  browser,
  page,
}) => {
  const sessionId = await beginConsultation(page)
  await askHighIntentQuestion(page)
  const routes: Array<{
    role: 'leader' | 'recruiter' | 'operator'
    landing: string
    entries: Array<[string, string, string]>
  }> = [
    {
      role: 'leader',
      landing: '/park/overview',
      entries: [
        ['/park/overview', '经营总览', 'metrics'],
        ['/park/leads/summary', '线索汇总', 'leads/summary'],
        ['/park/reports', '领导月报', 'reports'],
        ['/park/compliance/summary', '合规概览', 'compliance/summary'],
      ],
    },
    {
      role: 'recruiter',
      landing: '/park/leads',
      entries: [
        ['/park/leads', '招商线索', 'leads'],
        ['/park/follow-ups', '我的跟进', 'follow-ups'],
      ],
    },
    {
      role: 'operator',
      landing: '/park/admin/policies',
      entries: [
        ['/park/admin/policies', '政策管理', 'admin/policy/tree'],
        ['/park/admin/content', '内容设置', 'admin/config'],
        ['/park/admin/assistant', 'Assistant 管理', 'admin/assistant'],
        ['/park/admin/public-links', '公开链接', 'admin/public-links'],
        ['/park/admin/rate-limits', '限流配置', 'admin/rate-limits'],
        ['/park/admin/audit', '审计与脱敏', 'admin/audit-events'],
        ['/park/admin/operations', '盒子运维', 'admin/operations'],
      ],
    },
  ]

  for (const group of routes) {
    const context = await browser.newContext()
    try {
      await roleContext(context, group.role)
      const internal = await context.newPage()
      for (const [path, title, endpoint] of group.entries) {
        expect((await internal.request.get(`${parkApi}/${endpoint}`)).status(), endpoint).toBe(200)
        await internal.goto(`${parkUrl}${path}`)
        await expect(
          internal.getByRole('heading', { name: title, exact: true, level: 1 }),
        ).toBeVisible()
        await expect(
          internal.getByRole('navigation', { name: '测试园区 · 园区管理' }),
        ).toBeVisible()
        await expect(internal.getByText('正在加载园区数据…')).toHaveCount(0)
        await expect(internal.getByText('数据加载失败，请稍后重试。')).toHaveCount(0)
        await expect(internal.getByText('Something Went Wrong')).toHaveCount(0)
      }
      expect((await internal.request.get(`${parkUrl}/guid`)).status()).toBe(404)
      await internal.goto(`${parkUrl}/park/settings/profile`)
      await expect(internal).toHaveURL(`${parkUrl}${group.landing}`)
      if (group.role === 'recruiter') {
        const rows = (await (await internal.request.get(`${parkApi}/leads`)).json()) as Array<{
          id: string
          source_session_id: string
        }>
        const leadId = rows.find((row) => row.source_session_id === sessionId)?.id
        expect(leadId).toBeTruthy()
        await internal.goto(`${parkUrl}/park/leads/${leadId}`)
        await expect(internal.getByRole('heading', { name: '线索详情' })).toBeVisible()
        await expect(internal.getByText('Something Went Wrong')).toHaveCount(0)
      }
    } finally {
      await context.close()
    }
  }
})

test('box operations run from the operator page and a failed upgrade rolls back', async ({
  browser,
  request,
}) => {
  const context = await browser.newContext()
  try {
    await roleContext(context, 'operator')
    const page = await context.newPage()
    page.on('dialog', (dialog) => void dialog.accept())
    await page.goto(`${parkUrl}/park/admin/operations`)
    await expect(page.getByRole('heading', { name: '盒子运维', level: 1 })).toBeVisible()
    await expect(page.getByText('park-e2e')).toBeVisible()

    const boxCalls = async () => {
      const response = await request.get(`${mossUrl}/__test__/box-log`)
      expect(response.status()).toBe(200)
      return (await response.json()) as Array<{ action: string; args: string[] }>
    }
    await page.getByRole('button', { name: '数据备份' }).click()
    await expect.poll(async () => (await boxCalls()).map((call) => call.action)).toContain('backup')

    await page.getByRole('combobox').first().selectOption('snapshot.sqlite')
    await page.getByRole('button', { name: '数据恢复' }).click()
    await expect
      .poll(async () => (await boxCalls()).map((call) => call.action))
      .toContain('restore')

    await page.getByRole('combobox').nth(1).selectOption('upgrade.tar')
    const verification = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/admin/operations/verify-upgrade'),
    )
    await page.getByRole('button', { name: '校验签名' }).click()
    expect(((await (await verification).json()) as { result: boolean }).result).toBe(true)

    const failedUpgrade = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/admin/operations/upgrade'),
    )
    await page.getByRole('button', { name: '执行升级' }).click()
    expect((await failedUpgrade).status()).toBe(500)
    await expect(page.getByText('操作失败，请检查盒子配置和日志。')).toBeVisible()
    await expect
      .poll(async () => (await boxCalls()).map((call) => call.action).slice(-2))
      .toEqual(['upgrade', 'rollback'])

    await page.getByRole('button', { name: '升级失败回滚' }).click()
    await expect
      .poll(async () => (await boxCalls()).filter((call) => call.action === 'rollback').length)
      .toBe(2)
    await page.getByRole('button', { name: '执行', exact: true }).click()
    await expect
      .poll(async () => (await boxCalls()).map((call) => call.action))
      .toContain('reindex')

    const audit = await page.request.get(`${parkApi}/admin/audit-events`)
    expect(audit.status()).toBe(200)
    const paths = ((await audit.json()) as Array<{ path: string }>).map((row) => row.path)
    for (const action of ['backup', 'restore', 'verify-upgrade', 'rollback', 'reindex']) {
      expect(paths).toContain(`/api/v1/parks/park-1/admin/operations/${action}`)
    }
  } finally {
    await context.close()
  }
})
