import { describe, expect, test, vi } from 'vitest'
import { createMossAgentPort } from '@sudowork/moss-client'
import { createMossSkillPort } from '@sudowork/moss-client'

const BASE = 'http://moss.test'
const TK = 'tk'

describe('MossAgentPort request shapes（修订版 3.9：agent-hub 前缀）', () => {
  test('hub endpoints use /api/v1/agent-hub/* prefix', async () => {
    const mock = vi.fn().mockResolvedValue({})
    const port = createMossAgentPort(mock, BASE)
    await port.hubCategories(TK)
    await port.hubList(TK, { limit: '20' })
    await port.hubDetail(TK, 'a1')
    expect(mock).toHaveBeenNthCalledWith(1, BASE, {
      method: 'GET',
      path: '/api/v1/agent-hub/categories',
      accessToken: TK,
    })
    expect(mock).toHaveBeenNthCalledWith(2, BASE, {
      method: 'GET',
      path: '/api/v1/agent-hub/assistants/cursor',
      accessToken: TK,
      searchParams: { limit: '20' },
    })
    expect(mock).toHaveBeenNthCalledWith(3, BASE, {
      method: 'GET',
      path: '/api/v1/agent-hub/assistants/a1',
      accessToken: TK,
    })
  })

  test('rules uses installed/:name/rules (not tenant/:id/rules)', async () => {
    const mock = vi.fn().mockResolvedValue({ rules: 'x' })
    const port = createMossAgentPort(mock, BASE)
    await port.installedRules(TK, 'helper')
    expect(mock).toHaveBeenCalledWith(BASE, {
      method: 'GET',
      path: '/api/v1/agents/installed/helper/rules',
      accessToken: TK,
    })
  })

  test('uninstall posts assistantName only (no client sourcePath)', async () => {
    const mock = vi.fn().mockResolvedValue({ ok: true })
    const port = createMossAgentPort(mock, BASE)
    await port.uninstall(TK, { assistantName: 'helper' })
    expect(mock).toHaveBeenCalledWith(BASE, {
      method: 'POST',
      path: '/api/v1/agents/uninstall',
      accessToken: TK,
      body: { assistantName: 'helper' },
    })
  })

  test('tenant endpoints', async () => {
    const mock = vi.fn().mockResolvedValue([])
    const port = createMossAgentPort(mock, BASE)
    await port.tenantList(TK)
    await port.tenantCreate(TK, { name: 'n' })
    await port.tenantUpdate(TK, 't1', { description: 'd' })
    await port.tenantDelete(TK, 't1')
    await port.tenantDownload(TK, 't1')
    await port.tenantPublish(TK, { assistantName: 'helper' })
    const paths = mock.mock.calls.map((c) => (c[1] as { method: string; path: string }).method + ' ' + (c[1] as { path: string }).path)
    expect(paths).toEqual([
      'GET /api/v1/agents/tenant',
      'POST /api/v1/agents/tenant/create',
      'PATCH /api/v1/agents/tenant/t1',
      'DELETE /api/v1/agents/tenant/t1',
      'GET /api/v1/agents/tenant/t1/download',
      'POST /api/v1/agents/tenant/publish',
    ])
  })
})

describe('MossSkillPort request shapes（修订版 3.9：skill-hub 前缀、enabled 单对象）', () => {
  test('hub endpoints use /api/v1/skill-hub/* prefix', async () => {
    const mock = vi.fn().mockResolvedValue({})
    const port = createMossSkillPort(mock, BASE)
    await port.hubCategories(TK)
    await port.hubList(TK, {})
    await port.hubDetail(TK, 's1')
    expect(mock).toHaveBeenNthCalledWith(1, BASE, {
      method: 'GET',
      path: '/api/v1/skill-hub/categories',
      accessToken: TK,
    })
    expect(mock).toHaveBeenNthCalledWith(2, BASE, {
      method: 'GET',
      path: '/api/v1/skill-hub/skills/cursor',
      accessToken: TK,
      searchParams: {},
    })
    expect(mock).toHaveBeenNthCalledWith(3, BASE, {
      method: 'GET',
      path: '/api/v1/skill-hub/skills/s1',
      accessToken: TK,
    })
  })

  test('enabled sends single {skillName, enabled} object（基线事实，非数组）', async () => {
    const mock = vi.fn().mockResolvedValue({ ok: true })
    const port = createMossSkillPort(mock, BASE)
    await port.setEnabled(TK, { skillName: 'pdf', enabled: true })
    expect(mock).toHaveBeenCalledWith(BASE, {
      method: 'PATCH',
      path: '/api/v1/skills/enabled',
      accessToken: TK,
      body: { skillName: 'pdf', enabled: true },
    })
  })

  test('tenant upload uses /tenant/upload (not /tenant/create)', async () => {
    const mock = vi.fn().mockResolvedValue({})
    const port = createMossSkillPort(mock, BASE)
    await port.tenantUpload(TK, { archiveBase64: 'eA==' })
    expect(mock).toHaveBeenCalledWith(BASE, {
      method: 'POST',
      path: '/api/v1/skills/tenant/upload',
      accessToken: TK,
      body: { archiveBase64: 'eA==' },
    })
  })
})
