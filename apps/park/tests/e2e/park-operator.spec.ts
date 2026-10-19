import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

const parkUrl = `http://127.0.0.1:${process.env.PARK_E2E_PORT ?? '4176'}`
const parkApi = `${parkUrl}/park/api/v1/parks/park-1`

test('operator policy and quick-question changes reach public consultation', async ({
  browser,
}) => {
  const operator = await browser.newContext()
  const publicVisitor = await browser.newContext()
  const title = '浏览器写入算力政策'
  const question = '浏览器写入算力问题？'
  let policyId: string | undefined
  let questionId: string | undefined
  try {
    const admin = await operator.newPage()
    await admin.goto(`${parkUrl}/park/login`)
    await admin.getByLabel('账号').fill('operator')
    await admin.getByLabel('密码').fill('park-test-password')
    await admin.getByRole('button', { name: '进入园区管理' }).click()
    await expect(admin).toHaveURL(`${parkUrl}/park/admin/policies`)

    const policyForm = admin.getByRole('heading', { name: '上传新版本' }).locator('..')
    await policyForm.getByLabel('名称').fill(title)
    await policyForm.getByLabel('版本').fill('v-test')
    await policyForm.getByLabel('条款位置').fill('测试条款')
    await policyForm.getByLabel('生效开始').fill('2020-01-01')
    await policyForm.getByLabel('政策条款内容').fill('算力可申请浏览器写入校验服务。')
    await policyForm.getByRole('button', { name: '新建' }).click()
    const row = admin.getByRole('row').filter({ hasText: title })
    await expect(row).toBeVisible()
    const policies = (await (
      await admin.request.get(`${parkApi}/admin/policies`)
    ).json()) as Array<{
      id: string
      title: string
      status: string
    }>
    policyId = policies.find((item) => item.title === title)?.id
    expect(policyId).toBeTruthy()
    await row.getByRole('button', { name: '发布' }).click()
    await expect(row).toContainText('已发布')

    const visitor = await publicVisitor.newPage()
    await visitor.goto(`${parkUrl}/consult`)
    await visitor.locator('#question-input').fill('园区算力服务如何申请？')
    await visitor.getByRole('button', { name: /发送问题/ }).click()
    await expect(visitor.getByText(/浏览器写入校验服务/)).toBeVisible()
    await expect(visitor.getByText(title, { exact: true })).toBeVisible()

    await row.getByRole('button', { name: '下线' }).click()
    await expect(row).toContainText('已下线')
    const afterOffline = await visitor.request.get(`${parkUrl}/public/consult/context`)
    expect(afterOffline.status()).toBe(200)
    const published = (await (
      await admin.request.get(`${parkApi}/admin/policies`)
    ).json()) as Array<{
      id: string
      status: string
    }>
    expect(published.find((item) => item.id === policyId)?.status).toBe('offline')
    const afterPublish = await publicVisitor.newPage()
    await afterPublish.goto(`${parkUrl}/consult`)
    await afterPublish.locator('#question-input').fill('园区算力服务如何申请？')
    await afterPublish.getByRole('button', { name: /发送问题/ }).click()
    await expect(afterPublish.getByText(/算力服务可申请/)).toBeVisible()
    await expect(afterPublish.getByText(title, { exact: true })).toHaveCount(0)

    await admin.goto(`${parkUrl}/park/admin/quick-questions`)
    const questionForm = admin.getByRole('heading', { name: '新建' }).locator('..')
    await questionForm.getByLabel('问题').fill(question)
    await questionForm.getByLabel('排序').fill('2')
    await questionForm.getByRole('button', { name: '保存' }).click()
    await expect(admin.getByText(question, { exact: true })).toBeVisible()
    const questions = (await (
      await admin.request.get(`${parkApi}/admin/quick-questions`)
    ).json()) as Array<{
      id: string
      question: string
    }>
    questionId = questions.find((item) => item.question === question)?.id
    expect(questionId).toBeTruthy()
    await visitor.reload()
    await expect(visitor.getByRole('button', { name: question })).toBeVisible()

    await admin
      .getByText(question, { exact: true })
      .locator('..')
      .getByRole('button', { name: '编辑' })
      .click()
    const editForm = admin.getByRole('heading', { name: '编辑' }).locator('..')
    await editForm.getByLabel('排序').fill('3')
    await editForm.getByLabel('启用').uncheck()
    await editForm.getByRole('button', { name: '保存' }).click()
    await expect(admin.getByText(question, { exact: true }).locator('..')).toContainText('停用')
    await visitor.reload()
    await expect(visitor.getByRole('button', { name: question })).toHaveCount(0)
  } finally {
    if (policyId)
      await operator.request.patch(`${parkApi}/admin/policies/${policyId}/status`, {
        data: { status: 'offline' },
      })
    if (questionId) await operator.request.delete(`${parkApi}/admin/quick-questions/${questionId}`)
    await publicVisitor.close()
    await operator.close()
  }
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
