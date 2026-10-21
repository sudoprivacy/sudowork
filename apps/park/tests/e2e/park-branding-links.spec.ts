import { expect, test } from '@playwright/test'

async function login(page: import('@playwright/test').Page) {
  await page.goto('/park/login')
  await page.getByLabel('账号').fill('operator')
  await page.getByLabel('密码').fill('park-test-password')
  await page.getByRole('button', { name: '进入园区管理' }).click()
  await expect(page).toHaveURL(/\/park\/admin\/policies$/)
}

test('content name and welcome share the first row, with logo below on desktop and mobile', async ({
  page,
}) => {
  await login(page)
  await page.goto('/park/admin/content')
  const name = page.locator('input[name="display_name"]')
  const welcome = page.locator('input[name="welcome_text"]')
  const logo = page.locator('input[name="logo_upload"]')
  await expect(name).toHaveValue('测试园区')
  await expect(welcome).toBeVisible()
  await expect(logo).toBeVisible()
  const first = await name.boundingBox()
  const second = await welcome.boundingBox()
  const third = await logo.boundingBox()
  expect(Math.abs(first!.y - second!.y)).toBeLessThan(2)
  expect(second!.x).toBeGreaterThan(first!.x)
  expect(third!.y).toBeGreaterThan(first!.y + first!.height)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(async () => {
      const a = await name.boundingBox()
      const b = await welcome.boundingBox()
      return b!.y > a!.y
    })
    .toBe(true)
  const mobileName = await name.boundingBox()
  const mobileWelcome = await welcome.boundingBox()
  const mobileLogo = await logo.boundingBox()
  expect(mobileWelcome!.y).toBeGreaterThan(mobileName!.y)
  expect(mobileLogo!.y).toBeGreaterThan(mobileWelcome!.y)
})

test('logo upload updates the console, consultation and favicon and rejects oversized selections', async ({
  page,
  context,
}) => {
  await login(page)
  const api = '/park/api/v1/parks/park-1/admin/config'
  const original = await (await page.request.get(api)).json()
  try {
    await page.goto('/park/admin/content')
    await expect(page.locator('aside img')).toHaveAttribute(
      'src',
      /park-default-logo|^data:image\/svg/,
    )
    const input = page.getByLabel('园区 Logo')
    await expect(page.getByText('支持 JPG、JPEG、SVG、PNG，最大 500KB。')).toBeVisible()
    await expect(input).toHaveAttribute('accept', '.jpg,.jpeg,.svg,.png')
    await input.setInputFiles({
      name: 'large.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(500 * 1024 + 1),
    })
    await expect(
      page.getByText('请选择 JPG、JPEG、SVG、PNG 图片，文件大小不能超过 500KB。'),
    ).toBeVisible()
    await expect(page.locator('aside img')).toHaveAttribute(
      'src',
      /park-default-logo|^data:image\/svg/,
    )
    await input.setInputFiles({
      name: 'park.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="24"><rect width="80" height="24" fill="#aa8245"/></svg>',
      ),
    })
    const panel = page.getByRole('heading', { name: '园区简介 / 服务目录' }).locator('..')
    await panel.getByRole('button', { name: '保存' }).click()
    await expect(page.locator('aside img')).toHaveAttribute(
      'src',
      /\/public\/consult\/logo\/.+\.svg$/,
    )
    const logo = await page.locator('aside img').getAttribute('src')
    await expect(input).toHaveValue('')
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', logo!)
    await page.reload()
    await expect(page.locator('aside img')).toHaveAttribute('src', logo!)
    const consultation = await context.newPage()
    await consultation.goto('/consult')
    await expect(consultation.locator('#brand-logo')).toHaveAttribute('src', logo!)
    await expect(consultation.locator('link[rel="icon"]')).toHaveAttribute('href', logo!)
    await expect(consultation.locator('#brand-logo')).toBeVisible()
    await expect
      .poll(() =>
        consultation
          .locator('#brand-logo')
          .evaluate((element: HTMLImageElement) => element.naturalWidth),
      )
      .toBeGreaterThan(0)
    for (const [width, expected] of [
      [1366, 38],
      [375, 30],
    ]) {
      await consultation.setViewportSize({ width, height: 812 })
      const box = await consultation.locator('#brand-logo').boundingBox()
      expect(box!.width).toBe(expected)
      expect(box!.height).toBe(expected)
      expect(
        await consultation
          .locator('#brand-logo')
          .evaluate((element) => getComputedStyle(element).objectFit),
      ).toBe('contain')
    }
    await page.route('**/public/consult/logo/*', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="80"><rect width="24" height="80" fill="red"/></svg>',
      }),
    )
    await page.reload()
    await expect
      .poll(() =>
        page.locator('aside img').evaluate((element: HTMLImageElement) => element.naturalHeight),
      )
      .toBe(80)
    const tallBox = await page.locator('aside img').boundingBox()
    expect(tallBox!.width).toBe(38)
    expect(tallBox!.height).toBe(38)
    expect(
      await page.locator('aside img').evaluate((element) => getComputedStyle(element).objectFit),
    ).toBe('contain')
    await page.unroute('**/public/consult/logo/*')
    await consultation.close()
    const before = await (await page.request.get(api)).json()
    await input.setInputFiles({
      name: 'fake.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('not an image'),
    })
    await panel.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText('保存失败，请检查内容后重试。')).toBeVisible()
    expect((await (await page.request.get(api)).json()).logo_url).toBe(before.logo_url)
    await expect(page.locator('aside img')).toHaveAttribute('src', logo!)
  } finally {
    await page.request.put(api, {
      data: { ...original, service_catalog: JSON.parse(original.service_catalog) },
    })
  }
})

