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

  it('list-jobs returns the desktop { __error } envelope when the org disables cron', async () => {
    stubFetch({ '/api/cron': { status: 403, body: { error: 'CRON_DISABLED_BY_ORG' } } })
    const result = (await ipcBridge.cron.listJobs.invoke()) as unknown as { __error?: string }
    expect(Array.isArray(result)).toBe(false)
    expect(result.__error).toBe('CRON_DISABLED_BY_ORG')
  })
})
