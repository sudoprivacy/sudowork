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
import {
  durationToMs,
  msToDuration,
  rendererScheduleToServer,
  serverScheduleToRenderer,
} from '@client/bridgeAdapter/mossAdapter'
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge'
import type { IResponseMessage } from '@sudowork/host-bridge/ipcBridge'
import { resolveTenantConfig, type TenantConfigInput } from '@sudowork/common/types/tenantConfig'

type FetchMock = ReturnType<typeof vi.fn>
type StatusRoute = { status: number; body: unknown }

describe('mossAdapter: browser display preferences', () => {
  beforeEach(() => localStorage.clear())

  it('uses the tenant tool-display default until explicitly overridden and emits changes', async () => {
    expect(await ipcBridge.systemSettings.getShowToolCalls.invoke()).toBeNull()
    const onChange = vi.fn()
    const unsubscribe = ipcBridge.systemSettings.showToolCallsChanged.on(onChange)
    try {
      await ipcBridge.systemSettings.setShowToolCalls.invoke({ enabled: false })
      expect(await ipcBridge.systemSettings.getShowToolCalls.invoke()).toBe(false)
      expect(onChange).toHaveBeenLastCalledWith({ enabled: false })
      await ipcBridge.systemSettings.setShowToolCalls.invoke({ enabled: true })
      expect(await ipcBridge.systemSettings.getShowToolCalls.invoke()).toBe(true)
      expect(onChange).toHaveBeenLastCalledWith({ enabled: true })
    } finally {
      unsubscribe()
    }
  })

  it('returns a boolean token badge preference, never an unsupported-response object', async () => {
    expect(await ipcBridge.systemSettings.getShowTokenUsageBadges.invoke()).toBe(false)
    await ipcBridge.systemSettings.setShowTokenUsageBadges.invoke({ enabled: true })
    expect(await ipcBridge.systemSettings.getShowTokenUsageBadges.invoke()).toBe(true)
  })
})

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

  it('verify-server maps public /api/v1/tenant/config into a TenantConfigData envelope', async () => {
    const fetchMock = stubFetch({
      '/api/v1/tenant/config': {
        success: true,
        data: {
          app_name: 'Acme',
          top_name: 'Acme Top',
          about_name: 'About Acme',
          app_company_name: 'Acme Inc.',
          login_desp: 'Welcome',
          logo: 'https://logo',
          client_cron_enabled: false,
        },
      },
    })
    const result = await ipcBridge.eeclaw.verifyServer.invoke({ serverUrl: 'ignored' })

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({
      app_name: 'Acme',
      top_name: 'Acme Top',
      about_name: 'About Acme',
      app_company_name: 'Acme Inc.',
      login_desp: 'Welcome',
      logo: 'https://logo',
      client_cron_enabled: false,
    })
    // Required TenantConfigData fields are synthesized, never undefined.
    expect(typeof result.data?.id).toBe('string')
    expect(typeof result.data?.updated_at).toBe('number')
    // The consumer side fills every remaining null from DEFAULT_TENANT_CONFIG.
    const resolved = resolveTenantConfig(result.data as unknown as TenantConfigInput)
    expect(resolved.app_name).toBe('Acme')
    expect(resolved.client_cron_enabled).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v1/tenant/config')
  })

  it('verify-server tolerates branding failure and still resolves defaults', async () => {
    stubFetch({ '/api/v1/tenant/config': { status: 500, body: { error: 'MOSS_UNAVAILABLE' } } })
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
  it('installs cloud agents by name and leaves download resolution to the server', async () => {
    const fetchMock = stubFetch({
      '/api/agents/install': { assistantName: 'helper' },
    })
    expect(
      (
        await ipcBridge.assistantHub.downloadAndInstallAssistant.invoke({
          assistantName: 'helper',
          displayName: 'Helper',
          sourceUrl: 'https://untrusted.test/file.zip',
          version: '1',
          checksum: '',
          assistantMeta: {
            id: 'helper',
            name: 'helper',
            display_name: 'Helper',
            description: '',
            avatar: null,
            emoji: null,
            category: '',
            categories: [],
            preset_agent_type: null,
            skills: [],
            tag: 'hub',
            homepage: null,
            author_id: 'author',
            star_count: 0,
            applicable_scenarios: null,
            core_features: null,
            created_at: '',
            updated_at: '',
          },
        })
      ).success,
    ).toBe(true)
    expect(
      fetchMock.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body))),
    ).toEqual([{ name: 'helper' }])
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads skill categories through the authenticated WebUI route', async () => {
    const fetchMock = stubFetch({ '/api/skills/hub/categories': ['Writing', 'Development'] })
    expect(await ipcBridge.skillHub.fetchCategories.invoke()).toEqual({
      success: true,
      data: ['Writing', 'Development'],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/skills/hub/categories',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('restores the renderer detail envelope from the flattened Moss skill', async () => {
    stubFetch({
      '/api/skills/hub/skill%2Fone': {
        id: 'skill/one',
        name: 'writer',
        versions: [{ version: '1.0', source_url: 'https://example.com/skill.zip' }],
      },
    })
    expect(await ipcBridge.skillHub.fetchSkillDetail.invoke({ skillId: 'skill/one' })).toEqual({
      success: true,
      data: {
        skill: { id: 'skill/one', name: 'writer' },
        versions: [{ version: '1.0', source_url: 'https://example.com/skill.zip' }],
      },
    })
  })

  it('reports category errors instead of presenting an empty successful catalog', async () => {
    stubFetch({
      '/api/skills/hub/categories': { status: 503, body: { error: 'MOSS_UNAVAILABLE' } },
    })
    expect((await ipcBridge.skillHub.fetchCategories.invoke()).success).toBe(false)
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

  it('get-installed-assistants maps avatar emoji fallback, promptsI18n dual-read and defaultInitPrompt', async () => {
    stubFetch({
      '/api/agents': [
        {
          name: 'sys-emoji',
          displayName: 'Sys',
          tag: 'system',
          isBuiltin: true,
          avatar: '',
          emoji: '🚀',
          defaultInitPrompt: '帮我构建一个应用',
          prompts_i18n: { 'zh-CN': ['案例一'] },
        },
        {
          name: 'hub-img',
          displayName: 'Hub',
          tag: 'hub',
          avatar: 'https://example.com/a.png',
          promptsI18n: { 'zh-CN': ['案例二'] },
        },
      ],
    })
    const result = await ipcBridge.assistantHub.getInstalledAssistants.invoke()

    expect(result.success).toBe(true)
    expect(result.data?.[0]?.meta).toEqual(
      expect.objectContaining({
        avatar: '🚀',
        defaultInitPrompt: '帮我构建一个应用',
        promptsI18n: { 'zh-CN': ['案例一'] },
      }),
    )
    expect(result.data?.[1]?.meta).toEqual(
      expect.objectContaining({
        avatar: 'https://example.com/a.png',
        promptsI18n: { 'zh-CN': ['案例二'] },
      }),
    )
  })

  it('create-assistant sends only the minimal schema fields (no extra keys)', async () => {
    const fetchMock = stubFetch({ '/api/agents/create': { ok: true } })
    const result = await ipcBridge.assistantHub.createAssistant.invoke({
      meta: {
        name: 'writer',
        display_name: 'Writer',
        description: 'a writer',
        avatar: 'data:img',
        // Runtime selection stays server-owned.
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
      skills: ['x'],
    })
  })

  it('creates an assistant from the shared drawer UUID and localized labels', async () => {
    const fetchMock = stubFetch({ '/api/agents/create': { ok: true } })
    const result = await ipcBridge.assistantHub.createAssistant.invoke({
      meta: {
        id: 'agent-id',
        nameI18n: { 'zh-CN': 'Writer' },
        descriptionI18n: { 'zh-CN': 'Draft documents' },
        enabledSkills: ['writer'],
      },
      ruleContent: 'Reply with 323',
    })
    expect(result.success).toBe(true)
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      name: 'agent-id',
      displayName: 'Writer',
      description: 'Draft documents',
      prompt: 'Reply with 323',
      skills: ['writer'],
    })
  })

  it('saves localized assistant edits and explicit empty rules through the cloud API', async () => {
    const fetchMock = stubFetch({ '/api/agents/meta': { ok: true } })
    expect(
      (
        await ipcBridge.assistantHub.updateAssistantMeta.invoke({
          name: 'agent-id',
          updates: { nameI18n: { 'zh-CN': 'Renamed' }, enabledSkills: [] },
        })
      ).success,
    ).toBe(true)
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      name: 'agent-id',
      updates: { display_name: 'Renamed', enabledSkills: [] },
    })
    expect(
      await ipcBridge.fs.writeAssistantRule.invoke({ assistantId: 'agent-id', content: '' }),
    ).toBe(true)
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({
      name: 'agent-id',
      updates: { rules: '' },
    })
  })

  it('returns a real failure when cloud rules cannot be saved', async () => {
    stubFetch({ '/api/agents/meta': { status: 403, body: { error: 'FORBIDDEN' } } })
    expect(
      await ipcBridge.fs.writeAssistantRule.invoke({ assistantId: 'agent-id', content: 'draft' }),
    ).toBe(false)
  })

  it('reads upload metadata and thumbnail bytes from the browser file', async () => {
    const path = '/webupload/test/image.png'
    window.__sudoworkWebFileStaging = new Map([
      [path, new File(['abc'], 'image.png', { type: 'image/png', lastModified: 123 })],
    ])
    try {
      expect(await ipcBridge.fs.getFileMetadata.invoke({ path })).toEqual({
        name: 'image.png',
        path,
        size: 3,
        type: 'image/png',
        lastModified: 123,
      })
      expect(await ipcBridge.fs.getImageBase64.invoke({ path })).toBe('data:image/png;base64,YWJj')
    } finally {
      window.__sudoworkWebFileStaging = undefined
    }
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

  it('read-assistant-rule unwraps {rules} and strips the builtin- id prefix (bare string)', async () => {
    const fetchMock = stubFetch({ '/api/agents/rules/': { rules: '# writer rules' } })
    const content = await ipcBridge.fs.readAssistantRule.invoke({
      assistantId: 'builtin-a',
      locale: 'zh-CN',
    })

    // Desktop provider contract: a bare string, not an IBridgeResponse envelope.
    expect(content).toBe('# writer rules')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/agents/rules/a')
  })

  it('read-assistant-rule degrades to an empty string on error (admin scope, 404)', async () => {
    stubFetch({
      '/api/agents/rules/': { status: 403, body: { error: 'Missing scope: admin:settings' } },
    })
    const content = await ipcBridge.fs.readAssistantRule.invoke({ assistantId: 'hub-a' })

    expect(content).toBe('')
  })

  it('installs by catalog ID without forwarding browser package URLs or versions', async () => {
    const fetchMock = stubFetch({ '/api/skills/install': { name: 'video-subtitles' } })
    const result = await ipcBridge.skillHub.downloadAndInstallSkill.invoke({
      skillName: 'video-subtitles',
      displayName: 'Video subtitles',
      version: 'untrusted',
      sourceUrl: 'http://untrusted/package.zip',
      checksum: 'untrusted',
      skillMeta: { id: 'skill-id' } as NonNullable<
        Parameters<typeof ipcBridge.skillHub.downloadAndInstallSkill.invoke>[0]['skillMeta']
      >,
    })
    expect(result.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/skills/install',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ id: 'skill-id' }),
      }),
    )
  })

  it('reads skill versions and categories from authenticated WebUI routes', async () => {
    stubFetch({
      '/api/skills/hub/categories': ['Creation'],
      '/api/skills/hub/skill-id': {
        id: 'skill-id',
        name: 'writer',
        versions: [{ version: '1.0.1' }],
      },
    })
    expect(await ipcBridge.skillHub.fetchCategories.invoke()).toEqual({
      success: true,
      data: ['Creation'],
    })
    expect(await ipcBridge.skillHub.fetchSkillDetail.invoke({ skillId: 'skill-id' })).toEqual({
      success: true,
      data: { skill: { id: 'skill-id', name: 'writer' }, versions: [{ version: '1.0.1' }] },
    })
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

  it('get-installed-skills derives tenant category from meta.source_type when moss omits it', async () => {
    stubFetch({
      '/api/skills': [
        // moss returns an empty category on tenant rows; the marker is in meta.source_type
        { name: 'tenant-s', version: '1.0.0', category: '', meta: { source_type: 'tenant' } },
        // non-tenant rows with an empty category must stay 'custom'
        { name: 'custom-s', version: '1.0.0', category: '', meta: { source_type: 'hub' } },
        // an explicit category keeps passing through unchanged
        { name: 'explicit-tenant-s', version: '1.0.0', category: 'tenant' },
        { name: 'explicit-sys-s', version: '1.0.0', category: 'system' },
      ],
    })
    const result = await ipcBridge.skillHub.getInstalledSkills.invoke()

    expect(result.success).toBe(true)
    expect(result.data?.[0]?.category).toBe('tenant')
    expect(result.data?.[1]?.category).toBe('custom')
    expect(result.data?.[2]?.category).toBe('tenant')
    expect(result.data?.[3]?.category).toBe('system')
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

describe('mossAdapter: zoom channels (browser-local display prefs)', () => {
  beforeEach(() => localStorage.clear())

  it('get-zoom-factor defaults to 1 and set-zoom-factor persists to localStorage', async () => {
    expect(await ipcBridge.application.getZoomFactor.invoke()).toBe(1)
    const applied = await ipcBridge.application.setZoomFactor.invoke({ factor: 1.25 })
    expect(applied).toBe(1.25)
    expect(localStorage.getItem('sw.web-zoom')).toBe('1.25')
    expect(await ipcBridge.application.getZoomFactor.invoke()).toBe(1.25)
    expect(document.documentElement.style.zoom).toBe('1.25')
  })
})

describe('mossAdapter: workspace / deliverables channels', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('get-remote-workspace wraps the root node and synthesizes fullPath', async () => {
    stubFetch({
      '/workspace/tree': {
        name: 'workspace',
        relativePath: '',
        isDir: true,
        isFile: false,
        children: [{ name: 'a.txt', relativePath: 'a.txt', isFile: true, isDir: false }],
      },
    })
    const result = await ipcBridge.conversation.getRemoteWorkspace.invoke({ conversation_id: 'c1' })

    expect(result.success).toBe(true)
    expect(result.data?.pending).toBe(false)
    const root = result.data?.files?.[0] as {
      fullPath: string
      children?: Array<{ fullPath: string }>
    }
    expect(root.fullPath).toBe('') // synth from relativePath
    expect(root.children?.[0]?.fullPath).toBe('a.txt')
  })

  it('deliverables.list strips {items}, parses createdAt, and null→undefined', async () => {
    stubFetch({
      '/deliverables': {
        items: [
          {
            name: 'r.md',
            relativePath: 'out/r.md',
            kind: 'create',
            ext: 'md',
            size: null,
            mime: null,
            createdAt: '2024-01-01T00:00:00Z',
          },
          {
            name: 'bad.md',
            relativePath: 'out/bad.md',
            kind: 'edit',
            ext: 'md',
            size: 12,
            mime: 'text/markdown',
            createdAt: 'not-a-date',
          },
        ],
      },
    })
    const result = await ipcBridge.deliverables.list.invoke({ conversationId: 'c1' })

    expect(result.success).toBe(true)
    expect(result.data?.[0]).toEqual({
      path: 'out/r.md',
      relativePath: 'out/r.md',
      kind: 'create',
      ext: 'md',
      mime: undefined,
      size: undefined,
      createdAt: Date.parse('2024-01-01T00:00:00Z'),
    })
    // unparseable createdAt falls back to 0 (NaN guard)
    expect(result.data?.[1]?.createdAt).toBe(0)
  })
})

describe('cron schedule conversion', () => {
  it('round-trips every/cron/at schedules through server ↔ renderer', () => {
    const every = { kind: 'every' as const, everyMs: 3_600_000, description: 'hourly' }
    expect(rendererScheduleToServer(every)).toEqual({
      kind: 'every',
      value: '60m',
      description: 'hourly',
    })
    expect(serverScheduleToRenderer(rendererScheduleToServer(every))).toEqual(every)

    const cron = {
      kind: 'cron' as const,
      expr: '0 9 * * *',
      tz: 'Asia/Shanghai',
      description: 'daily',
    }
    expect(rendererScheduleToServer(cron)).toEqual({
      kind: 'cron',
      value: '0 9 * * *',
      tz: 'Asia/Shanghai',
      description: 'daily',
    })
    expect(serverScheduleToRenderer(rendererScheduleToServer(cron))).toEqual(cron)

    const at = { kind: 'at' as const, atMs: 1_700_000_000_000, description: 'once' }
    expect(rendererScheduleToServer(at)).toEqual({
      kind: 'at',
      value: '1700000000000',
      description: 'once',
    })
    expect(serverScheduleToRenderer(rendererScheduleToServer(at))).toEqual(at)
  })

  it('msToDuration/durationToMs are inverse for common values', () => {
    for (const ms of [1000, 60_000, 3_600_000, 86_400_000, 90_000, 1500]) {
      expect(durationToMs(msToDuration(ms))).toBe(ms)
    }
    // moss 'at' value can arrive as an ISO string
    const parsed = serverScheduleToRenderer({ kind: 'at', value: '2024-01-01T00:00:00Z' })
    expect(parsed.kind === 'at' && parsed.atMs).toBe(Date.parse('2024-01-01T00:00:00Z'))
  })
})

describe('mossAdapter: cron channels', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('list-jobs projects moss rows into ICronJob[]', async () => {
    stubFetch({
      '/api/cron': {
        jobs: [
          {
            id: 'job-1',
            name: 'daily',
            enabled: true,
            schedule: { kind: 'cron', value: '0 9 * * *', description: 'daily 09:00' },
            payloadMessage: 'run it',
            boundSessionId: 'sess-1',
            assistantName: 'writer',
          },
        ],
        canCreate: true,
        canUseAdminList: false,
      },
    })
    const jobs = (await ipcBridge.cron.listJobs.invoke()) as unknown as Array<{
      id: string
      schedule: { kind: string }
      metadata: { conversationId: string; agentType: string }
      state: { runCount: number }
    }>

    expect(Array.isArray(jobs)).toBe(true)
    expect(jobs[0]?.id).toBe('job-1')
    expect(jobs[0]?.schedule.kind).toBe('cron')
    expect(jobs[0]?.metadata.conversationId).toBe('sess-1')
    expect(jobs[0]?.metadata.agentType).toBe('writer')
    expect(jobs[0]?.state.runCount).toBe(0)
  })

  it('add-job sends only the strict server fields', async () => {
    const fetchMock = stubFetch({
      '/api/cron': { id: 'job-2', name: 'j', schedule: { kind: 'every', value: '60m' } },
    })
    await ipcBridge.cron.addJob.invoke({
      name: 'j',
      message: 'hello',
      schedule: { kind: 'every', everyMs: 3_600_000, description: 'hourly' },
      conversationId: 'sess-1',
      // agentType is an ACP backend id, NOT a moss assistant name — must be dropped
      // (the server would reject it via assertAssistantName).
      agentType: 'scode',
      createdBy: 'user',
      // fields the strict server schema would 400 on — must be dropped
      workspace: '/tmp',
      presetAssistantId: 'builtin-doctor',
      conversationTitle: 'x',
    } as never)

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))
    expect(body).toEqual({
      name: 'j',
      payloadMessage: 'hello',
      schedule: { kind: 'every', value: '60m', description: 'hourly' },
      boundSessionId: 'sess-1',
    })
    expect(body).not.toHaveProperty('assistantName')
  })

  it('notifies mounted cron views after successful create, update and removal', async () => {
    stubFetch({
      '/api/cron': { id: 'job-2', name: 'j', schedule: { kind: 'every', value: '60m' } },
    })
    const onCreate = vi.fn()
    const onUpdate = vi.fn()
    const onRemove = vi.fn()
    const unsubscribe = [
      ipcBridge.cron.onJobCreated.on(onCreate),
      ipcBridge.cron.onJobUpdated.on(onUpdate),
      ipcBridge.cron.onJobRemoved.on(onRemove),
    ]
    try {
      const created = await ipcBridge.cron.addJob.invoke({
        name: 'j',
        message: 'hello',
        conversationId: 'sess-1',
        agentType: 'scode',
        schedule: { kind: 'every', everyMs: 3_600_000, description: 'hourly' },
        createdBy: 'user',
      })
      expect(onCreate).toHaveBeenCalledExactlyOnceWith(created)
      const updated = await ipcBridge.cron.updateJob.invoke({
        jobId: 'job-2',
        updates: { enabled: false },
      })
      expect(onUpdate).toHaveBeenCalledExactlyOnceWith(updated)
      await ipcBridge.cron.removeJob.invoke({ jobId: 'job-2' })
      expect(onRemove).toHaveBeenCalledExactlyOnceWith({ jobId: 'job-2' })

      stubFetch({ '/api/cron': { status: 403, body: { error: 'FORBIDDEN' } } })
      onCreate.mockClear()
      onUpdate.mockClear()
      onRemove.mockClear()
      await ipcBridge.cron.addJob.invoke({
        name: 'j',
        message: 'hello',
        conversationId: 'sess-1',
        agentType: 'scode',
        schedule: { kind: 'every', everyMs: 3_600_000, description: 'hourly' },
        createdBy: 'user',
      })
      await ipcBridge.cron.updateJob.invoke({ jobId: 'job-2', updates: { enabled: false } })
      await ipcBridge.cron.removeJob.invoke({ jobId: 'job-2' })
      expect(onCreate).not.toHaveBeenCalled()
      expect(onUpdate).not.toHaveBeenCalled()
      expect(onRemove).not.toHaveBeenCalled()
    } finally {
      unsubscribe.forEach((off) => off())
    }
  })

  it('list-jobs returns the desktop { __error } envelope when the org disables cron', async () => {
    stubFetch({ '/api/cron': { status: 403, body: { error: 'CRON_DISABLED_BY_ORG' } } })
    const result = (await ipcBridge.cron.listJobs.invoke()) as unknown as { __error?: string }
    expect(Array.isArray(result)).toBe(false)
    expect(result.__error).toBe('CRON_DISABLED_BY_ORG')
  })
})

