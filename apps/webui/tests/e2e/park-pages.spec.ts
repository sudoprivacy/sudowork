import { expect, test } from '@playwright/test'

/**
 * 园区页面全覆盖 E2E（补齐版）：逐页直达 + 交互元素验证
 * 覆盖此前缺口：线索详情、咨询摘要、企业列表/画像（编辑表单）、
 * 企业 home/assistant/policies/services、注册页企业步骤、assistant 开始咨询按钮
 */

const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:26808'
const PARK_ORG = 'a3fdbd51-c14a-49f7-9685-f15b11b6e91b'

async function loginAs(page: import('@playwright/test').Page, user: string, password: string) {
  const res = await page.request.post('/api/auth/login/password', {
    headers: { origin: ORIGIN },
    data: { username: user, password },
  })
  expect(res.status(), `login ${user}`).toBe(200)
  const setCookie = res.headers()['set-cookie']!.split(';')[0]!
  const separator = setCookie.indexOf('=')
  expect(separator).toBeGreaterThan(0)
  const name = setCookie.slice(0, separator)
  const value = setCookie.slice(separator + 1)
  await page.context().addCookies([{ name, value, url: ORIGIN }])
}

/** 经 BFF 拿一条非终态线索 id（终态无操作按钮）；没有则新建一条 manual 线索（初始 following_up） */
async function actionableLeadId(page: import('@playwright/test').Page): Promise<string> {
  const res = await page.request.get(`/api/parks/${PARK_ORG}/leads`, {
    headers: { origin: ORIGIN },
  })
  const body = await res.json()
  const open = body.items.find(
    (l: { status: string }) => !['converted', 'lost', 'rejected'].includes(l.status),
  )
  if (open) return open.lead_id
  const created = await page.request.post(`/api/parks/${PARK_ORG}/leads`, {
    headers: { origin: ORIGIN },
    data: { enterprise_org_id: '1a4ab481-1e84-4799-a00b-cdd8ae33bead', note: 'E2E 详情按钮载体' },
  })
  return (await created.json()).lead_id
}

test('ops：线索详情页（脱敏摘要+评分依据+状态操作按钮）', async ({ page }) => {
  await loginAs(page, 'ops', 'Ops@2026')
  const leadId = await actionableLeadId(page)
  await page.goto(`/#/park/leads/${leadId}`)
  // 详情字段
  await expect(page.getByText(/评分依据|评分/).first()).toBeVisible({ timeout: 25_000 })
  // 状态操作按钮（ops 对应状态的操作集合：认领/确认/驳回/转化/流失 等）
  await expect(
    page.getByRole('button', { name: /认领|确认|驳回|转化|流失|分派/ }).first(),
  ).toBeVisible({ timeout: 15_000 })
  // 响应无原文 ref（页面内容层面）
  const content = await page.content()
  expect(content).not.toContain('question_ref')
})

test('ops：新建手动线索后在详情页转化', async ({ page }) => {
  await loginAs(page, 'ops', 'Ops@2026')
  const created = await page.request.post(`/api/parks/${PARK_ORG}/leads`, {
    headers: { origin: ORIGIN },
    data: { enterprise_org_id: '1a4ab481-1e84-4799-a00b-cdd8ae33bead', note: 'E2E 状态操作' },
  })
  expect(created.status()).toBe(200)
  const { lead_id: leadId, status } = await created.json()
  expect(status).toBe('following_up')
  await page.goto(`/#/park/leads/${leadId}`)
  await page.getByRole('button', { name: '转化' }).click()
  await expect
    .poll(async () => {
      const detail = await page.request.get(`/api/parks/${PARK_ORG}/leads/${leadId}`, {
        headers: { origin: ORIGIN },
      })
      expect(detail.status()).toBe(200)
      return (await detail.json()).status
    })
    .toBe('converted')
})

test('ops：咨询摘要页（脱敏内容+是否产生线索标记）', async ({ page }) => {
  await loginAs(page, 'ops', 'Ops@2026')
  await page.goto('/#/park/consultations')
  await expect(page.getByText(/已产生线索|未产生线索/).first()).toBeVisible({ timeout: 30_000 })
})

