import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(process.argv[2] ?? '')
const phase = process.argv[3] ?? 'all'
if (!root)
  throw new Error('Usage: node initialize-acceptance.mjs <acceptance-root> <bootstrap|park>')
const file = resolve(root, 'acceptance.json')
const settings = JSON.parse(
  await readFile(file, 'utf8').then((value) => value.replace(/^\uFEFF/, '')),
)
const mossUrl = process.env.PARK_ACCEPTANCE_MOSS_URL ?? 'http://127.0.0.1:4174'
const stubUrl = process.env.PARK_ACCEPTANCE_STUB_URL ?? 'http://127.0.0.1:4180/v1'

async function request(path, init = {}) {
  const response = await fetch(`${mossUrl}${path}`, init)
  const text = await response.text()
  let body = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    /* Retain text for diagnostics. */
  }
  if (!response.ok)
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status}: ${text}`)
  return body
}

const issued = await request('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(settings.admin),
})
const headers = {
  authorization: `Bearer ${issued.access_token}`,
  'content-type': 'application/json',
}

if (phase === 'bootstrap' || phase === 'all') {
  settings.orgId = issued.user.orgId
  settings.adminUserId = issued.user.id
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  await request('/api/v1/settings/system', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      model: 'park-acceptance',
      apiKey: 'park-local-acceptance-key',
      defaultModelProviderId: 'legacy-default',
      modelProviders: [
        {
          id: 'legacy-default',
          name: 'Park acceptance scripted model',
          kind: 'openai-compatible',
          baseUrl: stubUrl,
          discoveryUrl: `${stubUrl}/models`,
          protocol: 'openai-completions',
          enabled: true,
        },
      ],
    }),
  })
  const wanted = [
    ['park-leader', 'parkleader'],
    ['park-recruiter', 'parkrecruiter'],
    ['park-operator', 'parkoperator'],
  ]
  const listed = await request('/api/v1/users', { headers })
  let users = Array.isArray(listed) ? listed : listed.users
  if (!Array.isArray(users)) throw new Error('GET /api/v1/users did not return a users array')
  for (const [name, key] of wanted) {
    if (!users.some((user) => user.name === name)) {
      await request('/api/v1/users', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name,
          email: `${name}@acceptance.local`,
          password: settings.userPassword,
          role: 'user',
        }),
      })
      const refreshed = await request('/api/v1/users', { headers })
      users = Array.isArray(refreshed) ? refreshed : refreshed.users
      if (!Array.isArray(users)) throw new Error('GET /api/v1/users did not return a users array')
    }
    settings[key] = users.find((user) => user.name === name)?.id ?? ''
    if (!settings[key]) throw new Error(`Unable to resolve ${name}`)
  }
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}

if (phase === 'park' || phase === 'all') {
  const parkBase = `/api/v1/parks/${encodeURIComponent(settings.orgId)}`
  const roles = [
    [settings.adminUserId, 'park_system_operator'],
    [settings.parkleader, 'park_leader'],
    [settings.parkrecruiter, 'park_recruiter'],
    [settings.parkoperator, 'park_system_operator'],
  ]
  for (const [userId, parkRole] of roles) {
    await request(`${parkBase}/roles/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ park_role: parkRole }),
    })
  }
  await request(`${parkBase}/admin/config`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      display_name: '本地验收园区',
      welcome_text: '欢迎咨询园区入驻、场地与算力政策。',
      park_profile: '本地验收环境园区。',
      service_catalog: ['入驻咨询', '场地对接', '算力服务'],
      service_catalog_version: 'acceptance-v1',
      contact_enabled: true,
      consent_text: '本园区仅为招商对接目的处理您主动提交的联系方式。',
    }),
  })
  const existing = await request(`${parkBase}/admin/quick-questions`, { headers })
  const questions = [
    '企业入驻需要什么条件？',
    '有哪些算力支持？',
    '园区有哪些产业服务？',
    '如何预约园区考察？',
  ]
  for (const [index, question] of questions.entries()) {
    if (existing.some((item) => item.question === question)) continue
    await request(`${parkBase}/admin/quick-questions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ question, sort_order: index + 1, enabled: true }),
    })
  }
}

process.stdout.write(`PARK_ACCEPTANCE_INITIALIZED:${phase}\n`)
