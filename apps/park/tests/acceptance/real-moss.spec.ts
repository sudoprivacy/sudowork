import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { expect, test, type APIRequestContext } from '@playwright/test'

const acceptanceFile = process.env.PARK_ACCEPTANCE_FILE
if (!acceptanceFile) throw new Error('PARK_ACCEPTANCE_FILE must point to the local acceptance.json')
const acceptance = JSON.parse(readFileSync(acceptanceFile, 'utf8').replace(/^\uFEFF/, '')) as {
  orgId: string
  userPassword: string
  parkrecruiter: string
  admin: { username: string; password: string }
}
const parkUrl = process.env.PARK_ACCEPTANCE_URL ?? 'http://127.0.0.1:4176'
const mossUrl = process.env.MOSS_ACCEPTANCE_URL ?? 'http://127.0.0.1:4174'
const parkApi = `${parkUrl}/park/api/v1/parks/${encodeURIComponent(acceptance.orgId)}`
const smsLogPath = resolve(dirname(acceptanceFile), 'moss-console.log')
const modelLogPath = resolve(dirname(acceptanceFile), 'model-stub-calls.jsonl')
const mossDbPath = resolve(dirname(acceptanceFile), 'moss.db')

function withMossDb<T>(read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(mossDbPath, { readOnly: true })
  try { return read(db) } finally { db.close() }
}

function countBy(db: DatabaseSync, table: string, where = '', params: Array<string | number> = []): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE org_id = ? ${where}`)
    .get(acceptance.orgId, ...params) as { count: number }).count)
}

function readSmsLog(): string {
  const bytes = readFileSync(smsLogPath)
  return bytes[0] === 0xff && bytes[1] === 0xfe
    ? bytes.toString('utf16le')
    : bytes.toString('utf8')
}

async function createPublicSession(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${parkUrl}/public/consult/sessions`, { data: {} })
  expect(response.status()).toBe(201)
  expect(response.headers()['set-cookie']).toMatch(/HttpOnly.*SameSite=Lax.*Path=\/public/)
  return ((await response.json()) as { session_id: string }).session_id
}

async function ask(request: APIRequestContext, sessionId: string, message: string, requestId = randomUUID()) {
  const response = await request.post(`${parkUrl}/public/sessions/${sessionId}/messages`, {
    data: { message, client_request_id: requestId },
  })
  expect(response.status()).toBe(200)
  const raw = await response.text()
  expect(raw).toContain('event: done')
  const answer = [...raw.matchAll(/event: delta\r?\ndata: ([^\r\n]+)/g)]
    .map((match) => (JSON.parse(match[1]!) as { text: string }).text)
    .join('')
  const sourceLine = /event: sources\r?\ndata: ([^\r\n]+)/.exec(raw)?.[1]
  const sources = JSON.parse(sourceLine ?? '[]') as Array<{ name: string; version: string; section: string }>
  return { answer, sources }
}

async function login(request: APIRequestContext, username: string): Promise<void> {
  const response = await request.post(`${parkUrl}/park/api/auth/login/password`, {
    data: { username, password: acceptance.userPassword },
  })
  expect(response.status()).toBe(200)
}