test('only disabled links can be deleted and cancellation sends no request', async ({ page }) => {
  await login(page)
  await page.goto('/park/admin/public-links')
  const channel = `delete-${Date.now()}`
  const label = `删除测试-${Date.now()}`
  await page.getByLabel('渠道代码').fill(channel)
  await page.getByLabel('渠道名称').fill(label)
  await page.getByRole('button', { name: '保存' }).click()
  const row = page
    .locator('[class*="listItem"]')
    .filter({ has: page.getByText(label, { exact: true }) })
  await expect(row).toBeVisible()
  await expect(row.getByRole('button', { name: '删除', exact: true })).toHaveCount(0)
  await row.getByRole('button', { name: '停用', exact: true }).click()
  const deletion = row.getByRole('button', { name: '删除', exact: true })
  await expect(deletion).toBeVisible()
  const requests: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'DELETE') requests.push(request.url())
  })
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain(label)
    await dialog.dismiss()
  })
  await deletion.click()
  expect(requests).toHaveLength(0)
  await expect(row).toBeVisible()
  const links = await (
    await page.request.get('/park/api/v1/parks/park-1/admin/public-links')
  ).json()
  const link = links.links.find((item: { channel: string }) => item.channel === channel)
  page.once('dialog', async (dialog) => {
    await page.request.post('/park/api/v1/parks/park-1/admin/public-links', {
      data: { channel, label, enabled: true },
    })
    await dialog.accept()
  })
  await deletion.click()
  await expect(page.getByText('链接已启用，请先停用再删除。')).toBeVisible()
  await expect(row.getByRole('button', { name: '删除', exact: true })).toHaveCount(0)
  expect(
    (await page.request.delete(`/park/api/v1/parks/park-1/admin/public-links/${link.id}`)).status(),
  ).toBe(409)
  await row.getByRole('button', { name: '停用', exact: true }).click()
  page.once('dialog', async (dialog) => {
    await dialog.accept()
  })
  await deletion.click()
  await expect(row).toHaveCount(0)
  expect((await page.request.get('/park/api/v1/parks/park-1/admin/public-links')).status()).toBe(
    200,
  )
  const consultation = await page.context().newPage()
  await consultation.goto(`/consult?channel=${channel}`)
  await expect(consultation.locator('#park-name')).toBeVisible()
  await consultation.close()
})

test('wiki source errors are retryable and late responses cannot replace the current selection', async ({
  page,
}) => {
  await login(page)
  await page.route('**/admin/policy/wikis', (route) =>
    route.fulfill({
      json: {
        wikis: [
          { id: 'first', name: 'First', buildStatus: 'succeeded', sourceDocumentIds: [] },
          { id: 'second', name: 'Second', buildStatus: 'succeeded', sourceDocumentIds: [] },
        ],
      },
    }),
  )
  let isFailing = true
  await page.route('**/admin/policy/wikis/*/sources', async (route) => {
    if (route.request().url().includes('/first/')) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      await route.fulfill({
        json: {
          record_status: 'available',
          sources: [
            {
              id: 'one',
              fileName: 'first.md',
              nodeName: 'First directory',
              sizeBytes: 8,
              status: 'available',
            },
          ],
        },
      })
    } else if (isFailing) await route.fulfill({ status: 500, json: {} })
    else
      await route.fulfill({
        json: {
          record_status: 'available',
          sources: [
            { id: 'two', fileName: null, nodeName: null, sizeBytes: null, status: 'unavailable' },
          ],
        },
      })
  })
  await page.goto('/park/admin/assistant')
  const select = page.getByRole('combobox', { name: '政策知识库 Wiki' })
  await select.selectOption('first')
  await select.selectOption('second')
  await expect(page.getByText('文件列表加载失败', { exact: true })).toBeVisible()
  await expect(page.getByText('已删除文件', { exact: true })).toHaveCount(0)
  isFailing = false
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByText('原文件名无法恢复')).toBeVisible()
  await expect(page.getByText('文件不可用', { exact: true })).toBeVisible()
  await expect(page.getByText('first.md', { exact: true })).toHaveCount(0)
})