describe('mossAdapter: create-conversation binds the selected assistant', () => {
  // The handler opens the session stream after creating the conversation; jsdom's
  // WebSocket would fire async connection errors into the test run, so stub it.
  class FakeWebSocket {
    constructor(public url: string) {}
    addEventListener() {}
    close() {}
  }

  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const readBody = (fetchMock: FetchMock, call = 0): Record<string, unknown> =>
    JSON.parse(String((fetchMock.mock.calls[call]?.[1] as RequestInit).body))

  it('attaches to an externally started conversation and requests a history refresh', async () => {
    const sockets = vi.fn(function (this: FakeWebSocket, url: string) {
      this.url = url
      this.addEventListener = vi.fn()
      this.close = vi.fn()
    })
    vi.stubGlobal('WebSocket', sockets)
    stubFetch({ '/context': { messages: [{ id: 'cron-message' }] } })
    const result = await ipcBridge.conversation.syncMessages.invoke({
      conversation_id: 'cron-sync-test',
    })
    expect(result).toEqual({ success: true, data: { syncedCount: 1, nameUpdated: false } })
    expect(sockets).toHaveBeenCalledWith(
      expect.stringContaining('/ws/conversations/cron-sync-test'),
    )
    const unchanged = await ipcBridge.conversation.syncMessages.invoke({
      conversation_id: 'cron-sync-test',
    })
    expect(unchanged.data?.syncedCount).toBe(0)
  })

  it('forwards extra.presetAssistantId as moss assistantName and reports the display name', async () => {
    const fetchMock = stubFetch({ '/api/conversations': { id: 'sess-1' } })
    const conversation = await ipcBridge.conversation.create.invoke({
      type: 'remote-agent',
      name: 'hello',
      model: {},
      extra: {
        backend: 'remote-agent',
        presetAssistantId: 'compliance_auditor',
        agentName: '合规审计师',
        enabledSkills: ['soc2-audit'],
      },
    } as never)

    expect(readBody(fetchMock)).toEqual({
      assistantName: 'compliance_auditor',
      enabledSkills: ['soc2-audit'],
    })
    // Creation-time response carries the UI display name, matching what
    // get-conversation returns once moss persists display_name.
    expect(conversation).toMatchObject({ name: '合规审计师', extra: { agentName: '合规审计师' } })
  })

  it('strips the builtin- prefix so system assistants match the moss name', async () => {
    const fetchMock = stubFetch({ '/api/conversations': { id: 'sess-2' } })
    await ipcBridge.conversation.create.invoke({
      type: 'remote-agent',
      name: 'hi',
      model: {},
      extra: { presetAssistantId: 'builtin-app-builder-assistant', agentName: 'App 构建助手' },
    } as never)

    expect(readBody(fetchMock)).toEqual({
      assistantName: 'app-builder-assistant',
      enabledSkills: [],
    })
  })

  it('drops UI placeholder names so moss falls back to its default agent', async () => {
    const fetchMock = stubFetch({ '/api/conversations': { id: 'sess-3' } })
    await ipcBridge.conversation.create.invoke({
      type: 'remote-agent',
      name: 'hello',
      model: {},
      extra: { presetAssistantId: 'Remote Agent', agentName: 'Remote Agent' },
    } as never)
    await ipcBridge.conversation.create.invoke({
      type: 'remote-agent',
      name: 'hello',
      model: {},
      extra: { presetAssistantId: 'Moss Server', agentName: 'Moss Server' },
    } as never)

    expect(readBody(fetchMock, 0)).toEqual({ assistantName: '', enabledSkills: [] })
    expect(readBody(fetchMock, 1)).toEqual({ assistantName: '', enabledSkills: [] })
  })

  it('sends an empty assistantName when no assistant is selected', async () => {
    const fetchMock = stubFetch({ '/api/conversations': { id: 'sess-4' } })
    const conversation = await ipcBridge.conversation.create.invoke({
      type: 'remote-agent',
      name: 'hello',
      model: {},
    } as never)

    expect(readBody(fetchMock)).toEqual({ assistantName: '', enabledSkills: [] })
    expect(conversation).toMatchObject({ id: 'sess-4' })
  })

  it('persists the first message as the title before returning the conversation', async () => {
    const fetchMock = stubFetch({
      '/meta': { ok: true },
      '/api/conversations': { id: 'sess-title' },
    })
    const conversation = await ipcBridge.conversation.create.invoke({
      type: 'remote-agent',
      name: 'Hello from WebUI',
      model: {},
      extra: { nameIsFirstMessage: true },
    } as never)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/sess-title/meta')
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe('PATCH')
    expect(readBody(fetchMock, 1)).toEqual({ title: 'Hello from WebUI' })
    expect(conversation).toMatchObject({ name: 'Hello from WebUI' })
  })

  it('uses only the first line and first 50 characters of a long message', async () => {
    const fetchMock = stubFetch({
      '/meta': { ok: true },
      '/api/conversations': { id: 'sess-long' },
    })
    await ipcBridge.conversation.create.invoke({
      type: 'remote-agent',
      name: `${'a'.repeat(55)}\nsecond line`,
      model: {},
      extra: { nameIsFirstMessage: true },
    } as never)

    expect(readBody(fetchMock, 1)).toEqual({ title: 'a'.repeat(50) })
  })

  it('does not persist a placeholder name without the first-message marker', async () => {
    const fetchMock = stubFetch({ '/api/conversations': { id: 'sess-placeholder' } })
    const conversation = await ipcBridge.conversation.create.invoke({
      type: 'remote-agent',
      name: 'New conversation',
      model: {},
      extra: { agentName: 'Selected assistant' },
    } as never)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(conversation).toMatchObject({ name: 'Selected assistant' })
  })

  it('does not abort creation when persisting the title fails', async () => {
    const fetchMock = stubFetch({
      '/meta': { status: 500, body: { error: 'PERSIST_FAILED' } },
      '/api/conversations': { id: 'sess-title-failed' },
    })
    const conversation = await ipcBridge.conversation.create.invoke({
      type: 'remote-agent',
      name: 'Local title',
      model: {},
      extra: { nameIsFirstMessage: true },
    } as never)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(conversation).toMatchObject({ id: 'sess-title-failed', name: 'Local title' })
  })
})

