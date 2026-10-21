// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { MossHttpError } from '@sudowork/moss-client'
import { getMossContext } from '@server/features/auth/authService'
import type { AuthedRequest } from '@server/features/auth/sessionMiddleware'
vi.mock('@server/features/auth/authService', () => ({
  getMossContext: vi.fn(async (_deps, session, isForced) => ({
    baseUrl: 'http://moss.test',
    accessToken: isForced ? `${session.principalId}-refreshed` : session.principalId,
  })),
}))
const { createExternalProviderRouter } =
  await import('@server/features/externalProviders/externalProviderRoutes')
afterEach(() => {
  vi.useRealTimers()
})
const upstream = vi.fn(async () => ({ success: true, data: [] }))
beforeEach(() => {
  upstream.mockReset()
  upstream.mockResolvedValue({ success: true, data: [] })
  vi.mocked(getMossContext).mockClear()
})
function app(principalId?: string) {
  const server = express()
  server.use(express.json())
  server.use((req, _res, next) => {
    if (principalId)
      (req as AuthedRequest).webSession = {
        principalId,
        encryptedMossTokens: Buffer.from('synthetic-encrypted'),
        mossBaseUrl: 'http://moss.test',
      } as AuthedRequest['webSession']
    next()
  })
  server.use('/api/v1', createExternalProviderRouter({ auth: {} as never, request: upstream }))
  return server
}
it('requires a session and leaves admin registration out of the WebUI proxy', async () => {
  expect((await request(app()).get('/api/v1/external-agents')).status).toBe(401)
  expect((await request(app('u')).post('/api/v1/external-agents').send({})).status).toBe(404)
})

it('forwards version pagination and evidence reads using the authenticated caller', async () => {
  expect((await request(app()).get('/api/v1/external-agents/agent-1/versions')).status).toBe(401)
  await request(app('member')).get('/api/v1/external-agents/agent-1/versions?after=1.0.0')
  expect(upstream).toHaveBeenLastCalledWith(
    'http://moss.test',
    {
      method: 'GET',
      path: '/api/v1/external-agents/agent-1/versions',
      accessToken: 'member',
      searchParams: { after: '1.0.0' },
    },
    expect.any(Number),
  )
  await request(app('member')).get('/api/v1/tasks/task-1/evidence')
  expect(upstream).toHaveBeenLastCalledWith(
    'http://moss.test',
    { method: 'GET', path: '/api/v1/tasks/task-1/evidence', accessToken: 'member' },
    expect.any(Number),
  )
})
it('forwards each session token, request key and cursor independently', async () => {
  await request(app('u1')).get('/api/v1/tasks/task-1/events?cursor=8')
  expect(upstream).toHaveBeenLastCalledWith(
    'http://moss.test',
    {
      method: 'GET',
      path: '/api/v1/tasks/task-1/events',
      accessToken: 'u1',
      searchParams: { cursor: '8' },
    },
    expect.any(Number),
  )
  const body = { agent_id: 'a', query: 'synthetic', idempotency_key: 'same-key' }
  const response = await request(app('u2')).post('/api/v1/tasks').send(body)
  expect(response.status).toBe(202)
  expect(upstream).toHaveBeenLastCalledWith(
    'http://moss.test',
    {
      method: 'POST',
      path: '/api/v1/tasks',
      accessToken: 'u2',
      body,
    },
    expect.any(Number),
  )
})
it('forwards admin writes through the caller session and never exposes unrestricted upstream paths', async () => {
  const body = { endpoint: 'http://127.0.0.1/v1', api_key: 'synthetic-key' }
  const response = await request(app('admin'))
    .post('/api/v1/external-agents/admin/inspect')
    .send(body)
  expect(response.status).toBe(200)
  expect(upstream).toHaveBeenLastCalledWith(
    'http://moss.test',
    {
      method: 'POST',
      path: '/api/v1/external-agents/admin/inspect',
      accessToken: 'admin',
      body,
    },
    expect.any(Number),
  )
  expect(
    (await request(app()).post('/api/v1/external-agents/admin/onboard').send(body)).status,
  ).toBe(401)
  expect(
    (await request(app('admin')).post('/api/v1/external-agents/admin/arbitrary-action').send({}))
      .status,
  ).toBe(404)
})