test('real Moss and Park provide grounded public answers and persist one inquiry per request', async ({
  browser,
  request,
}) => {
  expect((await request.get(`${mossUrl}/readyz`)).status()).toBe(200)
  expect((await request.get(`${parkUrl}/consult`)).status()).toBe(200)
  const context = await request.get(`${parkUrl}/public/consult/context`)
  expect(context.status()).toBe(200)
  expect(await context.text()).not.toMatch(/org_id|access_token|api_key/)
  expect((await context.json() as { published_policy_version: string }).published_policy_version)
    .toBe('acceptance-v1')
  const quickQuestions = await request.get(`${parkUrl}/public/consult/quick-questions`)
  expect((await quickQuestions.json() as unknown[]).length).toBeGreaterThanOrEqual(4)

  const sessionId = await createPublicSession(request)
  const modelCallsBefore = readFileSync(modelLogPath, 'utf8').trim().split('\n').length
  const requestId = randomUUID()
  const first = await ask(request, sessionId, '企业入驻需要什么条件？', requestId)
  expect(first.answer).toContain('本地验收模型替身依据公开资料回答')
  expect(first.answer).not.toMatch(/必然获批|确定补贴金额|过期内容|草稿内容/)
  expect(first.sources).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: '本地验收入驻服务说明', version: 'acceptance-v1', section: '第一条' }),
  ]))
  expect(first.sources.every((source) => !['acceptance-expired', 'acceptance-draft'].includes(source.version)))
    .toBe(true)
  expect(readFileSync(modelLogPath, 'utf8').trim().split('\n').length).toBe(modelCallsBefore + 1)
  expect((await ask(request, sessionId, '企业入驻需要什么条件？', requestId)).answer).toBe(first.answer)
  const persisted = await request.get(`${parkUrl}/public/sessions/${sessionId}/messages`)
  expect((await persisted.json() as unknown[]).length).toBe(1)
  withMossDb((db) => {
    const inquiry = db.prepare('SELECT redacted_question, source_refs_json FROM park_inquiries WHERE org_id = ? AND session_id = ? AND client_request_id = ?')
      .get(acceptance.orgId, sessionId, requestId) as { redacted_question: string; source_refs_json: string }
    expect(inquiry.redacted_question).toBe('企业入驻需要什么条件？')
    expect(JSON.parse(inquiry.source_refs_json)).toEqual(first.sources)
    expect(countBy(db, 'park_inquiries', 'AND session_id = ? AND client_request_id = ?', [sessionId, requestId])).toBe(1)
  })

  const noBasis = await ask(request, sessionId, '火星天气如何？')
  expect(noBasis.answer).toContain('暂未找到确定依据')
  expect(noBasis.sources).toEqual([])
  const greeting = await ask(request, sessionId, '你好')
  expect(greeting.answer).toContain('请直接描述想咨询的事项')
  expect(greeting.sources).toEqual([])
  for (const quick of await quickQuestions.json() as Array<{ question: string }>) {
    const result = await ask(request, sessionId, quick.question)
    expect(result.answer, quick.question).not.toContain('暂未找到确定依据')
    expect(result.sources.length, quick.question).toBeGreaterThan(0)
  }

  const visitor = await browser.newContext({ viewport: { width: 375, height: 812 } })
  try {
    const page = await visitor.newPage()
    await page.goto(`${parkUrl}/consult`)
    await expect(page.locator('#question-input')).toBeVisible()
    await expect(page.locator('#question-chips button')).toHaveCount(4)
    await page.locator('#question-input').fill('企业入驻需要什么条件？')
    await page.getByRole('button', { name: /发送问题/ }).click()
    await expect(page.getByText(/本地验收模型替身依据公开资料回答/)).toBeVisible()
    await expect(page.getByText('本地验收入驻服务说明', { exact: true })).toBeVisible()
    await expect(page.locator('#contact-section')).toBeHidden()
    await page.locator('#open-contact').click()
    await expect(page.locator('#contact-section')).toBeVisible()
  } finally {
    await visitor.close()
  }
})