describe('mossAdapter: newly created conversation list reads', () => {
  class FakeWebSocket {
    constructor(public url: string) {}
    addEventListener() {}
    close() {}
  }

  let ipc: typeof import('@sudowork/host-bridge/ipcBridge')

  beforeEach(async () => {
    vi.resetModules()
    localStorage.clear()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    await import('@client/bridgeAdapter/mossAdapter')
    ipc = await import('@sudowork/host-bridge/ipcBridge')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens a conversation immediately after creation when the server list is still empty', async () => {
    stubFetch({
      '/meta': { ok: true },
      '/api/conversations': { id: 'sess-pending', conversations: [] },
    })
    await ipc.conversation.create.invoke({
      type: 'remote-agent',
      name: 'Pending title',
      model: {},
      extra: { nameIsFirstMessage: true },
    } as never)

    const conversation = await ipc.conversation.get.invoke({ id: 'sess-pending' })
    expect(conversation).toMatchObject({ id: 'sess-pending', name: 'Pending title' })
  })

  it('keeps the newer list response in the cache when requests finish out of order', async () => {
    const pending: Array<(response: Response) => void> = []
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(resolve)
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const oldRead = ipc.database.getUserConversations.invoke({})
    const newRead = ipc.database.getUserConversations.invoke({})
    pending[1]?.(new Response(JSON.stringify({ conversations: [{ id: 'newer' }] })))
    expect((await newRead).map((item) => item.id)).toEqual(['newer'])
    pending[0]?.(new Response(JSON.stringify({ conversations: [{ id: 'older' }] })))
    expect((await oldRead).map((item) => item.id)).toEqual(['older'])

    expect((await ipc.database.getUserConversations.invoke({})).map((item) => item.id)).toEqual([
      'newer',
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not cache an old list response after creation invalidates the cache', async () => {
    let resolveOldList: ((response: Response) => void) | undefined
    let listFetchCount = 0
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ id: 'sess-after-post' })))
      }
      if (String(input) === '/api/conversations') {
        listFetchCount += 1
        if (listFetchCount === 1) {
          return new Promise<Response>((resolve) => {
            resolveOldList = resolve
          })
        }
        return Promise.resolve(
          new Response(JSON.stringify({ conversations: [{ id: 'sess-after-post' }] })),
        )
      }
      return Promise.resolve(new Response('{}'))
    })
    vi.stubGlobal('fetch', fetchMock)

    const oldRead = ipc.database.getUserConversations.invoke({})
    await ipc.conversation.create.invoke({
      type: 'remote-agent',
      name: 'Unused',
      model: {},
      extra: {},
    } as never)
    resolveOldList?.(new Response(JSON.stringify({ conversations: [] })))
    await oldRead
    expect((await ipc.database.getUserConversations.invoke({})).map((item) => item.id)).toEqual([
      'sess-after-post',
    ])
    expect(listFetchCount).toBe(2)
  })

  it('removes pending entries through both deletion channels', async () => {
    stubFetch({ '/api/conversations': { id: 'sess-delete', conversations: [] } })
    const create = () =>
      ipc.conversation.create.invoke({
        type: 'remote-agent',
        name: 'Unused',
        model: {},
        extra: {},
      } as never)

    await create()
    expect((await ipc.database.getUserConversations.invoke({})).map((item) => item.id)).toEqual([
      'sess-delete',
    ])
    await ipc.conversation.remove.invoke({ id: 'sess-delete' })
    expect(await ipc.database.getUserConversations.invoke({})).toEqual([])

    await create()
    expect((await ipc.database.getUserConversations.invoke({})).map((item) => item.id)).toEqual([
      'sess-delete',
    ])
    await ipc.moss.deleteSession.invoke({ sessionId: 'sess-delete' })
    expect(await ipc.database.getUserConversations.invoke({})).toEqual([])
  })
})