it('retries an unexpected upstream 401 exactly once with the same request body', async () => {
  upstream.mockRejectedValueOnce(new MossHttpError(401, 'Unauthorized', '{}'))
  const body = { agent_id: 'a', query: 'synthetic', idempotency_key: 'same-key' }
  expect((await request(app('u')).post('/api/v1/tasks').send(body)).status).toBe(202)
  expect(upstream).toHaveBeenCalledTimes(2)
  expect(getMossContext).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), true)
  expect(upstream).toHaveBeenLastCalledWith(
    'http://moss.test',
    expect.objectContaining({ accessToken: 'u-refreshed', body }),
    expect.any(Number),
  )
})
it('stops after the second 401 and reports local context without upstream traffic', async () => {
  upstream.mockRejectedValue(new MossHttpError(401, 'Unauthorized', '{}'))
  expect((await request(app('u')).get('/api/v1/external-agents')).status).toBe(401)
  expect(upstream).toHaveBeenCalledTimes(2)
  upstream.mockClear()
  const context = await request(app('u')).get('/api/v1/external-context')
  expect(context.body.data.isAvailable).toBe(true)
  expect(upstream).not.toHaveBeenCalled()
})

it('rejects stale browser identity before forwarding a task', async () => {
  const response = await request(app('current-user'))
    .post('/api/v1/tasks')
    .set('X-Sudo-External-Identity', JSON.stringify(['http://moss.test', 'previous-user']))
    .send({ agent_id: 'a', query: 'synthetic', idempotency_key: 'same-key' })
  expect(response.status).toBe(409)
  expect(response.body.error).toBe('EXTERNAL_IDENTITY_CHANGED')
  expect(upstream).not.toHaveBeenCalled()
})

it('bounds token refresh and never dispatches a late retry after the proxy deadline', async () => {
  vi.useFakeTimers()
  let release!: (value: Awaited<ReturnType<typeof getMossContext>>) => void
  let enter!: () => void
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  upstream.mockRejectedValueOnce(new MossHttpError(401, 'Unauthorized', '{}'))
  vi.mocked(getMossContext).mockImplementationOnce(async () => ({
    baseUrl: 'http://moss.test',
    accessToken: 'u',
  }))
  vi.mocked(getMossContext).mockImplementationOnce(async () => {
    enter()
    return new Promise((resolve) => {
      release = resolve
    })
  })
  const pending = request(app('u'))
    .post('/api/v1/tasks')
    .send({ agent_id: 'a', query: 'synthetic', idempotency_key: 'same-key' })
    .then((value) => value)
  try {
    await entered
    await vi.advanceTimersByTimeAsync(15_000)
    const response = await pending
    expect(response.status).toBe(504)
    expect(response.body.error).toBe('EXTERNAL_TASK_TIMEOUT')
    release({ baseUrl: 'http://moss.test', accessToken: 'late-token' })
    await vi.advanceTimersByTimeAsync(1)
    expect(upstream).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})

it('hosted routes require a session and forward cleanup under the same caller', async () => {
  expect((await request(app()).get('/api/v1/hosted-agents')).status).toBe(401)
  await request(app('member')).get('/api/v1/hosted-agents?after=cursor')
  expect(upstream).toHaveBeenLastCalledWith('http://moss.test', { method: 'GET', path: '/api/v1/hosted-agents', accessToken: 'member', searchParams: { after: 'cursor' } }, expect.any(Number))
  for (const action of ['cancel', 'reconcile', 'close']) {
    const body = action === 'close' ? { note: 'Cleanup confirmed' } : {}
    await request(app('member')).post(`/api/v1/tasks/task-1/${action}`).send(body)
    expect(upstream).toHaveBeenLastCalledWith('http://moss.test', { method: 'POST', path: `/api/v1/tasks/task-1/${action}`, accessToken: 'member', body }, expect.any(Number))
  }
  expect((await request(app('member')).post('/api/v1/hosted-agents/register').send({})).status).toBe(404)
})