test('real Moss routes a contacted lead through recruiter and leader views', async ({ browser }) => {
  const visitor = await browser.newContext()
  const recruiter = await browser.newContext()
  const leader = await browser.newContext()
  try {
    const sessionId = await createPublicSession(visitor.request)
    await ask(visitor.request, sessionId, '我们是人工智能企业，下个月需要 200 平米场地和算力支持，计划入驻。')
    await login(recruiter.request, 'park-recruiter')
    let leadId = ''
    await expect.poll(async () => {
      const rows = await (await recruiter.request.get(`${parkApi}/leads`)).json() as Array<{
        id: string; source_session_id: string; has_contact: boolean
      }>
      const lead = rows.find((item) => item.source_session_id === sessionId)
      leadId = lead?.id ?? ''
      return lead?.has_contact
    }).toBe(false)
    const contact = await visitor.request.post(`${parkUrl}/public/sessions/${sessionId}/contact`, {
      data: { name: '本地验收用户', email: `acceptance-${randomUUID()}@example.com`, consent: true },
    })
    expect(contact.status()).toBe(201)
    withMossDb((db) => {
      const lead = db.prepare('SELECT score, tags_json, suggested_action, contact_status FROM park_leads WHERE org_id = ? AND id = ?')
        .get(acceptance.orgId, leadId) as { score: number; tags_json: string; suggested_action: string; contact_status: string }
      const saved = db.prepare('SELECT consent_text, consent_at, retention_until, email, phone_verified_at FROM park_contacts WHERE org_id = ? AND lead_id = ?')
        .get(acceptance.orgId, leadId) as { consent_text: string; consent_at: number; retention_until: number; email: string; phone_verified_at: number | null }
      expect(lead.score).toBeGreaterThanOrEqual(40)
      expect(JSON.parse(lead.tags_json)).toBeInstanceOf(Array)
      expect(lead.suggested_action.length).toBeGreaterThan(0)
      expect(lead.contact_status).toBe('submitted')
      expect(saved.email).toMatch(/^acceptance-/)
      expect(saved.phone_verified_at).toBeNull()
      expect(saved.consent_text).toContain('同意')
      expect(saved.retention_until - saved.consent_at).toBeGreaterThanOrEqual(179 * 86_400_000)
    })
    await expect.poll(async () => {
      const rows = await (await recruiter.request.get(`${parkApi}/leads`)).json() as Array<{
        id: string; has_contact: boolean
      }>
      return rows.find((item) => item.id === leadId)?.has_contact
    }).toBe(true)
    expect((await recruiter.request.post(`${parkApi}/leads/${leadId}/claim`, { data: {} })).status()).toBe(200)
    expect((await recruiter.request.post(`${parkApi}/leads/${leadId}/follow-ups`, {
      data: { note: '本地验收跟进记录' },
    })).status()).toBe(201)
    expect((await recruiter.request.patch(`${parkApi}/leads/${leadId}`, {
      data: { status: 'converted' },
    })).status()).toBe(200)
    expect((await (await recruiter.request.get(`${parkApi}/leads/${leadId}`)).json() as { status: string }).status)
      .toBe('converted')
    withMossDb((db) => {
      const lead = db.prepare('SELECT owner_id, status FROM park_leads WHERE org_id = ? AND id = ?')
        .get(acceptance.orgId, leadId) as { owner_id: string; status: string }
      expect(lead.owner_id).toBe(acceptance.parkrecruiter)
      expect(lead.status).toBe('converted')
      expect(countBy(db, 'park_follow_ups', 'AND lead_id = ?', [leadId])).toBe(1)
      const audited = db.prepare('SELECT COUNT(*) AS count FROM operation_audit_events WHERE org_id = ? AND path LIKE ? AND response_status < 400')
        .get(acceptance.orgId, `%/leads/${leadId}/%`) as { count: number }
      expect(audited.count).toBeGreaterThanOrEqual(2)
    })
    await login(leader.request, 'park-leader')
    const metrics = await (await leader.request.get(`${parkApi}/metrics`)).json() as {
      cards: { contacted_leads: number; converted_leads: number }
    }
    expect(metrics.cards.contacted_leads).toBeGreaterThanOrEqual(1)
    expect(metrics.cards.converted_leads).toBeGreaterThanOrEqual(1)
    const summary = await (await leader.request.get(`${parkApi}/leads/summary`)).json() as {
      distribution: { converted: number }
    }
    expect(summary.distribution.converted).toBeGreaterThanOrEqual(1)
  } finally {
    await Promise.all([visitor.close(), recruiter.close(), leader.close()])
  }
})

