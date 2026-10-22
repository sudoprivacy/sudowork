import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test'

test.setTimeout(180_000)

const acceptanceFile = process.env.PARK_ACCEPTANCE_FILE
if (!acceptanceFile)
  throw new Error('PARK_ACCEPTANCE_FILE must point to the generated acceptance.json')
const acceptance = JSON.parse(readFileSync(acceptanceFile, 'utf8').replace(/^\uFEFF/, '')) as {
  orgId: string
  userPassword: string
  parkrecruiter: string
  admin: { username: string; password: string }
}
const root = dirname(acceptanceFile)
const parkUrl = process.env.PARK_ACCEPTANCE_URL ?? 'http://127.0.0.1:4176'
const mossUrl = process.env.MOSS_ACCEPTANCE_URL ?? 'http://127.0.0.1:4174'
const parkApi = `${parkUrl}/park/api/v1/parks/${encodeURIComponent(acceptance.orgId)}`
const mossDbPath = resolve(root, 'moss.db')
const smsLogPath = resolve(root, 'moss-error.log')
const modelLogPath = resolve(root, 'model-stub-calls.jsonl')

function withDb<T>(read: (db: DatabaseSync) => T, readOnly = true): T {
  const db = new DatabaseSync(mossDbPath, { readOnly })
  try {
    return read(db)
  } finally {
    db.close()
  }
}

function readSmsLog(): string {
  const bytes = readFileSync(smsLogPath)
  return bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.toString('utf16le') : bytes.toString('utf8')
}

async function login(context: BrowserContext, username: string): Promise<void> {
  const response = await context.request.post(`${parkUrl}/park/api/auth/login/password`, {
    data: { username, password: acceptance.userPassword },
  })
  expect(response.status()).toBe(200)
}

