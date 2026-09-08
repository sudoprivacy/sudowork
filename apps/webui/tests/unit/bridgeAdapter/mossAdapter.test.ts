/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * mossAdapter channel-mapping tests. These exercise the full wire path —
 * ipcBridge provider → @office-ai/platform bridge → mossAdapter handler →
 * same-origin fetch — with fetch stubbed, so they pin both the request shape
 * the webui server sees and the DTO mapping the renderer receives.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@client/bridgeAdapter/mossAdapter'
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge'
import { resolveTenantConfig, type TenantConfigInput } from '@sudowork/common/types/tenantConfig'

type FetchMock = ReturnType<typeof vi.fn>
type StatusRoute = { status: number; body: unknown }

function stubFetch(routes: Record<string, unknown | StatusRoute>): FetchMock {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    for (const [prefix, payload] of Object.entries(routes)) {
      if (!url.includes(prefix)) continue
      if (payload && typeof payload === 'object' && 'status' in payload) {
        const route = payload as StatusRoute
        return new Response(JSON.stringify(route.body), {
          status: route.status,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ error: 'ROUTE_NOT_STUBBED' }), { status: 404 })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('mossAdapter: eeclaw tenancy channels', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('verify-server maps /api/settings/about into a TenantConfigData envelope', async () => {
    const fetchMock = stubFetch({
      '/api/settings/about': { branding: { appName: 'Acme', logo: 'https://logo' } },
    })
    const result = await ipcBridge.eeclaw.verifyServer.invoke({ serverUrl: 'ignored' })

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({
      app_name: 'Acme',
      logo: 'https://logo',
    })
    // Required TenantConfigData fields are synthesized, never undefined.
    expect(typeof result.data?.id).toBe('string')
    expect(typeof result.data?.updated_at).toBe('number')
    // The consumer side fills every remaining null from DEFAULT_TENANT_CONFIG.
    const resolved = resolveTenantConfig(result.data as unknown as TenantConfigInput)
    expect(resolved.app_name).toBe('Acme')
    expect(resolved.client_cron_enabled).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/settings/about')
  })

  it('verify-server tolerates branding failure and still resolves defaults', async () => {
    stubFetch({ '/api/settings/about': { status: 500, body: { error: 'MOSS_UNAVAILABLE' } } })
    const result = await ipcBridge.eeclaw.verifyServer.invoke({ serverUrl: '' })

    expect(result.success).toBe(true)
    const resolved = resolveTenantConfig(result.data as unknown as TenantConfigInput)
    expect(resolved.app_name).toBe('SudoWork')
  })

  it('get-user-profile maps lenient snake/camel moss fields to UserProfileData', async () => {
    stubFetch({
      '/api/settings/profile': {
        data: {
          username: 'alice',
          departmentName: 'R&D',
          role: 'admin',
          usage: { input_tokens: 10, output_tokens: 5, totalTokens: 15, sessionCount: 2 },
        },
      },
    })
    const result = await ipcBridge.eeclaw.getUserProfile.invoke()

    expect(result.success).toBe(true)
    expect(result.data).toEqual({
      username: 'alice',
      department: 'R&D',
      role: 'admin',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        session_count: 2,
      },
    })
  })

  it('get-cloud-assistants maps agents and carries the guid-selector filter fields', async () => {
    stubFetch({
      '/api/agents': [
        { name: 'hub-1', displayName: 'Hub One', tag: 'hub', description: 'd1' },
        { name: 'builtin-1', display_name: 'Builtin', isBuiltin: true, tag: 'system' },
        { name: 'mine', tag: 'custom' },
      ],
    })
    const result = await ipcBridge.eeclaw.getCloudAssistants.invoke()

    expect(result.success).toBe(true)
    expect(result.data).toEqual([
      expect.objectContaining({
        key: 'hub-1',
        name: 'Hub One',
        description: 'd1',
        isBuiltin: false,
        isHubInstalled: true,
        sourceType: 'hub',
      }),
      expect.objectContaining({ key: 'builtin-1', isBuiltin: true, sourceType: 'system' }),
      expect.objectContaining({ key: 'mine', sourceType: 'custom' }),
    ])
  })

  it('get-cloud-assistants falls back to an empty list on server error', async () => {
    stubFetch({ '/api/agents': { status: 503, body: { error: 'MOSS_UNAVAILABLE' } } })
    const result = await ipcBridge.eeclaw.getCloudAssistants.invoke()

    expect(result.success).toBe(true)
    expect(result.data).toEqual([])
  })

  it('unmapped channels reject with not-supported-on-web (never pending)', async () => {
    const result = (await ipcBridge.team.listMembers.invoke({
      teamId: 't1',
    } as never)) as unknown as {
      success: boolean
    }
    expect(result.success).toBe(false)
  })
})