test('ops：企业列表页 → 企业画像页（跟进编辑表单）', async ({ page }) => {
  await loginAs(page, 'ops', 'Ops@2026')
  await page.goto('/#/park/enterprises')
  await expect(page.getByText('星澜智能').first()).toBeVisible({ timeout: 25_000 })
  // 直达画像页（表格行点击 + URL 直达双保险）
  await page.goto('/#/park/enterprises/1a4ab481-1e84-4799-a00b-cdd8ae33bead')
  await expect(page.getByText('星澜智能').first()).toBeVisible({ timeout: 25_000 })
  // 画像字段
  await expect(page.getByText(/负责运营|标签/).first()).toBeVisible({ timeout: 15_000 })
  // ops 可见跟进编辑（保存按钮）
  await expect(page.getByRole('button', { name: /保存/ }).first()).toBeVisible({ timeout: 15_000 })
})

test('entuser：企业工作台 home（档案+导航入口）', async ({ page }) => {
  await loginAs(page, 'entuser', 'Ent@2026')
  await page.goto('/#/enterprise/home')
  await expect(page.getByText('星澜智能').first()).toBeVisible({ timeout: 25_000 })
})

test('entuser：assistant 页（被分配助手卡片+开始咨询按钮）', async ({ page }) => {
  await loginAs(page, 'entuser', 'Ent@2026')
  await page.goto('/#/enterprise/assistant')
  await expect(page.getByText('园区咨询助手').first()).toBeVisible({ timeout: 25_000 })
  await expect(page.getByRole('button', { name: /开始咨询/ }).first()).toBeVisible({
    timeout: 15_000,
  })
})

test('entuser：政策信息页（政策文件清单）', async ({ page }) => {
  await loginAs(page, 'entuser', 'Ent@2026')
  await page.goto('/#/enterprise/policies')
  await expect(page.getByText(/园区政策库/).first()).toBeVisible({ timeout: 25_000 })
  await expect(page.getByText(/\.md/).first()).toBeVisible({ timeout: 15_000 })
})

test('entuser：入驻服务页（服务目录）', async ({ page }) => {
  await loginAs(page, 'entuser', 'Ent@2026')
  await page.goto('/#/enterprise/services')
  await expect(page.getByText('工商注册协助').first()).toBeVisible({ timeout: 25_000 })
})

test('leader：园区总览数字与企业、咨询、线索明细一致', async ({ page }) => {
  await loginAs(page, 'leader', 'Leader@2026')
  const paths = [
    `/api/parks/${PARK_ORG}/enterprises`,
    `/api/parks/${PARK_ORG}/consultations`,
    `/api/parks/${PARK_ORG}/leads`,
  ]
  const counts = await Promise.all(
    paths.map(async (path) => {
      const response = await page.request.get(path, { headers: { origin: ORIGIN } })
      expect(response.status()).toBe(200)
      return (await response.json()).items.length as number
    }),
  )
  await page.goto('/#/park/overview')
  for (const [label, count] of [
    ['企业', counts[0]],
    ['咨询', counts[1]],
    ['线索', counts[2]],
  ] as const) {
    await expect(page.locator('.arco-statistic').filter({ hasText: label }).first()).toContainText(
      String(count),
      { timeout: 25_000 },
    )
  }
})

test('常规注册入口含手机号、验证码、企业名称、联系人和可选邀请码', async ({ page }) => {
  await page.goto('/#/login')
  await page.getByRole('button', { name: /企业注册|Enterprise Sign-up/ }).click()
  await expect(page.getByPlaceholder(/请输入手机号|Enter phone/).first()).toBeVisible()
  await expect(page.getByPlaceholder(/Enter contact name|请输入联系人姓名/).first()).toBeVisible()
  await expect(page.getByPlaceholder(/Enter enterprise name|请输入企业名称/).first()).toBeVisible()
  await expect(
    page.getByPlaceholder(/Enter invite code if any|如有邀请码请填写/).first(),
  ).toBeVisible()
  await expect(page.locator('input[placeholder^="park."]')).toHaveCount(0)
})