describe('mossAdapter: chat.send.message shares msgId between the WS send frame and the user echo', () => {
  // Same FakeWebSocket approach as the create-conversation suite above: jsdom's
  // real WebSocket would attempt a real connection; capture frames instead.
  class CaptureWebSocket {
    static instances: CaptureWebSocket[] = []
    static readonly OPEN = 1
    readonly readyState = 1
    sent: unknown[] = []

    constructor(public url: string) {
      CaptureWebSocket.instances.push(this)
    }

    addEventListener() {}

    send(payload: string) {
      this.sent.push(JSON.parse(payload))
    }

    close() {}
  }

  const echoFrames: IResponseMessage[] = []
  let offStream: () => void

  beforeEach(() => {
    localStorage.clear()
    CaptureWebSocket.instances = []
    echoFrames.length = 0
    vi.stubGlobal('WebSocket', CaptureWebSocket)
    offStream = ipcBridge.conversation.responseStream.on((msg) => echoFrames.push(msg))
  })

  afterEach(() => {
    offStream()
    vi.unstubAllGlobals()
  })

  it('forwards the renderer msg_id as the WS send msgId and echoes the same value as user_content', async () => {
    const result = await ipcBridge.acpConversation.sendMessage.invoke({
      conversation_id: 'sess-echo-1',
      input: 'hello',
      msg_id: 'msg-uuid-9',
    } as never)

    expect(result).toEqual({ success: true, data: undefined })
    const ws = CaptureWebSocket.instances[CaptureWebSocket.instances.length - 1]
    // The WS frame carries msgId so moss persists it as the message uuid; /context
    // returns it and the history merge dedupes the echo below by msg_id.
    expect(ws?.sent).toEqual([{ kind: 'send', text: 'hello', msgId: 'msg-uuid-9' }])
    const echo = echoFrames.find((frame) => frame.type === 'user_content')
    expect(echo?.msg_id).toBe('msg-uuid-9')
  })
})

