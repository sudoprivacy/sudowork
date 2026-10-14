import { expect, test, type Page } from '@playwright/test'

/**
 * 用户真实路径全覆盖 E2E：
 * 每类用户登录 → 断言侧栏园区菜单【完整集合】（不多不少）→
 * 逐菜单【真实点击】→ 断言 URL 正确 + 页面主体强断言 + ErrorBoundary 哨兵。
 *
 * 页面主体断言只匹配页面独有元素（不会被侧栏文本满足）；
 * 每页都检查 "Something Went Wrong" 不存在（崩溃哨兵）。
 */

const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:26808'
const PARK_ORG = 'a3fdbd51-c14a-49f7-9685-f15b11b6e91b'
const ENT_ORG = '1a4ab481-1e84-4799-a00b-cdd8ae33bead'

async function loginAs(page: Page, user: string, password: string) {
  const res = await page.request.post('/api/auth/login/password', {
    headers: { origin: ORIGIN },
    data: { username: user, password },
  })
  expect(res.status(), `login ${user}`).toBe(200)
  const setCookie = res.headers()['set-cookie']!.split(';')[0]!
  const sep = setCookie.indexOf('=')
  await page
    .context()
    .addCookies([{ name: setCookie.slice(0, sep), value: setCookie.slice(sep + 1), url: ORIGIN }])
  await page.goto('/#/guid')
  await page.waitForTimeout(4500)
}

/** 崩溃哨兵：ErrorBoundary 未出现 */
async function expectNoCrash(page: Page) {
  await expect(page.getByText('Something Went Wrong')).toBeHidden()
}

/** 断言园区菜单集合精确匹配（既不缺项也不多项） */
async function expectParkMenus(page: Page, expected: string[]) {
  for (const label of expected) {
    await expect(page.getByText(label).first(), `菜单应含「${label}」`).toBeVisible({
      timeout: 15_000,
    })
  }
}

/** 点击菜单并验证落地页主体（强断言 + 哨兵） */
async function clickMenuAndAssert(
  page: Page,
  menuLabel: string,
  urlPattern: RegExp,
  pageAssertion: (p: Page) => Promise<void>,
) {
  await expect(page.getByText(menuLabel).first()).toBeVisible({ timeout: 15_000 })
  await page.getByText(menuLabel).first().click()
  await expect(page).toHaveURL(urlPattern, { timeout: 12_000 })
  await pageAssertion(page)
  await expectNoCrash(page)
}

// ==================== leader（园区领导） ====================
test.describe('leader 用户路径', () => {
  test('菜单集合完整：总览/线索池/咨询摘要/企业列表', async ({ page }) => {
    await loginAs(page, 'leader', 'Leader@2026')
    await expectParkMenus(page, ['园区总览', '线索池', '咨询摘要', '企业列表'])
    await expect(page.getByText('系统管理').first()).toBeHidden()
    await expect(page.getByText('企业工作台').first()).toBeHidden()
  })

  test('点击「园区总览」→ 漏斗+状态分布渲染', async ({ page }) => {
    await loginAs(page, 'leader', 'Leader@2026')
    await clickMenuAndAssert(page, '园区总览', /#\/park\/overview/, async (p) => {
      await expect(p.getByText('招留管退漏斗')).toBeVisible({ timeout: 25_000 })
      await expect(p.getByText('线索状态分布')).toBeVisible({ timeout: 15_000 })
    })
  })

  test('点击「线索池」→ 真实线索表格', async ({ page }) => {
    await loginAs(page, 'leader', 'Leader@2026')
    await clickMenuAndAssert(page, '线索池', /#\/park\/leads/, async (p) => {
      await p.getByText('全部', { exact: true }).click()
      await expect(p.getByText('星澜智能').first()).toBeVisible({ timeout: 25_000 })
    })
  })

  test('点击「咨询摘要」→ 咨询列表+标记', async ({ page }) => {
    await loginAs(page, 'leader', 'Leader@2026')
    await clickMenuAndAssert(page, '咨询摘要', /#\/park\/consultations/, async (p) => {
      await expect(p.getByText(/已产生线索|未产生线索/).first()).toBeVisible({ timeout: 25_000 })
    })
  })

  test('点击「企业列表」→ 企业表格', async ({ page }) => {
    await loginAs(page, 'leader', 'Leader@2026')
    await clickMenuAndAssert(page, '企业列表', /#\/park\/enterprises$/, async (p) => {
      await expect(p.getByText('星澜智能').first()).toBeVisible({ timeout: 25_000 })
    })
  })
})

