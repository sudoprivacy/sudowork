import { describe, expect, it, vi } from 'vitest'
import { MossHttpError } from '@sudowork/moss-client'
import { isSessionAccessible } from '@server/features/conversations/sessionAccess'
import {
  requireAccessibleSession,
  listConversations,
  SessionForbiddenError,
  type ConversationDeps,
} from '@server/features/conversations/conversationService'
import type { Principal } from '@server/features/auth/principalRepository'
import type { MossSessionSummary } from '@sudowork/contracts/conversations'
import type { MossSessionPort } from '@sudowork/moss-client'
import type { Pool } from 'pg'

const principal = { mossUserId: 'admin', orgId: 'org-a' } as Principal
const managed: MossSessionSummary = {
  sessionId: 'managed',
  userId: 'alice',
  orgId: 'org-a',
  status: 'active',
  source: 'agent-manager',
  clientMetadata: { agent_manager_actor_id: 'admin' },
}
const ctx = { baseUrl: 'https://moss.example', accessToken: 'verified-actor-token' }

describe('shared Agent workbench access', () => {
  it('projects an owner Feishu Moss Session into the workbench while excluding other owners', async () => {
    const session = {
      ...managed,
      source: 'lark',
      assistantName: 'moss-agent:operator:org-alice',
      clientMetadata: {
        agent_manager_actor_id: 'alice',
        agent_manager_agent_name: 'moss-native-alice',
        agent_manager_display_name: 'Moss',
        agent_manager_owner_name: 'Alice',
        private_key: 'never-return',
      },
    }
    const deps = {
      moss: {
        list: vi
          .fn()
          .mockResolvedValue([session, { ...session, sessionId: 'foreign', userId: 'bob' }]),
      },
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool,
    } as unknown as ConversationDeps
    const rows = await listConversations(deps, { ...principal, mossUserId: 'alice' }, ctx)
    expect(rows).toMatchObject([
      {
        id: 'managed',
        source: 'lark',
        managementContext: {
          ownerId: 'alice',
          ownerName: 'Alice',
          agentName: 'moss-native-alice',
          displayName: 'Moss',
        },
      },
    ])
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toContain('never-return')
    // Presentation metadata cannot make a non-owner an IM Session's actor.
    expect(await listConversations(deps, principal, ctx)).toEqual([])
  })

  it('allows the owner and the initiating actor while preserving the Agent owner', () => {
    expect(isSessionAccessible(managed, principal)).toBe(true)
    expect(isSessionAccessible(managed, { mossUserId: 'alice', orgId: 'org-a' })).toBe(true)
    expect(managed.userId).toBe('alice')
  })
  it.each([
    { ...managed, orgId: 'foreign-org' },
    { ...managed, source: 'browser' },
    { ...managed, clientMetadata: undefined },
    { ...managed, clientMetadata: { agent_manager_actor_id: 'other-admin' } },
  ])('refuses foreign organizations and ungranted sessions', (session) => {
    expect(isSessionAccessible(session, principal)).toBe(false)
  })
  it('checks fresh Moss permission before honoring the server grant', async () => {
    const get = vi.fn().mockResolvedValue(managed)
    const deps = { moss: { get } as unknown as MossSessionPort }
    await requireAccessibleSession(deps, principal, 'managed', ctx)
    expect(get).toHaveBeenCalledWith(ctx, 'managed')
    get.mockRejectedValueOnce(new MossHttpError(403, 'revoked', '/api/v1/sessions/managed'))
    await expect(requireAccessibleSession(deps, principal, 'managed', ctx)).rejects.toThrow()
    get.mockResolvedValueOnce({ ...managed, source: 'browser' })
    await expect(requireAccessibleSession(deps, principal, 'managed', ctx)).rejects.toBeInstanceOf(
      SessionForbiddenError,
    )
  })
})