test('real Moss logs and verifies a phone code before accepting contact', async ({ browser }) => {
  const visitor = await browser.newContext()
  try {
    const sessionId = await createPublicSession(visitor.request)
    await ask(visitor.request, sessionId, '需要入驻咨询。')
    const phone = `139${String(Date.now()).slice(-8)}`
    const contactUrl = `${parkUrl}/public/sessions/${sessionId}/contact`
    expect((await visitor.request.post(contactUrl, { data: { phone, consent: true } })).status()).toBe(409)
    const logLength = readSmsLog().length
    const codeUrl = `${parkUrl}/public/sessions/${sessionId}/contact-code`
    expect((await visitor.request.post(codeUrl, { data: { phone } })).status()).toBe(200)
    let code = ''
    await expect.poll(() => {
      const tail = readSmsLog().slice(logLength)
      code = /verification code for .*? is (\d{6})/.exec(tail)?.[1] ?? ''
      return code.length
    }).toBe(6)
    expect((await visitor.request.post(`${codeUrl}/verify`, { data: { phone, code } })).status()).toBe(200)
    expect((await visitor.request.post(contactUrl, {
      data: { phone, consent: true, name: '短信验收用户' },
    })).status()).toBe(201)
    withMossDb((db) => {
      const contact = db.prepare('SELECT c.phone_verified_at, l.contact_status FROM park_contacts c JOIN park_leads l ON l.id = c.lead_id WHERE l.org_id = ? AND l.source_session_id = ?')
        .get(acceptance.orgId, sessionId) as { phone_verified_at: number; contact_status: string }
      expect(contact.phone_verified_at).toBeGreaterThan(0)
      expect(contact.contact_status).toBe('verified')
    })
  } finally {
    await visitor.close()
  }
})

test('all park roles render their pages while server authorization blocks cross-role access', async ({ browser, request }) => {
  expect((await request.get(`${parkApi}/leads`)).status()).toBe(401)
  expect((await request.get(`${mossUrl}/api/v1/parks/${acceptance.orgId}/leads`)).status()).toBe(401)
  expect((await request.get(`${parkUrl}/guid`)).status()).toBe(404)
  const adminLogin = await request.post(`${parkUrl}/park/api/auth/login/password`, {
    data: { username: acceptance.admin.username, password: acceptance.admin.password },
  })
  expect(adminLogin.status()).toBe(403)

  const groups = [
    { user: 'park-leader', landing: '/park/overview', forbidden: '/leads', pages: [
      ['/park/overview', '经营总览'], ['/park/leads/summary', '线索汇总'],
      ['/park/reports', '领导月报'], ['/park/compliance/summary', '合规概览'],
    ] },
    { user: 'park-recruiter', landing: '/park/leads', forbidden: '/admin/config', pages: [
      ['/park/leads', '招商线索'], ['/park/follow-ups', '我的跟进'],
    ] },
    { user: 'park-operator', landing: '/park/admin/policies', forbidden: '/metrics', pages: [
      ['/park/admin/policies', '政策管理'], ['/park/admin/quick-questions', '快捷问题'],
      ['/park/admin/assistant', 'Assistant 管理'], ['/park/admin/public-links', '公开链接'],
      ['/park/admin/rate-limits', '限流配置'], ['/park/admin/audit', '审计与脱敏'],
      ['/park/admin/operations', '盒子运维'],
    ] },
  ] as const
  for (const group of groups) {
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`${parkUrl}/park/login`)
      await page.getByLabel('账号').fill(group.user)
      await page.getByLabel('密码').fill(acceptance.userPassword)
      await page.getByRole('button', { name: '进入园区管理' }).click()
      await expect(page).toHaveURL(`${parkUrl}${group.landing}`)
      expect((await context.request.get(`${parkApi}${group.forbidden}`)).status()).toBe(403)
      for (const [path, title] of group.pages) {
        await page.goto(`${parkUrl}${path}`)
        await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible()
        await expect(page.getByText('数据加载失败，请稍后重试。')).toHaveCount(0)
      }
      expect(errors).toEqual([])
    } finally {
      await context.close()
    }
  }
  const operator = await browser.newContext()
  const leader = await browser.newContext()
  try {
    await login(operator.request, 'park-operator')
    await login(leader.request, 'park-leader')
    const auditResponse = await operator.request.get(`${parkApi}/admin/audit-events`)
    expect(auditResponse.status()).toBe(200)
    const audit = await auditResponse.json() as Array<{ path: string; response_status: number }>
    expect(audit.some((row) => row.path.endsWith('/leads') && row.response_status === 401)).toBe(true)
    expect(audit.some((row) => row.path.endsWith('/leads') && row.response_status === 403)).toBe(true)
    const compliance = await (await leader.request.get(`${parkApi}/compliance/summary`)).json() as {
      audit_failures: { total: number; auth_rejections: number }
    }
    withMossDb((db) => {
      expect(compliance.audit_failures.total).toBe(countBy(db, 'operation_audit_events', 'AND response_status >= 400'))
      expect(compliance.audit_failures.auth_rejections).toBe(countBy(db, 'operation_audit_events', 'AND response_status IN (401, 403)'))
    })
  } finally { await Promise.all([operator.close(), leader.close()]) }
})