test('常规注册提交企业注册并切回登录 tab（mock 转发，计划 5.5①）', async ({ page }) => {
  let registered: Record<string, unknown> | null = null
  await page.route('**/api/park/register-enterprise', async (route) => {
    registered = route.request().postDataJSON()
    await route.fulfill({
      json: { enterprise_org_id: 'e2e-ent', park_org_id: 'e2e-park', user_id: 'e2e-user' },
    })
  })
  await page.goto('/#/login')
  await page.getByRole('button', { name: /企业注册|Enterprise Sign-up/ }).click()
  await page.getByPlaceholder(/请输入手机号|Enter phone/).fill('13800001234')
  await page.getByPlaceholder(/请输入验证码|Enter verification code/).fill('123456')
  await page.getByPlaceholder(/Enter contact name|请输入联系人姓名/).fill('张三')
  await page.getByPlaceholder(/Enter enterprise name|请输入企业名称/).fill('E2E 注册企业')
  await page.getByRole('button', { name: /注册企业账号|Register enterprise account/ }).click()
  await expect
    .poll(() => registered)
    .toMatchObject({
      phone: '13800001234',
      sms_code: '123456',
      enterprise_name: 'E2E 注册企业',
      contact_name: '张三',
    })
  await expect(page.getByPlaceholder(/请输入联系人姓名|Enter contact name/)).toBeHidden()
})

