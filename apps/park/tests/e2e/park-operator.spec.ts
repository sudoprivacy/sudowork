import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

const parkUrl = `http://127.0.0.1:${process.env.PARK_E2E_PORT ?? '4176'}`
const parkApi = `${parkUrl}/park/api/v1/parks/park-1`

test('operator manages policy files and builds a wiki', async ({ browser }) => {
  const operator = await browser.newContext()
  try {
    const admin = await operator.newPage()
    await admin.goto(`${parkUrl}/park/login`)
    await admin.getByLabel('账号').fill('operator')
    await admin.getByLabel('密码').fill('park-test-password')
    await admin.getByRole('button', { name: '进入园区管理' }).click()
    await expect(admin).toHaveURL(`${parkUrl}/park/admin/policies`)
    await expect(admin.getByRole('heading', { name: '政策文件目录' })).toBeVisible()
    await expect(admin.getByRole('heading', { name: '上传新版本' })).toHaveCount(0)

    const directory = `浏览器政策-${Date.now()}`
    const directorySection = admin.getByRole('heading', { name: '政策文件目录' }).locator('..')
    await directorySection.getByLabel('目录名称').fill(directory)
    await directorySection.getByRole('button', { name: '新建' }).click()
    await directorySection.getByLabel('当前目录').selectOption({ label: directory })

    const fileName = '浏览器算力政策.md'
    await admin.getByLabel(/^上传政策文件/).setInputFiles({
      name: fileName,
      mimeType: 'text/markdown',
      buffer: Buffer.from('# 算力政策\n企业可申请浏览器校验服务。'),
    })
    await expect(admin.locator('strong').filter({ hasText: fileName })).toBeVisible()

    const wikiSection = admin.getByRole('heading', { name: '政策知识库' }).locator('..')
    await wikiSection.getByRole('combobox', { name: '政策知识库 Wiki' }).selectOption('')
    await wikiSection.getByLabel(fileName).check()
    await wikiSection.getByLabel('知识库名称').fill('浏览器政策知识库')
    await wikiSection.getByRole('button', { name: '新建知识库' }).click()
    await expect(wikiSection.getByRole('combobox', { name: '政策知识库 Wiki' })).toHaveValue(/.+/)
    await wikiSection.getByRole('button', { name: '保存来源并构建' }).click()
    await expect(wikiSection.getByText('构建成功')).toBeVisible({ timeout: 10_000 })

    expect((await admin.request.get(`${parkApi}/admin/policies`)).status()).toBe(404)
  } finally {
    await operator.close()
  }
})

test('content settings update the configured park name in the console', async ({ browser }) => {
  const operator = await browser.newContext()
  const admin = await operator.newPage()
  let original: {
    display_name: string
    logo_url: string | null
    welcome_text: string
    park_profile: string
    service_catalog: string
    service_catalog_version: string
    contact_enabled: number
    consent_text: string
  } | null = null
  try {
    await admin.goto(`${parkUrl}/park/login`)
    await expect(admin).toHaveTitle('测试园区')
    await admin.getByLabel('账号').fill('operator')
    await admin.getByLabel('密码').fill('park-test-password')
    await admin.getByRole('button', { name: '进入园区管理' }).click()
    await expect(admin).toHaveURL(`${parkUrl}/park/admin/policies`)
    original = (await (
      await admin.request.get(`${parkApi}/admin/config`)
    ).json()) as typeof original
    await expect(
      admin.getByRole('navigation', { name: `${original!.display_name} · 园区管理` }),
    ).toBeVisible()

    await expect(admin).toHaveTitle(original!.display_name)
    await admin.goto(`${parkUrl}/park/admin/content`)
    const questionsPanel = admin.getByRole('heading', { name: '快捷问题配置' }).locator('..')
    await expect(questionsPanel.getByRole('heading', { name: '新建', exact: true })).toBeVisible()
    await expect(admin.locator('aside').getByText('园', { exact: true })).toHaveCount(0)
    const section = admin.getByRole('heading', { name: '园区简介 / 服务目录' }).locator('..')
    await section.getByLabel('园区名称').fill('更新后的测试园区')
    await section.getByLabel('联系方式处理声明').fill('浏览器更新后的联系方式处理声明。')
    await section.getByRole('button', { name: '保存' }).click()
    await expect(
      admin.getByRole('navigation', { name: '更新后的测试园区 · 园区管理' }),
    ).toBeVisible()
    await expect(admin).toHaveTitle('更新后的测试园区')
    await admin.reload()
    await expect(admin).toHaveTitle('更新后的测试园区')
    const publicContext = await admin.request.get(`${parkUrl}/public/consult/context`)
    expect(((await publicContext.json()) as { display_name: string }).display_name).toBe(
      '更新后的测试园区',
    )
    expect(((await (await admin.request.get(`${parkUrl}/public/consult/context`)).json()) as { consent_text: string }).consent_text).toBe('浏览器更新后的联系方式处理声明。')
  } finally {
    if (original) {
      await admin.request.put(`${parkApi}/admin/config`, {
        data: {
          display_name: original.display_name,
          logo_url: original.logo_url,
          welcome_text: original.welcome_text,
          park_profile: original.park_profile,
          service_catalog: JSON.parse(original.service_catalog),
          service_catalog_version: original.service_catalog_version,
          contact_enabled: Boolean(original.contact_enabled),
          consent_text: original.consent_text,
        },
      })
    }
    await operator.close()
  }
})

