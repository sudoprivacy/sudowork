// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
import type { MossSessionPort } from '@sudowork/moss-client'
import type { Pool } from 'pg'
import {
  createConversation,
  InvalidSelectionError,
  type ConversationDeps,
} from '@server/features/conversations/conversationService'
import type { Principal } from '@server/features/auth/principalRepository'

const ctx = { baseUrl: 'https://moss.test', accessToken: 'alice-token' }
const principal: Principal = {
  id: 'principal-a',
  mossUserId: 'alice',
  orgId: 'org-a',
  username: 'Alice',
  mossBaseUrl: null,
  createdAt: new Date(),
  lastLoginAt: new Date(),
}

function setup() {
  const mine = [
    { ref: 'moss-agent:user:alice', kind: 'default' },
    { ref: 'moss-agent:own:alice-project', kind: 'own' },
    { ref: 'removed-template', kind: 'template' },
  ]
  const create = vi.fn().mockResolvedValue({ sessionId: 'session-a' })
  const mossFetch = vi.fn(async (_base, req) => {
    if (req.path === '/api/v1/agents/mine') return { success: true, data: mine }
    if (req.path === '/api/v1/agent-templates/installed') return [{ name: 'installed-template' }]
    throw new Error(`Unexpected request: ${req.path}`)
  })
  // These collaborators are not used by creation without a model override.
  const deps: ConversationDeps = {
    pool: {} as Pool,
    config: {} as ConversationDeps['config'],
    auth: {} as ConversationDeps['auth'],
    coordinator: {} as ConversationDeps['coordinator'],
    moss: { create } as unknown as MossSessionPort,
    mossFetch,
  }
  return { deps, create, mossFetch, mine }
}

describe('personal Agent selection', () => {
  test.each(['moss-agent:user:alice', 'moss-agent:own:alice-project'])(
    'creates a session for an owned Agent: %s',
    async (assistantName) => {
      const { deps, create, mossFetch } = setup()
      expect(
        await createConversation(deps, principal, { assistantName, enabledSkills: [] }, ctx),
      ).toEqual({ id: 'session-a', taskId: 'session-a' })
      expect(mossFetch).toHaveBeenCalledWith(ctx.baseUrl, {
        method: 'GET',
        path: '/api/v1/agents/mine',
        accessToken: ctx.accessToken,
      })
      expect(create).toHaveBeenCalledWith(ctx, { assistantName, enabledSkills: [] })
    },
  )

  test.each([
    'moss-agent:user:bob',
    'moss-agent:own:bob-project',
    'moss-agent:own:made-up',
    'removed-template',
  ])('rejects foreign, forged or removed selection: %s', async (assistantName) => {
    const { deps, create } = setup()
    await expect(
      createConversation(deps, principal, { assistantName, enabledSkills: [] }, ctx),
    ).rejects.toBeInstanceOf(InvalidSelectionError)
    expect(create).not.toHaveBeenCalled()
  })

  test('checks the fresh owner list on every creation', async () => {
    const { deps, create, mine } = setup()
    const input = { assistantName: 'moss-agent:own:alice-project', enabledSkills: [] }
    await createConversation(deps, principal, input, ctx)
    mine.splice(1, 1)
    await expect(createConversation(deps, principal, input, ctx)).rejects.toBeInstanceOf(
      InvalidSelectionError,
    )
    expect(create).toHaveBeenCalledTimes(1)
  })

  test('continues checking template installation separately from used templates', async () => {
    const { deps, create, mossFetch } = setup()
    await createConversation(
      deps,
      principal,
      { assistantName: 'installed-template', enabledSkills: [] },
      ctx,
    )
    expect(create).toHaveBeenCalledTimes(1)
    expect(mossFetch).toHaveBeenCalledWith(ctx.baseUrl, {
      method: 'GET',
      path: '/api/v1/agent-templates/installed',
      accessToken: ctx.accessToken,
    })
  })

  test('fails closed when the ownership response is invalid', async () => {
    const { deps, create, mossFetch } = setup()
    mossFetch.mockResolvedValueOnce({ success: false, data: [] })
    await expect(
      createConversation(
        deps,
        principal,
        { assistantName: 'moss-agent:own:alice-project', enabledSkills: [] },
        ctx,
      ),
    ).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
  })
})