async function createPublicSession(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${parkUrl}/public/consult/sessions`, { data: {} })
  expect(response.status()).toBe(201)
  expect(response.headers()['set-cookie']).toMatch(/HttpOnly.*SameSite=Lax.*Path=\/public/)
  return ((await response.json()) as { session_id: string }).session_id
}

async function ask(request: APIRequestContext, sessionId: string, message: string) {
  const response = await request.post(`${parkUrl}/public/sessions/${sessionId}/messages`, {
    data: { message, client_request_id: randomUUID() },
  })
  expect(response.status()).toBe(200)
  const raw = await response.text()
  expect(raw).toContain('event: done')
  const answer = [...raw.matchAll(/event: delta\r?\ndata: ([^\r\n]+)/g)]
    .map((match) => (JSON.parse(match[1]!) as { text: string }).text)
    .join('')
  const sourcePayload = /event: sources\r?\ndata: ([^\r\n]+)/.exec(raw)?.[1]
  return {
    answer,
    sources: JSON.parse(sourcePayload ?? '[]') as Array<{
      name: string
      version: string
      section: string
    }>,
  }
}

test('operator builds a real policy wiki, publishes the agent, and gets a grounded streamed answer', async ({
  browser,
  request,
}) => {
  expect((await request.get(`${mossUrl}/readyz`)).status()).toBe(200)
  const operator = await browser.newContext()
  const wikiName = `验收政策库-${Date.now()}`
  try {
    const page = await operator.newPage()
    await page.goto(`${parkUrl}/park/login`)
    await page.getByLabel('账号').fill('park-operator')
    await page.getByLabel('密码').fill(acceptance.userPassword)
    await page.getByRole('button', { name: '进入园区管理' }).click()
    await expect(page).toHaveURL(`${parkUrl}/park/admin/policies`)

    const directorySection = page.getByRole('heading', { name: '政策文件目录' }).locator('..')
    const directoryName = `验收目录-${Date.now()}`
    await directorySection.getByLabel('目录名称').fill(directoryName)
    await directorySection.getByRole('button', { name: '新建' }).click()
    await directorySection.getByLabel('当前目录').selectOption({ label: directoryName })
    const upload = page.getByLabel('上传政策文件（最大 50MB）')
    await upload.setInputFiles({
      name: '入驻服务.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(
        '# 入驻服务\n\n企业可提交产业方向、需求面积和预计入驻时间。\n实际资格以园区工作人员审核为准。\n',
      ),
    })
    await upload.setInputFiles({
      name: '算力支持.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# 算力支持\n\n园区提供算力服务咨询，申请结果以审核为准。\n'),
    })
    await expect(page.locator('strong').filter({ hasText: '入驻服务.md' })).toBeVisible()
    const wikiSection = page.getByRole('heading', { name: '政策知识库' }).locator('..')
    await wikiSection.getByRole('combobox', { name: '政策知识库 Wiki' }).selectOption('')
    await wikiSection.getByLabel('入驻服务.md').check()
    await wikiSection.getByLabel('算力支持.md').check()
    await wikiSection.getByLabel('知识库名称').fill(wikiName)
    await wikiSection.getByRole('button', { name: '新建知识库' }).click()
    const wikiSelect = wikiSection.getByRole('combobox', { name: '政策知识库 Wiki' })
    await expect(wikiSelect).not.toHaveValue('')
    const wikiId = await wikiSelect.inputValue()
    await wikiSection.getByRole('button', { name: '保存来源并构建' }).click()
    await expect(wikiSection.getByText('构建成功')).toBeVisible({ timeout: 120_000 })

    await page.goto(`${parkUrl}/park/admin/assistant`)
    await page.getByLabel('发布状态').selectOption('published')
    await page.getByLabel('政策知识库 Wiki').selectOption(wikiId)
    await page.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText('已保存。')).toBeVisible()
    expect((await page.request.get(`${parkApi}/admin/policies`)).status()).toBe(404)
  } finally {
    await operator.close()
  }

  const sessionId = await createPublicSession(request)
  const result = await ask(
    request,
    sessionId,
    '我们是人工智能企业，下个月需要 200 平米场地和算力，如何入驻？',
  )
  expect(result.answer).toContain('来源：')
  expect(result.sources.length).toBeGreaterThan(0)
  const builtWiki = withDb(
    (db) =>
      db
        .prepare('SELECT storage_path, last_built_at FROM wikis WHERE org_id = ? AND name = ?')
        .get(acceptance.orgId, wikiName) as { storage_path: string; last_built_at: number },
  )
  const firstSource = result.sources[0]!
  expect(firstSource.version).toBe(`wiki-${new Date(builtWiki.last_built_at).toISOString()}`)
  const sourceLine = Number(/第 (\d+) 行/.exec(firstSource.section)?.[1] ?? 0)
  const sourcePath = resolve(builtWiki.storage_path, firstSource.name)
  expect(existsSync(sourcePath)).toBe(true)
  expect(
    readFileSync(sourcePath, 'utf8').split(/\r?\n/)[sourceLine - 1]?.trim().length,
  ).toBeGreaterThan(0)
  await expect
    .poll(() =>
      withDb((db) =>
        Number(
          (
            db
              .prepare(
                'SELECT COUNT(*) AS count FROM park_inquiries WHERE org_id = ? AND session_id = ?',
              )
              .get(acceptance.orgId, sessionId) as { count: number }
          ).count,
        ),
      ),
    )
    .toBe(1)
  await expect
    .poll(() =>
      withDb((db) =>
        Number(
          (
            db
              .prepare(
                'SELECT COUNT(*) AS count FROM park_leads WHERE org_id = ? AND source_session_id = ?',
              )
              .get(acceptance.orgId, sessionId) as { count: number }
          ).count,
        ),
      ),
    )
    .toBe(1)
  const mapping = withDb(
    (db) =>
      db
        .prepare(
          `SELECT p.moss_session_id, s.source FROM park_sessions p JOIN sessions s ON s.session_id = p.moss_session_id WHERE p.id = ?`,
        )
        .get(sessionId) as { moss_session_id: string; source: string },
  )
  expect(mapping.source).toBe('park_public_consultation')
  const labels = readFileSync(modelLogPath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line).label)
  expect(labels).toEqual(
    expect.arrayContaining(['wiki-write', 'policy-search', 'inquiry-append', 'lead-propose']),
  )
})

test('contact flow uses CAPTCHA, merges SMS verification into submission, and snapshots consent', async ({
  browser,
  request,
}) => {
  const visitor = await browser.newContext()
  try {
    const page = await visitor.newPage()
    await page.goto(`${parkUrl}/consult`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /联系园区/ }).click()
    const phone = `139${String(Date.now()).slice(-8)}`
    await page.locator('input[name=phone]').fill(phone)
    await page.locator('input[name=consent]').check()
    await page.getByRole('button', { name: '发送验证码' }).click()
    await expect(page.locator('#contact-challenge')).toBeVisible()
    await page.locator('#contact-challenge-answer').fill('ABCDE')
    await page.locator('#contact-challenge-submit').click()
    await expect(page.getByText('验证码已发送，请查看短信。')).toBeVisible()
    let code = ''
    await expect
      .poll(() => {
        code = [...readSmsLog().matchAll(/verification code for .*? is (\d{6})/g)].at(-1)?.[1] ?? ''
        return code.length
      })
      .toBe(6)
    await page.locator('#phone-code').fill(code === '000000' ? '999999' : '000000')
    await page.getByRole('button', { name: /提交联系意向/ }).click()
    await expect(page.getByText('短信验证码错误或已过期，请重新获取。')).toBeVisible()
    await page.locator('#phone-code').fill(code)
    await page.getByRole('button', { name: /提交联系意向/ }).click()
    await expect(page.getByText('联系意向已提交，园区工作人员可按所留方式与您联系。')).toBeVisible()
  } finally {
    await visitor.close()
  }

  const contact = withDb(
    (db) =>
      db
        .prepare(
          'SELECT consent_text, phone_verified_at FROM park_contacts WHERE org_id = ? AND phone IS NOT NULL ORDER BY consent_at DESC LIMIT 1',
        )
        .get(acceptance.orgId) as { consent_text: string; phone_verified_at: number },
  )
  expect(contact.consent_text).toBe('本园区仅为招商对接目的处理您主动提交的联系方式。')
  expect(contact.phone_verified_at).toBeGreaterThan(0)

  const direct = await browser.newContext()
  try {
    const sessionId = await createPublicSession(direct.request)
    const response = await direct.request.post(`${parkUrl}/public/sessions/${sessionId}/contact`, {
      data: { email: `direct-${randomUUID()}@example.com`, consent: true },
    })
    expect(response.status()).toBe(201)
    const lead = withDb(
      (db) =>
        db
          .prepare('SELECT score, source_inquiry_id FROM park_leads WHERE source_session_id = ?')
          .get(sessionId) as { score: number; source_inquiry_id: null },
    )
    expect(lead).toMatchObject({ score: 20, source_inquiry_id: null })
  } finally {
    await direct.close()
  }

  const sessionId = await createPublicSession(request)
  expect(
    (
      await request.post(`${parkUrl}/public/sessions/${sessionId}/contact-code`, {
        data: { phone: '13812345678' },
      })
    ).status(),
  ).toBe(409)
})

test('agent history, idle reclamation, automatic retry, and capacity limits work end to end', async ({
  browser,
}) => {
  const operator = await browser.newContext()
  const visitor = await browser.newContext()
  let originalRate: Record<string, unknown> | null = null
  try {
    await login(operator, 'park-operator')
    originalRate = (
      (await (await operator.request.get(`${parkApi}/admin/rate-limits`)).json()) as {
        value: Record<string, unknown>
      }
    ).value
    await operator.request.put(`${parkApi}/admin/rate-limits`, {
      data: {
        value: { ...originalRate, anonymous_session_idle_minutes: 1, anonymous_session_max: 1 },
      },
    })
    withDb((db) => {
      db.prepare('UPDATE park_sessions SET expires_at = ? WHERE org_id = ?').run(
        Date.now() - 1,
        acceptance.orgId,
      )
    }, false)

    const page = await visitor.newPage()
    await page.goto(`${parkUrl}/consult`, { waitUntil: 'networkidle' })
    await expect(page.locator('#session-reminder')).toContainText('会话将于')
    const sessionId = withDb(
      (db) =>
        (
          db
            .prepare(
              'SELECT id FROM park_sessions WHERE org_id = ? ORDER BY started_at DESC LIMIT 1',
            )
            .get(acceptance.orgId) as { id: string }
        ).id,
    )
    await page.locator('#question-input').fill('企业入驻需要什么条件？')
    await page.getByRole('button', { name: /发送问题/ }).click()
    await expect(page.locator('.assistant-message').last()).toContainText('来源：', {
      timeout: 30_000,
    })
    await page.locator('#question-input').fill('那场地和算力呢？')
    await page.getByRole('button', { name: /发送问题/ }).click()
    await expect(page.locator('.assistant-message').last()).toContainText('来源：', {
      timeout: 30_000,
    })
    await expect
      .poll(() =>
        withDb((db) =>
          Number(
            (
              db
                .prepare('SELECT COUNT(*) AS count FROM park_inquiries WHERE session_id = ?')
                .get(sessionId) as { count: number }
            ).count,
          ),
        ),
      )
      .toBe(2)

    const blocked = await browser.newContext()
    try {
      const blockedPage = await blocked.newPage()
      await blockedPage.goto(`${parkUrl}/consult`, { waitUntil: 'networkidle' })
      await blockedPage.locator('#question-input').fill('capacity probe')
      await blockedPage.getByRole('button', { name: /\u53d1\u9001\u95ee\u9898/ }).click()
      await expect(blockedPage.getByText('\u5f53\u524d\u54a8\u8be2\u4eba\u6570\u8f83\u591a\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002')).toBeVisible()
      await expect(blockedPage.locator('#question-input')).toHaveValue('capacity probe')
      await expect(blockedPage.getByRole('button', { name: /\u53d1\u9001\u95ee\u9898/ })).toBeDisabled()
    } finally {
      await blocked.close()
    }

    withDb((db) => {
      db.prepare('UPDATE park_sessions SET last_active_at = ? WHERE id = ?').run(
        Date.now() - 120_000,
        sessionId,
      )
    }, false)
    await expect
      .poll(
        () =>
          withDb(
            (db) =>
              (
                db.prepare('SELECT expires_at FROM park_sessions WHERE id = ?').get(sessionId) as {
                  expires_at: number
                }
              ).expires_at,
          ) <= Date.now(),
        { timeout: 40_000 },
      )
      .toBe(true)
    await expect
      .poll(() =>
        withDb(
          (db) =>
            (
              db
                .prepare(
                  'SELECT status FROM sessions WHERE session_id = (SELECT moss_session_id FROM park_sessions WHERE id = ?)',
                )
                .get(sessionId) as { status: string }
            ).status,
        ),
      )
      .toBe('terminated')
    await page.locator('#question-input').fill('请继续说明入驻流程。')
    await page.getByRole('button', { name: /发送问题/ }).click()
    await expect(page.getByText('\u54a8\u8be2\u4f1a\u8bdd\u5df2\u66f4\u65b0\uff0c\u8bf7\u786e\u8ba4\u540e\u518d\u6b21\u63d0\u4ea4\u3002')).toBeVisible()
    await page.getByRole('button', { name: /\u53d1\u9001\u95ee\u9898/ }).click()
    await expect(page.locator('.assistant-message').last()).toContainText('来源：', {
      timeout: 30_000,
    })
  } finally {
    if (originalRate)
      await operator.request.put(`${parkApi}/admin/rate-limits`, { data: { value: originalRate } })
    await Promise.all([operator.close(), visitor.close()])
  }
})

test('all three park roles retain their assigned pages and API boundaries', async ({ browser }) => {
  const groups = [
    {
      user: 'park-leader',
      landing: '/park/overview',
      allowed: '/metrics',
      forbidden: '/leads',
      heading: '经营总览',
    },
    {
      user: 'park-recruiter',
      landing: '/park/leads',
      allowed: '/leads',
      forbidden: '/admin/config',
      heading: '招商线索',
    },
    {
      user: 'park-operator',
      landing: '/park/admin/policies',
      allowed: '/admin/policy/tree',
      forbidden: '/metrics',
      heading: '政策管理',
    },
  ] as const
  for (const group of groups) {
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      await page.goto(`${parkUrl}/park/login`)
      await page.getByLabel('账号').fill(group.user)
      await page.getByLabel('密码').fill(acceptance.userPassword)
      await page.getByRole('button', { name: '进入园区管理' }).click()
      await expect(page).toHaveURL(`${parkUrl}${group.landing}`)
      expect((await context.request.get(`${parkApi}${group.allowed}`)).status()).toBe(200)
      expect((await context.request.get(`${parkApi}${group.forbidden}`)).status()).toBe(403)
      await page.goto(`${parkUrl}${group.landing}`, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: group.heading, level: 1 })).toBeVisible()
      await expect(page.getByText('Something Went Wrong')).toHaveCount(0)
    } finally {
      await context.close()
    }
  }
  expect(existsSync(mossDbPath)).toBe(true)
})
