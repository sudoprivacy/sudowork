import { expect, test } from '@playwright/test'

/**
 * 菜单点击导航 E2E——真实点击侧栏园区/企业菜单项，断言 URL 发生导航。
 * 这是曾经被绕过的路径（URL 直达测的是路由+页面，点击测的是 Sider→navigate 链）。
 */

const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:26808'

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
  await page.goto('/#/guid')
  await page.waitForTimeout(4000)
}

test('ops：点击「线索池」菜单导航到 /park/leads', async ({ page }) => {
  await loginAs(page, 'ops', 'Ops@2026')
  await expect(page.getByText('线索池').first()).toBeVisible({ timeout: 20_000 })
  await page.getByText('线索池').first().click()
  await expect(page).toHaveURL(/#\/park\/leads/, { timeout: 10_000 })
})

test('ops：点击「咨询摘要」菜单导航', async ({ page }) => {
  await loginAs(page, 'ops', 'Ops@2026')
  await page.getByText('咨询摘要').first().click()
  await expect(page).toHaveURL(/#\/park\/consultations/, { timeout: 10_000 })
})

test('ops：点击「企业列表」菜单导航', async ({ page }) => {
  await loginAs(page, 'ops', 'Ops@2026')
  await page.getByText('企业列表').first().click()
  await expect(page).toHaveURL(/#\/park\/enterprises/, { timeout: 10_000 })
})

test('leader：点击「园区总览」菜单导航', async ({ page }) => {
  await loginAs(page, 'leader', 'Leader@2026')
  await page.getByText('园区总览').first().click()
  await expect(page).toHaveURL(/#\/park\/overview/, { timeout: 10_000 })
})

test('entuser：点击「企业工作台」菜单导航', async ({ page }) => {
  await loginAs(page, 'entuser', 'Ent@2026')
  await page.getByText('企业工作台').first().click()
  await expect(page).toHaveURL(/#\/enterprise\/home/, { timeout: 10_000 })
})

test('entuser：点击「园区咨询」菜单导航', async ({ page }) => {
  await loginAs(page, 'entuser', 'Ent@2026')
  await page.getByText('园区咨询').first().click()
  await expect(page).toHaveURL(/#\/enterprise\/assistant/, { timeout: 10_000 })
})

test('entuser：点击「我的咨询记录」菜单导航', async ({ page }) => {
  await loginAs(page, 'entuser', 'Ent@2026')
  await page.getByText('我的咨询记录').first().click()
  await expect(page).toHaveURL(/#\/enterprise\/inquiries/, { timeout: 10_000 })
})

test('sysop：点击「组织与绑定」菜单导航', async ({ page }) => {
  await loginAs(page, 'sysop', 'Sysop@2026')
  await page.getByText('组织与绑定').first().click()
  await expect(page).toHaveURL(/#\/park\/admin\/organizations/, { timeout: 10_000 })
})