describe('mossAdapter: assistant/skill management channels', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('get-installed-assistants projects moss rows into IAssistantInfo', async () => {
    stubFetch({
      '/api/agents': [
        { name: 'hub-a', displayName: 'Hub A', tag: 'hub', isBuiltin: false },
        { name: 'sys-a', display_name: 'Sys A', tag: 'system', isBuiltin: true, enabled: false },
        { name: 'mine' },
      ],
    })
    const result = await ipcBridge.assistantHub.getInstalledAssistants.invoke()

    expect(result.success).toBe(true)
    expect(result.data).toEqual([
      expect.objectContaining({
        name: 'hub-a',
        isBuiltin: false,
        isHubInstalled: true,
        enabled: true,
        category: 'hub',
      }),
      expect.objectContaining({
        name: 'sys-a',
        isBuiltin: true,
        enabled: false,
        category: 'system',
      }),
      // user-created row (no tag) falls back to the custom category
      expect.objectContaining({ name: 'mine', category: 'custom', isHubInstalled: false }),
    ])
    expect((result.data?.[0]?.meta as { display_name?: string })?.display_name).toBe('Hub A')
  })

  it('create-assistant sends only the minimal schema fields (no extra keys)', async () => {
    const fetchMock = stubFetch({ '/api/agents/create': { ok: true } })
    const result = await ipcBridge.assistantHub.createAssistant.invoke({
      meta: {
        name: 'writer',
        display_name: 'Writer',
        description: 'a writer',
        avatar: 'data:img',
        // fields the server schema does not accept — must not be forwarded
        presetAgentType: 'claude',
        enabledSkills: ['x'],
        nameI18n: { en: 'Writer' },
      },
      ruleContent: 'You are a writer.',
    } as never)

    expect(result.success).toBe(true)
    const body = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1] && (fetchMock.mock.calls[0][1] as RequestInit).body),
    )
    expect(body).toEqual({
      name: 'writer',
      displayName: 'Writer',
      description: 'a writer',
      avatar: 'data:img',
      prompt: 'You are a writer.',
    })
  })

  it('uninstall-assistant posts the bare name', async () => {
    const fetchMock = stubFetch({ '/api/agents/uninstall': { ok: true } })
    const result = await ipcBridge.assistantHub.uninstallAssistant.invoke({
      name: 'writer',
    } as never)

    expect(result.success).toBe(true)
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))
    expect(body).toEqual({ name: 'writer' })
  })

  it('get-installed-skills maps rows and backfills meta.source_type', async () => {
    stubFetch({
      '/api/skills': [
        { name: 'hub-s', version: '1.0.0', isHubInstalled: true, enabled: true },
        { name: 'sys-s', version: '2.0.0', isHubInstalled: false, isBuiltin: true, enabled: false },
      ],
    })
    const result = await ipcBridge.skillHub.getInstalledSkills.invoke()

    expect(result.success).toBe(true)
    expect(result.data?.[0]).toEqual(
      expect.objectContaining({
        name: 'hub-s',
        version: '1.0.0',
        isHubInstalled: true,
        enabled: true,
      }),
    )
    expect(result.data?.[0]?.meta?.source_type).toBe('hub')
    // non-hub row backfills 'system'
    expect(result.data?.[1]?.meta?.source_type).toBe('system')
    expect(result.data?.[1]?.isBuiltin).toBe(true)
  })

  it('set-skill-enabled patches {name, enabled}', async () => {
    const fetchMock = stubFetch({ '/api/skills/enabled': { ok: true } })
    const result = await ipcBridge.skillHub.setSkillEnabled.invoke({
      skillName: 'hub-s',
      enabled: false,
    } as never)

    expect(result.success).toBe(true)
    const call = fetchMock.mock.calls[0]
    expect((call?.[1] as RequestInit)?.method).toBe('PATCH')
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
      name: 'hub-s',
      enabled: false,
    })
  })

  it('extensions channels resolve to an empty array', async () => {
    const assistants = await ipcBridge.extensions.getAssistants.invoke()
    const adapters = await ipcBridge.extensions.getAcpAdapters.invoke()
    expect(assistants).toEqual([])
    expect(adapters).toEqual([])
  })
})