test('console content scrolls independently of its menu at desktop and mobile sizes', async ({ page }) => {
  await page.goto(`${parkUrl}/park/login`)
  await page.getByLabel('账号').fill('operator')
  await page.getByLabel('密码').fill('park-test-password')
  await page.getByRole('button', { name: '进入园区管理' }).click()
  await page.goto(`${parkUrl}/park/admin/content`)
  await expect(page.getByRole('heading', { name: '快捷问题配置' })).toBeVisible()
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1366, height: 400 },
    { width: 900, height: 768 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport)
    const sidebar = page.locator('aside')
    const initial = await sidebar.boundingBox()
    await page.locator('main').evaluate((element) => { element.scrollTop = 600 })
    await expect.poll(() => page.locator('main').evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    expect((await sidebar.boundingBox())!.y).toBe(initial!.y)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    if (viewport.height === 400) {
      await sidebar.evaluate((element) => { element.scrollTop = 50 })
      expect(await sidebar.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    }
  }
})

test('merged quick-question panel preserves create, edit, cancel and delete', async ({ page }) => {
  await page.goto(`${parkUrl}/park/login`)
  await page.getByLabel('账号').fill('operator')
  await page.getByLabel('密码').fill('park-test-password')
  await page.getByRole('button', { name: '进入园区管理' }).click()
  await page.goto(`${parkUrl}/park/admin/content`)
  const panel = page.getByRole('heading', { name: '快捷问题配置' }).locator('..')
  const question = `浏览器快捷问题-${Date.now()}`
  await panel.getByLabel('问题', { exact: true }).fill(question)
  await panel.getByLabel('排序').fill('20')
  await panel.getByLabel('启用', { exact: true }).uncheck()
  await panel.getByRole('button', { name: '保存', exact: true }).click()
  const item = panel.locator('[class*="listItem"]').filter({ hasText: question })
  await expect(item.getByText('停用', { exact: true })).toBeVisible()
  await item.getByRole('button', { name: '编辑', exact: true }).click()
  await expect(panel.getByLabel('问题', { exact: true })).toHaveValue(question)
  await panel.getByRole('button', { name: '取消', exact: true }).click()
  await expect(panel.getByLabel('问题', { exact: true })).toHaveValue('')
  await item.getByRole('button', { name: '编辑', exact: true }).click()
  await panel.getByLabel('排序').fill('21')
  await panel.getByLabel('启用', { exact: true }).check()
  await panel.getByRole('button', { name: '保存', exact: true }).click()
  await expect(item.getByText('启用', { exact: true })).toBeVisible()
  await expect(item).toContainText('排序 21')
  await item.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(item).toHaveCount(0)
})

for (const [role, landing] of [['leader', '/park/overview'], ['recruiter', '/park/leads']] as const) {
  test(`${role} console uses the configured park title`, async ({ page }) => {
    await page.goto(`${parkUrl}/park/login`)
    await expect(page).toHaveTitle('测试园区')
    await page.getByLabel('账号').fill(role)
    await page.getByLabel('密码').fill('park-test-password')
    await page.getByRole('button', { name: '进入园区管理' }).click()
    await expect(page).toHaveURL(`${parkUrl}${landing}`)
    await expect(page).toHaveTitle('测试园区')
  })
}

