import { expect, test } from '@playwright/test'

const markdown =
  '# 政策说明\n\n**补贴重点**\n\n- 条件一\n- 条件二\n\n| 项目 | 金额 |\n| --- | --- |\n| 补贴 | 6000元 |\n\n```js\nconst value = 1\n```\n\n<script>window.untrustedExecuted = true</script>\n\n[危险链接](javascript:alert(1))'

for (const width of [1366, 375]) {
  test(`Markdown replies show each filename once without metadata and preserve preview at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    const base = {
      name: '政策.md',
      version: 'version-1',
      document_id: 'doc-a',
      wiki_id: 'wiki-a',
      source_id: 'source-a',
      preview_status: 'available',
    }
    const sources = [
      { name: '政策.md', version: 'old', section: '第 7 行' },
      { ...base, section: '第 1 行', ranges: [{ start: 1, end: 3 }] },
      { ...base, section: '第 3 行', ranges: [{ start: 3, end: 6 }] },
      { ...base, section: '第 8 行', ranges: [{ start: 8, end: 10 }] },
      {
        ...base,
        document_id: 'doc-b',
        source_id: 'source-b',
        section: '第 1 行',
        ranges: [{ start: 1, end: 1 }],
      },
      {
        ...base,
        version: 'version-2',
        source_id: 'source-version-2',
        section: '第 1 行、第 3 行、第 5 行、第 7 行',
        ranges: [1, 3, 5, 7].map((start) => ({ start, end: start })),
      },
      { name: '旧政策.md', version: 'old', section: '第 1 行' },
      { name: '旧政策.md', version: 'old', section: '第 1 行' },
      { name: '旧政策.md', version: 'old', section: '第 3 行' },
    ]
    await page.route('**/public/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/context'))
        await route.fulfill({
          json: {
            display_name: '测试园区',
            logo_url: null,
            welcome_text: '欢迎',
            contact_enabled: false,
            consent_text: '',
          },
        })
      else if (path.endsWith('/quick-questions')) await route.fulfill({ json: [] })
      else if (path.endsWith('/consult/sessions'))
        await route.fulfill({ json: { session_id: 'test-session' } })
      else if (path.endsWith('/status'))
        await route.fulfill({ json: { closed: false, closing_at: null } })
      else if (path.endsWith('/preview'))
        await route.fulfill({
          json: {
            name: '政策.md',
            version: 'version-1',
            markdown,
            ranges: [
              { start: 1, end: 6 },
              { start: 8, end: 10 },
            ],
          },
        })
      else if (path.endsWith('/messages') && route.request().method() === 'POST') {
        const body = [
          'event: delta',
          `data: ${JSON.stringify({ text: markdown.slice(0, 20) })}`,
          '',
          'event: delta',
          `data: ${JSON.stringify({ text: markdown.slice(20) })}`,
          '',
          'event: sources',
          `data: ${JSON.stringify(sources)}`,
          '',
          'event: done',
          'data: {}',
          '',
          '',
        ].join('\n')
        await route.fulfill({ contentType: 'text/event-stream', body })
      } else await route.fulfill({ json: [] })
    })
    await page.goto('/consult')
    await page.locator('#question-input').fill('查看政策')
    await page.locator('#question-input').press('Enter')
    const reply = page.locator('.assistant-message .message-body')
    await expect(reply.getByRole('heading', { name: '政策说明' })).toBeVisible()
    await expect(reply.locator('strong')).toHaveText('补贴重点')
    await expect(reply.locator('li')).toHaveCount(2)
    await expect(reply.locator('table')).toBeVisible()
    await expect(reply.locator('pre code')).toContainText('const value = 1')
    const visitorFont = await page.locator('.user-message .message-body').evaluate((element) => ({
      family: getComputedStyle(element).fontFamily,
      size: Number.parseFloat(getComputedStyle(element).fontSize),
    }))
    const assistantFont = await reply.evaluate((element) => ({
      family: getComputedStyle(element).fontFamily,
      size: Number.parseFloat(getComputedStyle(element).fontSize),
    }))
    expect(assistantFont.family).toBe(visitorFont.family)
    expect(assistantFont.size).toBe(visitorFont.size)
    const contentFonts = await reply.locator('h1, p, li, th, td, code').evaluateAll((elements) =>
      elements.map((element) => ({
        family: getComputedStyle(element).fontFamily,
        size: Number.parseFloat(getComputedStyle(element).fontSize),
      })),
    )
    expect(
      contentFonts.every(
        (font) => font.family === visitorFont.family && font.size === visitorFont.size,
      ),
    ).toBe(true)
    expect(
      await reply.locator('pre code').evaluate((element) => getComputedStyle(element).fontFamily),
    ).toBe(visitorFont.family)
    await expect(reply.locator('script')).toHaveCount(0)
    expect(await page.evaluate(() => 'untrustedExecuted' in window)).toBe(false)
    expect(await reply.getByText('危险链接').getAttribute('href')).toBe('')
    await expect(page.locator('.policy-source')).toHaveCount(2)
    const card = page.locator('.policy-source').first()
    await expect(card).toHaveText('▤检索来源政策.md')
    await expect(page.locator('.policy-source').last()).toHaveText('▤检索来源旧政策.md')
    await expect(page.locator('.message-sources')).not.toContainText('version-')
    await expect(page.locator('.message-sources')).not.toContainText('相关位置')
    await expect(page.locator('.message-sources')).not.toContainText('第 7 行')
    await expect(page.locator('.message-sources')).not.toContainText('历史来源')
    const open = card.getByRole('button', { name: /政策.md/ })
    await expect(page.locator('.policy-source').last()).toBeInViewport()
    await open.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: '政策说明' })).toBeVisible()
    await expect(dialog.locator('.is-referenced')).not.toHaveCount(0)
    await dialog.getByRole('button', { name: '第 8—10 行', exact: true }).click()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1)
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(open).toBeFocused()
    await page.route('**/sources/source-a/preview', (route) =>
      route.fulfill({ status: 503, json: { error: 'SOURCE_PREVIEW_UNAVAILABLE' } }),
    )
    await open.click()
    await expect(page.getByRole('dialog').getByRole('status')).toHaveText('该来源正文暂不可预览。')
    await page.getByRole('button', { name: '关闭正文预览' }).click()
  })
}

test('real Park proxy previews a session-associated source and rejects another visitor', async ({
  browser,
}) => {
  const owner = await browser.newContext()
  const other = await browser.newContext()
  try {
    const page = await owner.newPage()
    await page.goto('/consult')
    await page.locator('#question-input').fill('有哪些政策')
    await page.locator('#question-input').press('Enter')
    const button = page.locator('.policy-source').getByRole('button', { name: /算力政策.md/ })
    await expect(button).toBeVisible()
    const responsePromise = page.waitForResponse((response) => response.url().endsWith('/preview'))
    await button.click()
    const response = await responsePromise
    expect(response.status()).toBe(200)
    await expect(page.locator('.source-preview-body')).toContainText('算力服务可申请')
    expect((await other.request.get(response.url())).status()).toBe(401)
  } finally {
    await owner.close()
    await other.close()
  }
})
