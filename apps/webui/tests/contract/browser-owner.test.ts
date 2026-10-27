import { describe, expect, test, vi } from 'vitest'
import { MossHttpError } from '@sudowork/moss-client'
import { browserOwnerInfo, invokeBrowserSession } from '../../src/server/features/conversations/browserSessionService'

const PRINCIPAL = { id: 'p1', mossUserId: 'owner', orgId: 'org', username: 'owner' }
const CTX = { accessToken: 'tk', baseUrl: 'http://moss.test' }
const SESSION = { sessionId: 's1', userId: 'owner', orgId: 'org', status: 'active' }

function deps(mossFetch: ReturnType<typeof vi.fn>) {
  return { moss: { get: async () => SESSION }, mossFetch }
}

describe('browser session upstream errors', () => {
  test('owner info reads the dedicated endpoint and parses the owner payload', async () => {
    const mossFetch = vi.fn().mockResolvedValue({ owner: { sessionId: 'occupant', desiredState: 'active' }, browserRunning: true })
    const info = await browserOwnerInfo(deps(mossFetch), PRINCIPAL, 's1', CTX)
    expect(info).toEqual({ owner: { sessionId: 'occupant', desiredState: 'active' }, browserRunning: true })
    expect(mossFetch).toHaveBeenCalledWith(CTX.baseUrl, { method: 'GET', path: '/api/v1/sessions/s1/browser-owner', accessToken: 'tk' }, 30_000)
  })

  test('a snake_case 404 upstream code passes through instead of the MOSS_* rewrite', async () => {
    const mossFetch = vi.fn().mockRejectedValue(new MossHttpError(404, '{"error":"session_not_found"}', '/browser'))
    await expect(invokeBrowserSession(deps(mossFetch), PRINCIPAL, 's1', CTX, { kind: 'state' })).rejects.toMatchObject({ statusCode: 404, code: 'session_not_found' })
  })

  test('a non-snake upstream 403 maps to the browser-specific cause', async () => {
    const mossFetch = vi.fn().mockRejectedValue(new MossHttpError(403, '{"error":"Forbidden"}', '/browser'))
    await expect(invokeBrowserSession(deps(mossFetch), PRINCIPAL, 's1', CTX, { kind: 'state' })).rejects.toMatchObject({ statusCode: 403, code: 'browser_session_forbidden' })
  })
})
