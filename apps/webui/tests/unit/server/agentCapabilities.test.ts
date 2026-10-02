import { describe, expect, it, vi } from 'vitest'
import {
  createAgent,
  getScopes,
  hubList,
  installFromHub as installAgent,
  type AgentDeps,
} from '@server/features/agents/agentService'
import {
  installFromHub as installSkill,
  type SkillDeps,
} from '@server/features/skills/skillService'

const ctx = { accessToken: 'test-access-token', baseUrl: 'https://moss.test' }

function setup(profile: Record<string, unknown>) {
  const create = vi.fn().mockResolvedValue({ assistantName: 'agent-id' })
  const me = vi.fn().mockResolvedValue({ user: { id: 'owner-id' }, ...profile })
  const deps = { auth: { mossAuth: { me } }, agents: { create } } as unknown as AgentDeps
  return { deps, create }
}

describe('agent management capabilities', () => {
  it('forwards catalog search and pagination using the upstream query parameter', async () => {
    const list = vi
      .fn()
      .mockResolvedValue({ assistants: [{ id: 'writer' }], next_cursor: 'next', has_more: true })
    const deps = { agents: { hubList: list } } as unknown as AgentDeps
    expect(
      await hubList(deps, ctx, { search: 'writer', cursor: 'page', category: 'writing' }),
    ).toEqual({
      items: [{ id: 'writer' }],
      next_cursor: 'next',
      has_more: true,
    })
    expect(list).toHaveBeenCalledWith(ctx, { query: 'writer', cursor: 'page', category: 'writing' })
  })
  it('resolves agent downloads from trusted catalog metadata', async () => {
    const install = vi.fn().mockResolvedValue({ ok: true })
    const meta = {
      id: 'catalog-id',
      name: 'catalog-item',
      skills: ['writer'],
      versions: [
        { version: '2.0', source_url: 'https://hub.test/archive.zip', checksum: 'sha256' },
      ],
    }
    const port = {
      hubList: vi.fn().mockResolvedValue({ items: [meta] }),
      hubDetail: vi.fn().mockResolvedValue(meta),
      install,
    }
    const deps = {
      auth: { mossAuth: { me: vi.fn().mockResolvedValue({ role: 'admin' }) } },
      agents: port,
    }
    await installAgent(deps as unknown as AgentDeps, ctx, meta.name)
    expect(port.hubList).toHaveBeenCalledWith(ctx, { limit: '100', query: meta.name })
    expect(install).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        assistantName: meta.name,
        sourceUrl: 'https://hub.test/archive.zip',
        version: '2.0',
        checksum: 'sha256',
      }),
    )
  })

  it('installs public skills for ordinary users by catalog ID', async () => {
    const install = vi.fn().mockResolvedValue({ name: 'writer' })
    const me = vi.fn().mockResolvedValue({ role: 'user', scopes: ['store:read'] })
    const deps = { auth: { mossAuth: { me } }, skills: { install } } as unknown as SkillDeps
    await installSkill(deps, ctx, 'catalog-id')
    expect(install).toHaveBeenCalledWith(ctx, 'catalog-id')
    expect(me).not.toHaveBeenCalled()
  })

  it.each(['admin', 'super_admin'])(
    'exposes the management capability for %s with wildcard scopes',
    async (role) => {
      const { deps } = setup({ role, scopes: ['*'] })
      expect(await getScopes(deps, ctx)).toContain('admin:settings')
    },
  )

  it('does not grant resource management to a regular account', async () => {
    const { deps } = setup({ role: 'user', scopes: ['store:read'] })
    expect(await getScopes(deps, ctx)).toEqual(['store:read'])
  })

  it('forwards rules and skills and binds the custom agent to the authenticated creator', async () => {
    const { deps, create } = setup({ role: 'admin', scopes: ['*'] })
    await createAgent(deps, ctx, {
      name: 'agent-id',
      displayName: 'My agent',
      prompt: 'Reply with 323',
      skills: ['writer'],
      visible_to: { user_ids: ['other-user'] },
    })
    expect(create).toHaveBeenCalledWith(ctx, {
      name: 'agent-id',
      displayName: 'My agent',
      rules: 'Reply with 323',
      skills: ['writer'],
      visible_to: { user_ids: ['owner-id'] },
    })
  })
})
