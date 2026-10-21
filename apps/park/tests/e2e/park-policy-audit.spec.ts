import { expect, test } from '@playwright/test'

const parkUrl = `http://127.0.0.1:${process.env.PARK_E2E_PORT ?? '4176'}`
const base = `${parkUrl}/park/api/v1/parks/park-1`

test.beforeEach(async ({ page }) => {
  await page.goto(`${parkUrl}/park/login`)
  await page.getByLabel('账号').fill('operator')
  await page.getByLabel('密码').fill('park-test-password')
  await page.getByRole('button', { name: '进入园区管理' }).click()
  await expect(page).toHaveURL(`${parkUrl}/park/admin/policies`)
})

test('upload types, audit names and redaction defaults reflect backend data', async ({ page }) => {
  const input = page.locator('input[type="file"]')
  await expect(input).toHaveAttribute('accept', '.txt,.md,.markdown,.docx,.pdf')
  await expect(page.getByText(/最大 50MB，支持 TXT、MD、DOCX、PDF/)).toBeVisible()
  const section = page.getByRole('heading', { name: '政策文件目录' }).locator('..')
  const name = `审计验证-${Date.now()}`
  await section.getByLabel('目录名称').fill(name)
  await section.getByRole('button', { name: '新建' }).click()
  await section.getByLabel('当前目录').selectOption({ label: name })
  for (const extension of ['md', 'markdown']) {
    await input.setInputFiles({
      name: `政策提示验证.${extension}`,
      mimeType: 'text/markdown',
      buffer: Buffer.from('# 政策\n可申请服务。'),
    })
    await expect(
      page.locator('strong').filter({ hasText: `政策提示验证.${extension}` }),
    ).toBeVisible()
  }
  let uploadRequests = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/documents$/.test(request.url())) uploadRequests++
  })
  await input.setInputFiles({
    name: 'movie.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('unsupported'),
  })
  await expect(page.getByText('仅支持 TXT、MD、DOCX、PDF 政策文件。')).toBeVisible()
  expect(uploadRequests).toBe(0)
  await page.goto(`${parkUrl}/park/admin/audit`)
  await expect(page.getByLabel('脱敏摘要最大长度')).toHaveValue('4000')
  await expect(page.getByRole('columnheader', { name: '操作人', exact: true })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '操作对象', exact: true })).toBeVisible()
  const row = page.getByRole('row').filter({ hasText: name })
  await expect(row).toContainText('创建政策目录')
  await expect(row).toContainText('operator')
  await expect(page.locator('table')).not.toContainText('/api/v1/')
  const response = await page.request.get(`${base}/admin/audit-events`)
  expect(
    (await response.json()).some((event: { path: string }) =>
      event.path.endsWith('/admin/policy/tree/nodes'),
    ),
  ).toBe(true)
})

test('assistant feedback remains beside save and never claims an unconfirmed switch', async ({
  page,
}) => {
  const wikis = [
    { id: 'wiki-a', name: '政策库 A', buildStatus: 'succeeded' },
    { id: 'wiki-b', name: '新的政策知识库', buildStatus: 'succeeded' },
  ]
  let savedId = 'wiki-a'
  let mode = 'failure'
  let putCount = 0
  await page.route('**/admin/policy/wikis', (route) => route.fulfill({ json: { wikis } }))
  await page.route('**/admin/policy/wikis/*/sources', (route) =>
    route.fulfill({ json: { record_status: 'available', sources: [] } }),
  )
  await page.route('**/park/api/v1/parks/*/admin/assistant', async (route) => {
    if (route.request().method() === 'GET') {
      if (mode === 'unconfirmed')
        return route.fulfill({ status: 503, json: { error: 'MOSS_UNAVAILABLE' } })
      return route.fulfill({ json: { status: 'published', value: { policy_wiki_id: savedId } } })
    }
    putCount++
    if (mode === 'failure')
      return route.fulfill({ status: 400, json: { error: 'POLICY_WIKI_NOT_BUILT' } })
    if (mode === 'network') return route.abort()
    if (mode === 'success') {
      await new Promise((resolve) => setTimeout(resolve, 300))
      savedId = route.request().postDataJSON().value.policy_wiki_id
    }
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto(`${parkUrl}/park/admin/assistant`)
  const select = page.getByRole('combobox', { name: '政策知识库 Wiki' })
  const save = page.getByRole('button', { name: '保存', exact: true })
  const feedback = save.locator('..').getByRole('status')
  await select.selectOption('wiki-b')
  await save.click()
  await expect(feedback).toHaveText('保存失败：所选政策知识库尚未构建成功。')
  await expect(select).toHaveValue('wiki-b')
  mode = 'mismatch'
  await save.click()
  await expect(feedback).toContainText('未确认切换成功')
  mode = 'success'
  await save.click()
  await expect(save).toBeDisabled()
  await expect(feedback).toHaveText('保存成功。')
  expect(putCount).toBe(3)
  await page.reload()
  await expect(select).toHaveValue('wiki-b')
  mode = 'unconfirmed'
  await save.click()
  await expect(feedback).toContainText('无法确认保存结果')
  mode = 'network'
  await save.click()
  await expect(feedback).toContainText('网络请求失败')
})