test('login title falls back to the generic name when public context fails', async ({ page }) => {
  await page.route('**/public/consult/context', (route) => route.fulfill({ status: 503, json: { error: 'UNAVAILABLE' } }))
  await page.goto(`${parkUrl}/park/login`)
  await expect(page).toHaveTitle('园区管理')
})

test('operator rate and redaction settings govern persisted public inquiries', async ({
  browser,
}) => {
  const operator = await browser.newContext()
  const publicVisitor = await browser.newContext()
  let rateBefore: { value: Record<string, unknown> } | undefined
  let redactionBefore: { value: Record<string, unknown> } | undefined
  try {
    const admin = await operator.newPage()
    await admin.goto(`${parkUrl}/park/login`)
    await admin.getByLabel('账号').fill('operator')
    await admin.getByLabel('密码').fill('park-test-password')
    await admin.getByRole('button', { name: '进入园区管理' }).click()
    await expect(admin).toHaveURL(`${parkUrl}/park/admin/policies`)
    rateBefore = (await (await admin.request.get(`${parkApi}/admin/rate-limits`)).json()) as {
      value: Record<string, unknown>
    }
    redactionBefore = (await (await admin.request.get(`${parkApi}/admin/redaction`)).json()) as {
      value: Record<string, unknown>
    }

    await admin.goto(`${parkUrl}/park/admin/rate-limits`)
    const rateForm = admin.getByRole('heading', { name: '限流配置', level: 2 }).locator('..')
    for (const [name, value] of Object.entries({
      message_max_length: 5,
      session_message_max: 50,
      session_token_budget: 20_000,
      concurrent_max: 8,
      box_per_minute: 120,
      ip_per_minute: 30,
      subnet_per_minute: 100,
    })) {
      await rateForm.locator(`input[name="${name}"]`).fill(String(value))
    }
    await rateForm.getByRole('button', { name: '保存' }).click()
    await expect(admin.getByText('已保存。')).toBeVisible()
    expect(
      (
        (await (await admin.request.get(`${parkApi}/admin/rate-limits`)).json()) as {
          value: { message_max_length: number }
        }
      ).value.message_max_length,
    ).toBe(5)

    const visitor = await publicVisitor.newPage()
    const created = visitor.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/public/consult/sessions' &&
        response.request().method() === 'POST',
    )
    await visitor.goto(`${parkUrl}/consult`)
    const sessionId = ((await (await created).json()) as { session_id: string }).session_id
    const messageUrl = `${parkUrl}/public/sessions/${sessionId}/messages`
    const rejected = await visitor.request.post(messageUrl, {
      data: { message: '算力机密专用词', client_request_id: randomUUID() },
    })
    expect(rejected.status()).toBe(413)

    await admin.request.put(`${parkApi}/admin/rate-limits`, { data: rateBefore })
    await admin.goto(`${parkUrl}/park/admin/audit`)
    const redactionForm = admin.getByRole('heading', { name: '脱敏策略' }).locator('..')
    await redactionForm.getByLabel('脱敏摘要最大长度').fill('1000')
    await redactionForm.getByLabel('额外敏感词（每行一项）').fill('机密专用词')
    await redactionForm.getByRole('button', { name: '保存' }).click()
    await expect(admin.getByText('已保存。')).toBeVisible()

    const accepted = await visitor.request.post(messageUrl, {
      data: { message: '算力机密专用词', client_request_id: randomUUID() },
    })
    expect(accepted.status()).toBe(200)
    const stored = (await (await visitor.request.get(messageUrl)).json()) as Array<{
      redacted_question: string
    }>
    expect(stored).toHaveLength(1)
    expect(stored[0]?.redacted_question).toContain('[敏感词]')
    expect(stored[0]?.redacted_question).not.toContain('机密专用词')
  } finally {
    if (rateBefore) await operator.request.put(`${parkApi}/admin/rate-limits`, { data: rateBefore })
    if (redactionBefore)
      await operator.request.put(`${parkApi}/admin/redaction`, { data: redactionBefore })
    await publicVisitor.close()
    await operator.close()
  }
})