test('real Moss persists redaction, rejection reasons and four compliance measures', async ({ browser }) => {
  const visitor = await browser.newContext()
  const operator = await browser.newContext()
  const leader = await browser.newContext()
  let originalRate: Record<string, unknown> | null = null
  try {
    const sessionId = await createPublicSession(visitor.request)
    const phone = `138${String(Date.now()).slice(-8)}`
    await ask(visitor.request, sessionId, `企业入驻需要什么条件？请联系 ${phone} 或 acceptance@example.com`)
    withMossDb((db) => {
      const row = db.prepare('SELECT redacted_question FROM park_inquiries WHERE org_id = ? AND session_id = ?')
        .get(acceptance.orgId, sessionId) as { redacted_question: string }
      expect(row.redacted_question).toContain('[手机号]')
      expect(row.redacted_question).toContain('[邮箱]')
      expect(row.redacted_question).not.toContain(phone)
      expect(row.redacted_question).not.toContain('acceptance@example.com')
    })
    await login(operator.request, 'park-operator')
    await login(leader.request, 'park-leader')
    const rateUrl = `${parkApi}/admin/rate-limits`
    originalRate = (await (await operator.request.get(rateUrl)).json() as { value: Record<string, unknown> }).value
    const setRate = async (value: Record<string, unknown>) => {
      const response = await operator.request.put(rateUrl, { data: { value } })
      expect(response.status()).toBe(200)
    }
    const permissive = { ...originalRate, box_per_minute: 100000, ip_per_minute: 100000, subnet_per_minute: 100000 }
    await setRate({ ...permissive, message_max_length: 10 })
    const messageUrl = `${parkUrl}/public/sessions/${sessionId}/messages`
    const postMessage = (message: string) => visitor.request.post(messageUrl, { data: { message, client_request_id: randomUUID() } })
    expect((await postMessage('这条消息明显超过十个字的限制')).status()).toBe(413)
    await setRate({ ...permissive, blacklist_ips: ['127.0.0.1'] })
    const blacklisted = await postMessage('入驻')
    expect(blacklisted.status()).toBe(429)
    expect(blacklisted.headers()['retry-after']).toBe('60')
    await setRate({ ...permissive, ip_per_minute: 1, blacklist_ips: [] })
    expect((await postMessage('入驻')).status()).toBe(429)
    await setRate({ ...permissive, box_per_minute: 1, blacklist_ips: [] })
    expect((await postMessage('入驻')).status()).toBe(429)
    withMossDb((db) => {
      const rows = db.prepare('SELECT reason, response_status FROM park_rejection_hits WHERE org_id = ? AND session_id = ?')
        .all(acceptance.orgId, sessionId) as Array<{ reason: string; response_status: number }>
      expect(rows).toEqual(expect.arrayContaining([
        { reason: 'message_too_long', response_status: 413 },
        { reason: 'blacklist', response_status: 429 },
        { reason: 'ip_rate', response_status: 429 },
        { reason: 'box_rate', response_status: 429 },
      ]))
    })
    await setRate(originalRate)
    const summary = await (await leader.request.get(`${parkApi}/compliance/summary`)).json() as {
      session_risk: Record<string, number>
      rejection_hits: { by_reason: Record<string, number>; by_status: Record<string, number> }
      audit_failures: { total: number; auth_rejections: number }
      contact_retention: { expired: number; expiring_soon: number }
    }
    withMossDb((db) => {
      expect(summary.session_risk.normal).toBe(countBy(db, 'park_sessions', "AND risk_state = 'normal'"))
      for (const reason of ['message_too_long', 'blacklist', 'ip_rate', 'box_rate']) {
        expect(summary.rejection_hits.by_reason[reason]).toBe(countBy(db, 'park_rejection_hits', 'AND reason = ?', [reason]))
      }
      expect(summary.rejection_hits.by_status['413']).toBe(countBy(db, 'park_rejection_hits', 'AND response_status = 413'))
      expect(summary.rejection_hits.by_status['429']).toBe(countBy(db, 'park_rejection_hits', 'AND response_status = 429'))
      expect(summary.audit_failures.total).toBe(countBy(db, 'operation_audit_events', 'AND response_status >= 400'))
      expect(summary.audit_failures.auth_rejections).toBe(countBy(db, 'operation_audit_events', 'AND response_status IN (401, 403)'))
      const now = Date.now()
      expect(summary.contact_retention.expired).toBe(countBy(db, 'park_contacts', 'AND retention_until < ?', [now]))
      expect(summary.contact_retention.expiring_soon).toBe(countBy(db, 'park_contacts', 'AND retention_until >= ? AND retention_until <= ?', [now, now + 30 * 86_400_000]))
    })
  } finally {
    if (originalRate) await operator.request.put(`${parkApi}/admin/rate-limits`, { data: { value: originalRate } })
    await Promise.all([visitor.close(), operator.close(), leader.close()])
  }
})

