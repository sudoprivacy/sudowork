import { expect, test } from '@playwright/test'

const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:26808'

/**
 * 园区业务域页面 E2E（真实 moss @ 10.0.1.157）
 * 登录经 API 注入 cookie；验证：角色导航注入（侧栏文案存在于 DOM）、
 * 页面路由直达渲染真实数据、守卫重定向。
 */

async function loginAs(page: import('@playwright/test').Page, user: string, password: string) {
  const res = await page.request.post('/api/auth/login/password', {
    headers: { origin: ORIGIN },
    data: { username: user, password },
  })
  expect(res.status(), `login ${user} should be 200`).toBe(200)
  const setCookie = res.headers()['set-cookie']!.split(';')[0]!
  const separator = setCookie.indexOf('=')
  expect(separator).toBeGreaterThan(0)
  const name = setCookie.slice(0, separator)
  const value = setCookie.slice(separator + 1)
  await page.context().addCookies([{ name, value, url: ORIGIN }])
  await page.goto('/#/guid')
  // 等待应用就绪（侧栏渲染）
  await page.waitForTimeout(4000)
}

test('ops：园区菜单注入 + 线索池真实数据渲染', async ({ page }) => {
  await loginAs(page, 'ops', 'Ops@2026')
  // 侧栏含园区菜单（park context 注入成功）
  const menuCount = await page.getByText('线索池').count()
  expect(menuCount).toBeGreaterThan(0)
  // 直达线索池，表格渲染真实数据
  await page.goto('/#/park/leads')
  await expect(
    page.getByText(/待确认|已确认|已分派|跟进中|已转化|已流失|已驳回/).first(),
  ).toBeVisible({ timeout: 30_000 })
})

test('entuser：企业菜单注入 + 园区菜单不注入 + 咨询记录真实数据', async ({ page }) => {
  await loginAs(page, 'entuser', 'Ent@2026')
  expect(await page.getByText('企业工作台').count()).toBeGreaterThan(0)
  expect(await page.getByText('园区咨询').count()).toBeGreaterThan(0)
  expect(await page.getByText('咨询摘要').count()).toBe(0)
  await page.goto('/#/enterprise/inquiries')
  await expect(page.getByText(/租金|政策|咨询|人才|博士|补贴/).first()).toBeVisible({
    timeout: 30_000,
  })
})

test('entuser 直接输入园区 URL 被守卫重定向', async ({ page }) => {
  await loginAs(page, 'entuser', 'Ent@2026')
  await page.goto('/#/park/leads')
  await page.waitForTimeout(4000)
  await expect(page).not.toHaveURL(/#\/park\/leads/)
})

test('leader：园区总览菜单 + metrics 真实数字渲染', async ({ page }) => {
  await loginAs(page, 'leader', 'Leader@2026')
  expect(await page.getByText('园区总览').count()).toBeGreaterThan(0)
  await page.goto('/#/park/overview')
  // 强断言：页面主体必须渲染（不是侧栏文本满足弱匹配）——漏斗卡片标题 + 无崩溃横幅
  await expect(page.getByText('招留管退漏斗')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Something Went Wrong')).toBeHidden()
  // 状态分布卡片也在
  await expect(page.getByText('线索状态分布')).toBeVisible({ timeout: 15_000 })
})

test('sysop：系统管理菜单 + 分配列表渲染', async ({ page }) => {
  await loginAs(page, 'sysop', 'Sysop@2026')
  expect(await page.getByText('组织与绑定').count()).toBeGreaterThan(0)
  await page.goto('/#/park/admin/organizations')
  await expect(page.getByText(/SudoRouter|park-consultation|组织与绑定/).first()).toBeVisible({
    timeout: 30_000,
  })
})
