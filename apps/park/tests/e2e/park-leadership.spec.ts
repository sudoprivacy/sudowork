import { expect, test } from '@playwright/test'

test('leadership date controls open calendars and apply selected dates', async ({ page }) => {
  await page.goto('/park/login')
  await page.getByLabel('账号').fill('leader')
  await page.getByLabel('密码').fill('park-test-password')
  await page.getByRole('button', { name: '进入园区管理' }).click()
  await expect(page.getByRole('heading', { name: '经营总览' })).toBeVisible()

  for (const path of ['/park/overview', '/park/leads/summary', '/park/compliance/summary']) {
    await page.goto(path)
    await expect(page.getByText(/统计期间（上海时间）/)).toBeVisible()
    for (const name of ['开始日期', '结束日期']) {
      const input = page.getByLabel(name)
      for (const isLabelClick of [false, true]) {
        const before = await input.inputValue()
        const selected = new Date(Date.parse(`${before}T00:00:00Z`) - 86400000)
          .toISOString()
          .slice(0, 10)
        if (isLabelClick) {
          await page.getByText(name, { exact: true }).click({ position: { x: 30, y: 5 } })
        } else {
          await input.click({ position: { x: 60, y: 16 } })
        }
        const response = page.waitForResponse((result) => {
          const url = new URL(result.url())
          return (
            url.pathname.startsWith('/park/api/v1/parks/') &&
            url.searchParams.get(name === '开始日期' ? 'from' : 'to') === selected
          )
        })
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.press('Enter')
        await expect(input).toHaveValue(selected)
        expect((await response).ok()).toBe(true)
        await expect(page.getByText(/统计期间（上海时间）/)).toContainText(selected)
      }
    }
  }
})

test('leadership filters verified questions and uses whole-control month selection', async ({
  browser,
  page,
}) => {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  await page.goto('/park/login')
  await page.getByLabel('账号').fill('leader')
  await page.getByLabel('密码').fill('park-test-password')
  await page.getByRole('button', { name: '进入园区管理' }).click()
  await expect(page.getByRole('heading', { name: '经营总览' })).toBeVisible()
  const api = '/park/api/v1/parks/park-1'
  const before = await (await page.request.get(`${api}/metrics`)).json()
  const visitor = await browser.newContext()
  try {
    const consult = await visitor.newPage()
    await consult.goto('/consult')
    await consult.locator('#question-input').fill('有哪些人才政策？')
    await consult.getByRole('button', { name: /发送问题/ }).click()
    await expect(consult.getByText(/算力服务可申请/)).toBeVisible()
    await expect
      .poll(async () => {
        const metrics = await (await page.request.get(`${api}/metrics`)).json()
        return metrics.cards.total_inquiries
      })
      .toBe(before.cards.total_inquiries + 1)
    await expect
      .poll(async () => {
        const metrics = await (await page.request.get(`${api}/metrics`)).json()
        return metrics.data_quality.extraction_pending
      })
      .toBe(0)
    await page.reload()
    await expect(page.getByRole('button', { name: '刷新', exact: true })).toHaveCount(0)
    await expect(page.getByText('数据完整性', { exact: true })).toHaveCount(0)
    await expect(page.getByText('↗', { exact: true })).toHaveCount(0)
    await expect(page.getByText(/统计期间（上海时间）/)).toBeVisible()
    await expect(page.getByText('有哪些人才政策？', { exact: true }).first()).toBeVisible()
    const trend = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: '咨询趋势', exact: true }) })
    await expect(trend.locator('tbody tr')).toHaveCount(14)
    const today = await page.getByLabel('结束日期').inputValue()
    await page.getByLabel('开始日期').fill(today)
    await expect(trend.locator('tbody tr')).toHaveCount(1)
    await page.getByLabel('结束日期').fill('2020-01-01')
    await expect(page.getByRole('alert')).toContainText('请选择有效的起止日期')
    await page.getByLabel('结束日期').fill(today)
    const channels = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: '渠道效果', exact: true }) })
    await expect(channels.getByRole('columnheader', { name: '首次转化线索（条）' })).toBeVisible()
    await expect(page.getByText('前期为 0，无法计算涨跌幅').first()).toBeVisible()
    await page.goto('/park/reports')
    await expect(page.getByRole('heading', { name: '领导月报', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '政策关注点', exact: true })).toBeVisible()
    const questionPanel = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: '热门问题', exact: true }) })
    await expect(questionPanel.locator('table')).toBeVisible()
    const questionBounds = await questionPanel.evaluate((panel) => {
      const table = panel.querySelector('table')!
      return {
        tableRight: table.getBoundingClientRect().right,
        panelRight: panel.getBoundingClientRect().right,
      }
    })
    expect(questionBounds.tableRight).toBeLessThanOrEqual(questionBounds.panelRight)
    await expect(page.getByRole('button', { name: '选择月份', exact: true })).toContainText(
      `${today.slice(0, 4)}年${Number(today.slice(5, 7))}月`,
    )
    await expect(page.getByText('数据完整性', { exact: true })).toHaveCount(0)
    await page
      .getByRole('button', { name: '选择月份', exact: true })
      .click({ position: { x: 20, y: 15 } })
    await expect(page.getByRole('dialog', { name: '选择月份' })).toBeVisible()
    await page.getByLabel('年份').fill('2020')
    await page.getByRole('button', { name: '1月', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`${api}/reports?month=2020-01`)).json()).inquiries,
      )
      .toBe(0)
    await expect(page.getByText(/统计期间（上海时间）.*2020-01-01 ~ 2020-01-31/)).toBeVisible()
    await page.goto('/park/leads/summary')
    await expect(page.getByText('数据完整性', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '刷新', exact: true })).toHaveCount(0)
    await expect(page.getByText('累计线索（条）', { exact: true })).toBeVisible()
    await page.goto('/park/compliance/summary')
    await expect(page.getByText(/当前未过期会话风险状态/)).toBeVisible()
    await expect(page.getByText('数据完整性', { exact: true })).toHaveCount(0)
    await expect(page.locator('details')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '刷新', exact: true })).toHaveCount(0)
    expect(failures).toEqual([])
  } finally {
    await visitor.close()
  }
})