describe('mossAdapter: channel wires (remote connections)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('get-plugin-status maps every moss row to IChannelPluginStatus (no per-type collapsing)', async () => {
    const fetchMock = stubFetch({
      '/api/channels/plugins': {
        plugins: [
          {
            id: 'lark_default',
            type: 'lark',
            name: '飞书 Bot',
            enabled: true,
            status: 'running',
            configuredSecretFields: ['appId', 'appSecret'],
            lastConnected: 123,
          },
          {
            id: 'lark_second',
            type: 'lark',
            name: '飞书 Bot 2',
            enabled: false,
            status: 'stopped',
            configuredSecretFields: [],
          },
        ],
      },
    })
    const result = await ipcBridge.channel.getPluginStatus.invoke()

    expect(result.success).toBe(true)
    expect(result.data).toEqual([
      {
        id: 'lark_default',
        type: 'lark',
        name: '飞书 Bot',
        enabled: true,
        connected: true,
        status: 'running',
        lastConnected: 123,
        activeUsers: 0,
        hasToken: true,
        isExtension: false,
      },
      {
        id: 'lark_second',
        type: 'lark',
        name: '飞书 Bot 2',
        enabled: false,
        connected: false,
        status: 'stopped',
        activeUsers: 0,
        hasToken: false,
        isExtension: false,
      },
    ])
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/channels/plugins')
  })

  it('test-plugin remaps extraConfig per platform and maps the {ok,message} envelope', async () => {
    const fetchMock = stubFetch({
      '/test': { ok: true, message: 'bot-42' },
    })
    const result = await ipcBridge.channel.testPlugin.invoke({
      pluginId: 'dingtalk_default',
      token: '',
      extraConfig: { appId: 'cli-1', appSecret: 'sec' },
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ success: true, botUsername: 'bot-42' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/api/channels/plugins/dingtalk_default/test',
    )
    // dingtalk reads clientId/clientSecret, not the forms' appId/appSecret.
    expect(JSON.parse(String(init.body))).toEqual({ clientId: 'cli-1', clientSecret: 'sec' })
  })

  it('test-plugin maps a refused test to data.error', async () => {
    stubFetch({ '/test': { ok: false, message: 'bad secret' } })
    const result = await ipcBridge.channel.testPlugin.invoke({
      pluginId: 'lark_default',
      token: '',
      extraConfig: { appId: 'a', appSecret: 's' },
    })
    expect(result.data).toEqual({ success: false, error: 'bad secret' })
  })

  it('enable-plugin surfaces the 409 refusal reason instead of an HTTP code', async () => {
    stubFetch({
      '/enable': {
        status: 409,
        body: { ok: false, message: '该飞书已被用户「bob」配置，无法重复配置。' },
      },
    })
    const result = await ipcBridge.channel.enablePlugin.invoke({
      pluginId: 'lark_default',
      config: { appId: 'a', appSecret: 's' },
    })
    expect(result).toEqual({ success: false, msg: '该飞书已被用户「bob」配置，无法重复配置。' })
  })

  it('reject-pairing accepts both moss envelopes ({success,error} and {ok,message})', async () => {
    stubFetch({ '/reject': { success: false, error: 'Invalid pairing code' } })
    const first = await ipcBridge.channel.rejectPairing.invoke({ code: 'C1' })
    expect(first).toEqual({ success: false, msg: 'Invalid pairing code' })

    stubFetch({ '/reject': { status: 200, body: { ok: false, message: 'Forbidden' } } })
    const second = await ipcBridge.channel.rejectPairing.invoke({ code: 'C2' })
    expect(second).toEqual({ success: false, msg: 'Forbidden' })
  })

  it('get-plugin-credentials maps moss {} to null and 404 to a failure', async () => {
    stubFetch({ '/credentials': {} })
    const configured = await ipcBridge.channel.getPluginCredentials.invoke({
      pluginId: 'lark_default',
    })
    expect(configured).toEqual({ success: true, data: null })

    stubFetch({ '/credentials': { status: 404, body: { error: 'Plugin not found' } } })
    const missing = await ipcBridge.channel.getPluginCredentials.invoke({ pluginId: 'nope' })
    expect(missing).toEqual({ success: false, msg: 'Plugin not found' })
  })

  it('create-plugin returns the new pluginId', async () => {
    stubFetch({ '/create': { ok: true, id: 'lark_ab12', type: 'lark', name: '飞书 Bot 2' } })
    const result = await ipcBridge.channel.createPlugin.invoke({ type: 'lark' })
    expect(result).toEqual({ success: true, data: { pluginId: 'lark_ab12' } })
  })

  it('get/set channel agents round-trip the moss envelope', async () => {
    stubFetch({
      '/agents': {
        agents: [{ name: 'recruitment_expert', displayName: '招聘专家' }],
        defaultAgent: 'recruitment_expert',
      },
    })
    const agents = await ipcBridge.moss.getChannelAgents.invoke({ pluginId: 'lark_default' })
    expect(agents).toEqual({
      success: true,
      data: {
        agents: [{ name: 'recruitment_expert', displayName: '招聘专家' }],
        defaultAgent: 'recruitment_expert',
      },
    })

    stubFetch({ '/agents/default': { ok: true } })
    const set = await ipcBridge.moss.setChannelDefaultAgent.invoke({
      pluginId: 'lark_default',
      agentName: null,
    })
    expect(set).toEqual({ success: true, data: undefined })
  })

  it('wechat-start-qr-login drives the phase sequence across qr-poll rounds', async () => {
    vi.useFakeTimers()
    try {
      const polls = [
        { ok: true, status: 'wait' },
        { ok: true, status: 'scaned' },
        { ok: true, status: 'confirmed', botToken: 'tok-9', accountId: 'acc-9' },
      ]
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/wechat/qr-start')) {
          expect(init?.method).toBe('POST')
          return new Response(
            JSON.stringify({ ok: true, qrcode: 'QR-1', qrcodeImgContent: 'data:img' }),
            { status: 200 },
          )
        }
        const poll = polls.shift() ?? { ok: true, status: 'expired' }
        return new Response(JSON.stringify(poll), { status: 200 })
      })
      vi.stubGlobal('fetch', fetchMock)

      const events: Array<Record<string, unknown>> = []
      const off = ipcBridge.channel.wechatQrLogin.on((event) =>
        events.push(event as Record<string, unknown>),
      )

      const started = await ipcBridge.channel.wechatStartQrLogin.invoke()
      expect(started.success).toBe(true)
      expect(events).toEqual([{ phase: 'qrcode', qrUrl: 'data:img' }])

      await vi.advanceTimersByTimeAsync(3000) // wait → no event
      expect(events).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(3000) // scaned
      expect(events).toHaveLength(2)
      expect(events[1]).toEqual({ phase: 'scanned' })
      await vi.advanceTimersByTimeAsync(3000) // confirmed → stop
      expect(events).toHaveLength(3)
      expect(events[2]).toEqual({ phase: 'confirmed', botToken: 'tok-9', accountId: 'acc-9' })
      await vi.advanceTimersByTimeAsync(9000) // timer cleared: no further polls
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('qr-poll'))).toHaveLength(
        3,
      )

      off()
    } finally {
      vi.useRealTimers()
      await ipcBridge.channel.wechatCancelQrLogin.invoke()
    }
  })
})

