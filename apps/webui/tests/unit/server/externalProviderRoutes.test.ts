// @vitest-environment node
import { expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import type { AuthedRequest } from '@server/features/auth/sessionMiddleware'
vi.mock('@server/features/auth/authService', () => ({
  getMossContext: vi.fn(async (_deps, session) => ({
    baseUrl: 'http://moss.test',
    accessToken: session.principalId,
  })),
}))
const { createExternalProviderRouter } =
  await import('@server/features/externalProviders/externalProviderRoutes')
const upstream = vi.fn(async () => ({ success: true, data: [] }))
function app(principalId?: string) {
  const server = express()
  server.use(express.json())
  server.use((req, _res, next) => {
    if (principalId)
      (req as AuthedRequest).webSession = { principalId } as AuthedRequest['webSession']
    next()
  })
  server.use('/api/v1', createExternalProviderRouter({ auth: {} as never, request: upstream }))
  return server
}
it('requires a session and leaves admin registration out of the WebUI proxy', async () => {
  expect((await request(app()).get('/api/v1/external-agents')).status).toBe(401)
  expect((await request(app('u')).post('/api/v1/external-agents').send({})).status).toBe(404)
})
it('forwards each session token, request key and cursor independently', async () => {
  await request(app('u1')).get('/api/v1/tasks/task-1/events?cursor=8')
  expect(upstream).toHaveBeenLastCalledWith('http://moss.test', {
    method: 'GET',
    path: '/api/v1/tasks/task-1/events',
    accessToken: 'u1',
    searchParams: { cursor: '8' },
  })
  const body = { agent_id: 'a', query: 'synthetic', idempotency_key: 'same-key' }
  const response = await request(app('u2')).post('/api/v1/tasks').send(body)
  expect(response.status).toBe(202)
  expect(upstream).toHaveBeenLastCalledWith('http://moss.test', {
    method: 'POST',
    path: '/api/v1/tasks',
    accessToken: 'u2',
    body,
  })
})
it('forwards admin writes through the caller session and never exposes unrestricted upstream paths', async () => {
  const body = { endpoint: 'http://127.0.0.1/v1', api_key: 'synthetic-key' }
  const response = await request(app('admin'))
    .post('/api/v1/external-agents/admin/inspect')
    .send(body)
  expect(response.status).toBe(200)
  expect(upstream).toHaveBeenLastCalledWith('http://moss.test', {
    method: 'POST',
    path: '/api/v1/external-agents/admin/inspect',
    accessToken: 'admin',
    body,
  })
  expect(
    (await request(app()).post('/api/v1/external-agents/admin/onboard').send(body)).status,
  ).toBe(401)
  expect(
    (await request(app('admin')).post('/api/v1/external-agents/admin/arbitrary-action').send({}))
      .status,
  ).toBe(404)
})