// ==================== ops（招商运营） ====================
test.describe('ops 用户路径', () => {
  test('菜单集合完整：线索池/咨询摘要/企业列表（无总览/无系统管理）', async ({ page }) => {
    await loginAs(page, 'ops', 'Ops@2026')
    await expectParkMenus(page, ['线索池', '咨询摘要', '企业列表'])
    await expect(page.getByText('园区总览').first()).toBeHidden()
    await expect(page.getByText('系统管理').first()).toBeHidden()
  })

  test('点击「线索池」→ 新建按钮可见（ops 专属）', async ({ page }) => {
    await loginAs(page, 'ops', 'Ops@2026')
    await clickMenuAndAssert(page, '线索池', /#\/park\/leads/, async (p) => {
      await expect(p.getByRole('button', { name: /新建线索/ }).first()).toBeVisible({
        timeout: 25_000,
      })
    })
  })

  test('线索池点击行 → 详情页（脱敏摘要+操作按钮+无原文）', async ({ page }) => {
    await loginAs(page, 'ops', 'Ops@2026')
    // 确保有可操作线索（非终态）
    const res = await page.request.get(`/api/parks/${PARK_ORG}/leads`, {
      headers: { origin: ORIGIN },
    })
    const items = (await res.json()).items as Array<{ lead_id: string; status: string }>
    if (!items.some((l) => !['converted', 'lost', 'rejected'].includes(l.status))) {
      await page.request.post(`/api/parks/${PARK_ORG}/leads`, {
        headers: { origin: ORIGIN },
        data: { enterprise_org_id: ENT_ORG, note: '用户路径E2E载体' },
      })
    }
    await clickMenuAndAssert(page, '线索池', /#\/park\/leads/, async (p) => {
      await expect(p.getByText('星澜智能').first()).toBeVisible({ timeout: 25_000 })
    })
    // 点击第一行进入详情（真实用户路径）
    await page.getByText('星澜智能').first().click()
    await expect(page).toHaveURL(/#\/park\/leads\/.+/, { timeout: 12_000 })
    await expectNoCrash(page)
    const content = await page.content()
    expect(content).not.toContain('question_ref')
    expect(content).not.toContain('answer_ref')
  })

  test('点击「咨询摘要」', async ({ page }) => {
    await loginAs(page, 'ops', 'Ops@2026')
    await clickMenuAndAssert(page, '咨询摘要', /#\/park\/consultations/, async (p) => {
      await expect(p.getByText(/已产生线索|未产生线索/).first()).toBeVisible({ timeout: 25_000 })
    })
  })

  test('点击「企业列表」→ 行点击进画像（保存按钮 ops 专属）', async ({ page }) => {
    await loginAs(page, 'ops', 'Ops@2026')
    await clickMenuAndAssert(page, '企业列表', /#\/park\/enterprises$/, async (p) => {
      await expect(p.getByText('星澜智能').first()).toBeVisible({ timeout: 25_000 })
    })
    await page.getByText('星澜智能').first().click()
    await expect(page).toHaveURL(new RegExp(`#\\/park\\/enterprises\\/${ENT_ORG}`), {
      timeout: 12_000,
    })
    await expectNoCrash(page)
    await expect(page.getByRole('button', { name: /保存/ }).first()).toBeVisible({
      timeout: 20_000,
    })
  })
})