test('real Moss serves a CAPTCHA challenge after the configured visitor threshold', async ({ browser }) => {
  const visitor = await browser.newContext()
  const operator = await browser.newContext()
  let originalRate: Record<string, unknown> | null = null
  try {
    const sessionId = await createPublicSession(visitor.request)
    await login(operator.request, 'park-operator')
    const rateUrl = `${parkApi}/admin/rate-limits`
    originalRate = (await (await operator.request.get(rateUrl)).json() as { value: Record<string, unknown> }).value
    const configured = await operator.request.put(rateUrl, { data: { value: {
      ...originalRate, box_per_minute: 100000, ip_per_minute: 1, subnet_per_minute: 100000,
      captcha_enabled: true, blacklist_ips: [],
    } } })
    expect(configured.status()).toBe(200)
    const postMessage = () => visitor.request.post(`${parkUrl}/public/sessions/${sessionId}/messages`, {
      data: { message: '入驻', client_request_id: randomUUID() },
    })
    let message = await postMessage()
    if (message.status() === 200) message = await postMessage()
    expect(message.status()).toBe(429)
    expect(await message.text()).toContain('CAPTCHA_REQUIRED')
    const challenge = await visitor.request.get(`${parkUrl}/public/sessions/${sessionId}/challenge`)
    expect(challenge.status()).toBe(200)
    expect((await challenge.json() as { image: string }).image).toMatch(/^data:image\/png;base64,/)
    withMossDb((db) => {
      const session = db.prepare('SELECT risk_state FROM park_sessions WHERE org_id = ? AND id = ?')
        .get(acceptance.orgId, sessionId) as { risk_state: string }
      expect(session.risk_state).toBe('challenge_required')
      expect(countBy(db, 'park_rejection_hits', "AND session_id = ? AND reason = 'ip_rate'", [sessionId])).toBeGreaterThanOrEqual(1)
    })
  } finally {
    if (originalRate) await operator.request.put(`${parkApi}/admin/rate-limits`, { data: { value: originalRate } })
    await Promise.all([visitor.close(), operator.close()])
  }
})