test('sysop：政策上传、删旧、构建与 Assistant 分配从页面提交正确请求', async ({ page }) => {
  await loginAs(page, 'sysop', 'Sysop@2026')
  let upload: Record<string, unknown> | null = null
  let deletedDocument: string | null = null
  let wikiCreate: Record<string, unknown> | null = null
  let wikiBuild = false
  let assignment: Record<string, unknown> | null = null
  await page.route('**/api/parks/*/policy/tree', (route) =>
    route.fulfill({
      json: { nodes: [{ id: 'e2e-node', name: 'E2E 文档目录', autoManaged: false }] },
    }),
  )
  await page.route('**/api/parks/*/policy/nodes/e2e-node/documents', async (route) => {
    if (route.request().method() === 'POST') {
      upload = route.request().postDataJSON()
      await route.fulfill({ json: { id: 'e2e-doc' } })
      return
    }
    await route.fulfill({
      json: {
        documents: [
          ...(deletedDocument ? [] : [{ id: 'old-doc', fileName: '旧政策.md', sizeBytes: 10 }]),
          ...(upload ? [{ id: 'e2e-doc', fileName: 'e2e-policy.md', sizeBytes: 16 }] : []),
        ],
      },
    })
  })
  await page.route('**/api/parks/*/policy/documents/old-doc', async (route) => {
    deletedDocument = 'old-doc'
    await route.fulfill({ json: { ok: true } })
  })
  await page.route('**/api/parks/*/policy/wikis', async (route) => {
    if (route.request().method() === 'POST') {
      wikiCreate = route.request().postDataJSON()
      await route.fulfill({
        json: {
          id: 'e2e-wiki',
          name: 'E2E 知识库',
          sourceMode: 'files',
          sourceDocumentIds: ['e2e-doc'],
          buildStatus: 'pending',
        },
      })
      return
    }
    await route.fulfill({
      json: {
        wikis: wikiCreate
          ? [
              {
                id: 'e2e-wiki',
                name: 'E2E 知识库',
                sourceMode: 'files',
                sourceDocumentIds: ['e2e-doc'],
                buildStatus: 'pending',
              },
            ]
          : [],
      },
    })
  })
  await page.route('**/api/parks/*/policy/wikis/e2e-wiki/build', async (route) => {
    wikiBuild = true
    await route.fulfill({ json: { job_id: 'e2e-build' } })
  })
  await page.route('**/api/parks/*/policy/wikis/e2e-wiki/build-status', (route) =>
    route.fulfill({
      json: {
        wiki_build_status: wikiBuild ? 'queued' : 'pending',
        last_build_error: null,
        latest_job: null,
      },
    }),
  )
  await page.route('**/api/parks/*/assistant-assignments', async (route) => {
    if (route.request().method() === 'POST') {
      assignment = route.request().postDataJSON()
      await route.fulfill({
        json: { assistant_id: 'e2e-assistant', enterprise_org_id: 'e2e-enterprise' },
      })
      return
    }
    await route.fulfill({ json: { items: [] } })
  })
  await page.route('**/api/parks/*/assistant-candidates', (route) =>
    route.fulfill({
      json: {
        items: [{ assistant_id: 'e2e-assistant', name: 'E2E 助手', display_name: 'E2E 助手' }],
      },
    }),
  )
  await page.route('**/api/parks/*/enterprises', (route) =>
    route.fulfill({
      json: { items: [{ enterprise_org_id: 'e2e-enterprise', enterprise_name: 'E2E 企业' }] },
    }),
  )
  await page.goto('/#/park/admin/policies')
  const policyCard = page.locator('.arco-card').filter({ hasText: '政策知识库' }).first()
  await policyCard.locator('.arco-select-view').first().click()
  await page.getByText('E2E 文档目录', { exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({
    name: 'e2e-policy.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('园区政策 E2E'),
  })
  await expect
    .poll(() => upload)
    .toMatchObject({ file_name: 'e2e-policy.md', mime_type: 'text/markdown' })
  await policyCard
    .getByRole('row', { name: /旧政策.md/ })
    .getByRole('button', { name: '删除旧文件' })
    .click()
  await expect.poll(() => deletedDocument).toBe('old-doc')
  await policyCard.locator('.arco-select-view').nth(2).click()
  await page.locator('.arco-select-popup:visible').getByText('e2e-policy.md').click()
  await policyCard.getByPlaceholder('新知识库名称').fill('E2E 知识库')
  await policyCard.getByRole('button', { name: '新建' }).last().click()
  await expect.poll(() => wikiCreate).toMatchObject({ source_document_ids: ['e2e-doc'] })
  await policyCard.getByRole('button', { name: '保存来源并构建' }).click()
  await expect.poll(() => wikiBuild).toBe(true)

  await page.goto('/#/park/admin/assistant')
  const assignmentCard = page.locator('.arco-card').filter({ hasText: 'Assistant 分配' }).first()
  await assignmentCard.getByRole('button', { name: '分配' }).click()
  const modal = page.locator('.arco-modal:visible')
  await modal.locator('.arco-select-view').first().click()
  await page.locator('.arco-select-popup:visible').getByText('E2E 助手').click()
  await modal.locator('.arco-select-view').nth(1).click()
  await page.locator('.arco-select-popup:visible').getByText('E2E 企业').click()
  await modal.getByRole('button', { name: '确定' }).click()
  await expect
    .poll(() => assignment)
    .toEqual({ assistant_id: 'e2e-assistant', enterprise_org_id: 'e2e-enterprise' })
})

test('sysop：添加成员可按姓名选择，也可直接输入用户 ID', async ({ page }) => {
  await loginAs(page, 'sysop', 'Sysop@2026')
  const addedUsers: string[] = []
  await page.route('**/api/parks/*/members', async (route) => {
    if (route.request().method() === 'POST') {
      addedUsers.push(route.request().postDataJSON().user_id)
      await route.fulfill({ json: { user_id: addedUsers.at(-1) } })
      return
    }
    await route.fulfill({ json: { items: [] } })
  })
  await page.route('**/api/parks/*/member-candidates*', (route) => {
    const query = new URL(route.request().url()).searchParams.get('q') ?? ''
    return route.fulfill({
      json: {
        items: query.includes('张') ? [{ user_id: 'candidate-user', display_name: '张三' }] : [],
      },
    })
  })

  await page.goto('/#/park/admin/users')
  await page.getByRole('button', { name: '添加成员' }).click()
  const modal = page.locator('.arco-modal:visible')
  const userInput = modal.getByPlaceholder('输入姓名 / 手机号 / 邮箱 / 用户 ID 搜索')
  await userInput.fill('张')
  await page.getByText('张三', { exact: true }).click()
  await expect(userInput).toHaveValue('张三')
  await modal.getByRole('button', { name: '确定' }).click()
  await expect.poll(() => addedUsers).toEqual(['candidate-user'])

  await page.getByRole('button', { name: '添加成员' }).click()
  await modal.getByPlaceholder('输入姓名 / 手机号 / 邮箱 / 用户 ID 搜索').fill('manual-user-id')
  await modal.getByRole('button', { name: '确定' }).click()
  await expect.poll(() => addedUsers).toEqual(['candidate-user', 'manual-user-id'])
})

test('entuser：assistant 页点击开始咨询创建会话（页面级会话创建）', async ({ page }) => {
  await loginAs(page, 'entuser', 'Ent@2026')
  await page.goto('/#/enterprise/assistant')
  await expect(page.getByRole('button', { name: /开始咨询/ }).first()).toBeVisible({
    timeout: 25_000,
  })
  await page
    .getByRole('button', { name: /开始咨询/ })
    .first()
    .click()
  await expect(page).toHaveURL(/#\/(conversation|moss-session)\//, { timeout: 60_000 })
})