test('assistant page lists wiki source files with directories and delete needs confirm', async ({ browser }) => {
  const operator = await browser.newContext()
  try {
    const admin = await operator.newPage()
    await admin.goto(`${parkUrl}/park/login`)
    await admin.getByLabel('账号').fill('operator')
    await admin.getByLabel('密码').fill('park-test-password')
    await admin.getByRole('button', { name: '进入园区管理' }).click()
    await expect(admin).toHaveURL(`${parkUrl}/park/admin/policies`)

    const directory = `来源目录-${Date.now()}`
    const directorySection = admin.getByRole('heading', { name: '政策文件目录' }).locator('..')
    await directorySection.getByLabel('目录名称').fill(directory)
    await directorySection.getByRole('button', { name: '新建' }).click()
    await directorySection.getByLabel('当前目录').selectOption({ label: directory })

    const fileName = '来源算力政策.md'
    await admin.getByLabel(/^上传政策文件/).setInputFiles({
      name: fileName,
      mimeType: 'text/markdown',
      buffer: Buffer.from('# 算力政策\n来源清单校验内容。'),
    })
    await expect(admin.locator('strong').filter({ hasText: fileName })).toBeVisible()

    const wikiSection = admin.getByRole('heading', { name: '政策知识库' }).locator('..')
    await wikiSection.getByRole('combobox', { name: '政策知识库 Wiki' }).selectOption('')
    await wikiSection.getByLabel(fileName).check()
    await wikiSection.getByLabel('知识库名称').fill(`来源知识库-${Date.now()}`)
    await wikiSection.getByRole('button', { name: '新建知识库' }).click()
    const wikiSelect = wikiSection.getByRole('combobox', { name: '政策知识库 Wiki' })
    await expect(wikiSelect).toHaveValue(/.+/)
    const wikiId = await wikiSelect.inputValue()
    await wikiSection.getByRole('button', { name: '保存来源并构建' }).click()
    await expect(wikiSection.getByText('构建成功')).toBeVisible({ timeout: 10_000 })

    // Assistant page shows the wiki's full source list with directory names.
    await admin.goto(`${parkUrl}/park/admin/assistant`)
    const assistantForm = admin.getByRole('heading', { name: 'Assistant 管理' }).locator('..')
    await assistantForm.getByRole('combobox', { name: '政策知识库 Wiki' }).selectOption(wikiId)
    const sourcesSection = assistantForm.locator('section').filter({
      has: admin.getByText(/^知识库文件（\d+）$/),
    })
    await expect(sourcesSection.locator('strong').filter({ hasText: fileName })).toBeVisible()
    await expect(sourcesSection.locator('p').filter({ hasText: directory })).toContainText(directory + ' · ')

    // Deleting a file requires an inline second click.
    await admin.goto(`${parkUrl}/park/admin/policies`)
    await directorySection.getByLabel('当前目录').selectOption({ label: directory })
    const deleteButton = admin.getByText(fileName, { exact: true }).locator('..').locator('..').getByRole('button', { name: '删除', exact: true })
    await deleteButton.click()
    await expect(admin.getByRole('button', { name: '确认删除？' })).toBeVisible()
    await expect(admin.locator('strong').filter({ hasText: fileName })).toBeVisible()
    await admin.getByRole('button', { name: '确认删除？' }).click()
    await expect(admin.locator('strong').filter({ hasText: fileName })).toHaveCount(0)
    await admin.goto(`${parkUrl}/park/admin/assistant`)
    await assistantForm.getByRole('combobox', { name: '政策知识库 Wiki' }).selectOption(wikiId)
    await expect(sourcesSection.getByText(fileName, { exact: true })).toBeVisible()
    await expect(sourcesSection.getByText('已删除', { exact: true })).toBeVisible()
    const positions = await admin.evaluate(() => {
      const wiki = document.querySelector<HTMLSelectElement>('select[name="policy_wiki_id"]')!
      const sources = [...document.querySelectorAll('section')].find(element => element.textContent?.startsWith('知识库文件'))!
      const save = document.querySelector<HTMLButtonElement>('button[type="submit"]')!
      return { wikiBottom: wiki.getBoundingClientRect().bottom, sourcesTop: sources.getBoundingClientRect().top, sourcesBottom: sources.getBoundingClientRect().bottom, saveTop: save.getBoundingClientRect().top }
    })
    expect(positions.sourcesTop).toBeGreaterThanOrEqual(positions.wikiBottom)
    expect(positions.saveTop).toBeGreaterThan(positions.sourcesBottom)
  } finally {
    await operator.close()
  }
})