describe('mossAdapter: naming conversations that predate write-path titling', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const openConversation = (id: string) =>
    ipcBridge.database.getConversationMessages.invoke({ conversation_id: id })

  const metaPatch = (fetchMock: FetchMock) =>
    fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes('/meta') && (init as RequestInit)?.method === 'PATCH',
    )

  const userMessage = (text: string) => ({ role: 'user', content: { content: text } })

  it('names an untitled conversation from its first user message', async () => {
    const fetchMock = stubFetch({
      '/context': { title: null, messages: [userMessage('帮我看下这个报错\n日志在下面')] },
      '/meta': { ok: true },
    })

    await openConversation('sess-legacy-1')

    const patch = metaPatch(fetchMock)
    expect(patch).toBeDefined()
    expect(String(patch?.[0])).toContain('sess-legacy-1')
    expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toEqual({
      title: '帮我看下这个报错',
    })
  })

  it('leaves a conversation that already has a title alone', async () => {
    const fetchMock = stubFetch({
      '/context': { title: '用户自己起的名字', messages: [userMessage('后来又说了点别的')] },
      '/meta': { ok: true },
    })

    await openConversation('sess-named-1')

    // Opening a conversation must never rename it — this is a one-off backfill,
    // not a rule that the first message wins over what the user chose.
    expect(metaPatch(fetchMock)).toBeUndefined()
  })

  it('does not name a conversation that has no user message to name it after', async () => {
    const fetchMock = stubFetch({
      '/context': { title: null, messages: [{ role: 'assistant', content: { content: 'hi' } }] },
      '/meta': { ok: true },
    })

    await openConversation('sess-empty-1')

    expect(metaPatch(fetchMock)).toBeUndefined()
  })

  it('still returns the messages when naming fails', async () => {
    stubFetch({
      '/context': { title: null, messages: [userMessage('开会记录')] },
      '/meta': { status: 500, body: { error: 'BOOM' } },
    })

    // The backfill is fire-and-forget: a failed rename must not stop the
    // conversation from opening.
    await expect(openConversation('sess-fail-1')).resolves.toHaveLength(1)
  })
})

describe('mossAdapter: an untitled session is not named after its id', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // The sidebar renders this value verbatim and the renderer already shows
  // "new conversation" when it is empty, so falling back to the id put a raw
  // uuid where a name belongs — visible to the user, and on screenshots.
  //
  // All three cases share one stub because `listConversations` caches for three
  // seconds: a second call inside that window would answer from the first.
  it('falls back to empty, never to the id, and still prefers a real title', async () => {
    const sessionId = '5ba1bc6e-cb93-49fa-8981-000000000000'
    stubFetch({
      '/api/conversations': {
        conversations: [
          { id: sessionId, status: 'finished', updatedAt: 1 },
          { id: 'b', assistantName: 'scode', updatedAt: 1 },
          { id: 'c', title: 'Quarterly review', assistantName: 'scode', updatedAt: 1 },
        ],
      },
    })

    const list = (await ipcBridge.database.getUserConversations.invoke({})) as Array<{
      id: string
      name: string
    }>

    expect(list[0]?.id).toBe(sessionId)
    expect(list[0]?.name).toBe('')
    expect(list[0]?.name).not.toContain(sessionId)
    expect(list[1]?.name).toBe('scode')
    expect(list[2]?.name).toBe('Quarterly review')
  })
})
