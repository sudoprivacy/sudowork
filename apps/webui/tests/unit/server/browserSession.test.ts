import { describe, expect, it, vi } from 'vitest'
import type { MossSessionPort } from '@sudowork/moss-client'
import type { Principal } from '../../../src/server/features/auth/principalRepository'
import {
  invokeBrowserSession,
  receiveBrowserFile,
  readBrowserFile,
} from '../../../src/server/features/conversations/browserSessionService'

const principal: Principal = {
  id: 'principal',
  mossUserId: 'user-a',
  orgId: 'org-a',
  username: 'owner',
  mossBaseUrl: null,
  createdAt: new Date(),
  lastLoginAt: new Date(),
}
const ctx = { baseUrl: 'https://moss.test', accessToken: 'test-session-credential' }

function fixture() {
  let owner = 'user-a'
  const get = vi.fn(async () => ({ sessionId: 'conversation', userId: owner, orgId: 'org-a' }))
  const mossFetch = vi.fn(async () => ({
    session: {
      browserSessionId: 'browser',
      profileId: 'profile',
      state: 'human',
      controlEpoch: 1,
      targetEpoch: 0,
      isController: true,
      isHeadless: true,
      transport: 'extension',
      capabilities: { pageView: true, windowView: false, persistentProfile: true },
      activeTargetId: 'page',
      tabs: [{ id: 'page', title: 'Profile', url: 'https://example.test/' }],
      error: null,
    },
  }))
  const deps = { moss: { get } as unknown as MossSessionPort, mossFetch }
  return {
    deps,
    get,
    mossFetch,
    changeOwner: () => {
      owner = 'user-b'
    },
  }
}

describe('authorized browser session proxy', () => {
  it('rechecks current ownership after the user has already opened a viewer', async () => {
    const f = fixture()
    const reply = await invokeBrowserSession(f.deps, principal, 'conversation', ctx, {
      kind: 'state',
    })
    expect(reply.session.isController).toBe(true)
    f.changeOwner()
    await expect(
      invokeBrowserSession(f.deps, principal, 'conversation', ctx, {
        kind: 'take',
        controlEpoch: 1,
        targetEpoch: 0,
      }),
    ).rejects.toThrow()
    await expect(
      invokeBrowserSession(f.deps, principal, 'conversation', ctx, { kind: 'state' }),
    ).rejects.toThrow()
    expect(f.get).toHaveBeenCalledTimes(3)
    expect(f.mossFetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the authenticated token and exact session path in the upstream operation', async () => {
    const f = fixture()
    await invokeBrowserSession(f.deps, principal, 'conversation', ctx, {
      kind: 'input',
      input: { kind: 'text', text: 'human input' },
      controlEpoch: 1,
      targetEpoch: 0,
    })
    expect(f.mossFetch).toHaveBeenCalledWith(
      ctx.baseUrl,
      {
        method: 'POST',
        path: '/api/v1/sessions/conversation/browser',
        accessToken: ctx.accessToken,
        body: {
          kind: 'input',
          input: { kind: 'text', text: 'human input' },
          controlEpoch: 1,
          targetEpoch: 0,
        },
      },
      30_000,
    )
  })

  it('preserves an uncertain failure without replaying the operation', async () => {
    const f = fixture()
    f.mossFetch.mockRejectedValueOnce(new Error('connection lost after dispatch'))
    await expect(
      invokeBrowserSession(f.deps, principal, 'conversation', ctx, {
        kind: 'reload',
        controlEpoch: 1,
        targetEpoch: 0,
      }),
    ).rejects.toThrow('connection lost after dispatch')
    expect(f.mossFetch).toHaveBeenCalledTimes(1)
  })

  it('rejects transfers after session ownership changes before dispatching bytes', async () => {
    const f = fixture()
    f.changeOwner()
    const transfer = vi.spyOn(globalThis, 'fetch')
    try {
      await expect(
        receiveBrowserFile(
          f.deps,
          principal,
          'conversation',
          ctx,
          { name: 'review.txt', controlEpoch: 1, targetEpoch: 0 },
          new Uint8Array([1, 2]),
        ),
      ).rejects.toThrow()
      await expect(
        readBrowserFile(f.deps, principal, 'conversation', ctx, 'a'.repeat(32)),
      ).rejects.toThrow()
      expect(transfer).not.toHaveBeenCalled()
      expect(f.get).toHaveBeenCalledTimes(2)
    } finally {
      transfer.mockRestore()
    }
  })
})