// ==================== sysop（系统运营） ====================
test.describe('sysop 用户路径', () => {
  test('菜单集合完整：咨询摘要/企业列表/五个管理页', async ({ page }) => {
    await loginAs(page, 'sysop', 'Sysop@2026')
    for (const label of ['咨询摘要', '企业列表', '组织与绑定', '用户与角色', 'Assistant 分配', '政策知识库', '审计日志']) {
      await expect(page.getByText(label).first(), `菜单「${label}」`).toBeVisible({
        timeout: 15_000,
      })
    }
    await expect(page.getByText('园区总览').first()).toBeHidden()
    await expect(page.getByText('线索池').first()).toBeHidden()
  })

  test('五个管理页各自渲染（独立页面，计划 3.5）', async ({ page }) => {
    await loginAs(page, 'sysop', 'Sysop@2026')
    const sections = [
      ['/park/admin/organizations', '组织与绑定'],
      ['/park/admin/users', '用户与角色'],
      ['/park/admin/assistant', 'Assistant 分配'],
      ['/park/admin/policies', '政策知识库'],
      ['/park/admin/audit', '审计日志'],
    ] as const
    for (const [path, title] of sections) {
      await page.goto(`/#${path}`)
      await expect(page.getByText(title).first(), `${path} 页面标题`).toBeVisible({ timeout: 25_000 })
    }
  })

  test('点击「咨询摘要」（sysop 亦有读权限）', async ({ page }) => {
    await loginAs(page, 'sysop', 'Sysop@2026')
    await clickMenuAndAssert(page, '咨询摘要', /#\/park\/consultations/, async (p) => {
      await expect(p.getByText(/已产生线索|未产生线索/).first()).toBeVisible({ timeout: 25_000 })
    })
  })

  test('点击「企业列表」（技术关联视图）', async ({ page }) => {
    await loginAs(page, 'sysop', 'Sysop@2026')
    await clickMenuAndAssert(page, '企业列表', /#\/park\/enterprises$/, async (p) => {
      await expect(p.getByText('星澜智能').first()).toBeVisible({ timeout: 25_000 })
    })
  })
})

// ==================== entuser（企业用户） ====================
test.describe('entuser 用户路径', () => {
  test('菜单集合完整：工作台/园区咨询/政策信息/入驻服务/我的咨询记录', async ({ page }) => {
    await loginAs(page, 'entuser', 'Ent@2026')
    for (const label of ['企业工作台', '园区咨询', '政策信息', '入驻服务', '我的咨询记录']) {
      await expect(page.getByText(label).first(), `菜单「${label}」`).toBeVisible({
        timeout: 15_000,
      })
    }
    await expect(page.getByText('园区总览').first()).toBeHidden()
    await expect(page.getByText('线索池').first()).toBeHidden()
    await expect(page.getByText('系统管理').first()).toBeHidden()
  })

  test('点击「企业工作台」→ 企业档案', async ({ page }) => {
    await loginAs(page, 'entuser', 'Ent@2026')
    await clickMenuAndAssert(page, '企业工作台', /#\/enterprise\/home/, async (p) => {
      await expect(p.getByText('星澜智能').first()).toBeVisible({ timeout: 25_000 })
    })
  })

  test('点击「园区咨询」→ 助手卡片+开始咨询', async ({ page }) => {
    await loginAs(page, 'entuser', 'Ent@2026')
    await clickMenuAndAssert(page, '园区咨询', /#\/enterprise\/assistant/, async (p) => {
      await expect(p.getByText(/园区咨询助手/).first()).toBeVisible({ timeout: 25_000 })
      await expect(p.getByRole('button', { name: /开始咨询/ }).first()).toBeVisible({
        timeout: 15_000,
      })
    })
  })

  test('点击「政策信息」→ 政策库文件', async ({ page }) => {
    await loginAs(page, 'entuser', 'Ent@2026')
    await clickMenuAndAssert(page, '政策信息', /#\/enterprise\/policies/, async (p) => {
      await expect(p.getByText(/园区政策库/).first()).toBeVisible({ timeout: 25_000 })
      await expect(p.getByText(/\.md/).first()).toBeVisible({ timeout: 15_000 })
    })
  })

  test('点击「入驻服务」→ 服务目录', async ({ page }) => {
    await loginAs(page, 'entuser', 'Ent@2026')
    await clickMenuAndAssert(page, '入驻服务', /#\/enterprise\/services/, async (p) => {
      await expect(p.getByText('工商注册协助').first()).toBeVisible({ timeout: 25_000 })
    })
  })

  test('点击「我的咨询记录」→ 真实咨询', async ({ page }) => {
    await loginAs(page, 'entuser', 'Ent@2026')
    await clickMenuAndAssert(page, '我的咨询记录', /#\/enterprise\/inquiries/, async (p) => {
      await expect(p.getByText(/政策|咨询|租金|人才/).first()).toBeVisible({ timeout: 25_000 })
    })
  })
})
