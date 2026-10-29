// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createMossOntologyPort, createMossSessionPort, MossHttpError } from '@sudowork/moss-client'
import { CreateConversationRequestSchema } from '@sudowork/contracts/conversations'
import type { AuthedRequest } from '@server/features/auth/sessionMiddleware'

vi.mock('@server/features/auth/authService', () => ({
  getMossContext: vi.fn(async () => ({
    baseUrl: 'https://current-moss.invalid',
    accessToken: 'current-user-token',
  })),
}))
const { createOntologyRouter } = await import('@server/features/ontology/ontologyRoutes')
const projectId = '9ab3a688-1b15-431e-8b69-5a9f0c9d9dab'
const wire = {
  project_id: projectId,
  authority_ref: 'sales',
  model_ref: 'sales-model',
  source_refs: ['sales-source'],
}
const project = {
  projectId,
  authorityRef: 'sales',
  modelRef: 'sales-model',
  sourceRefs: ['sales-source'],
}
const upstream = vi.fn()

function app(isAuthenticated = true) {
  const result = express()
  result.use((req, _res, next) => {
    if (isAuthenticated)
      (req as AuthedRequest).webSession = {
        id: 'review-session',
        principalId: 'owner',
      } as AuthedRequest['webSession']
    next()
  })
  result.use('/api/ontology', createOntologyRouter({ auth: {} as never, request: upstream }))
  return result
}

beforeEach(() => {
  upstream.mockReset()
  upstream.mockResolvedValue({
    projects: [
      {
        ...wire,
        worker_url: 'https://private-worker.invalid',
        credential: 'must-not-escape',
        text: 'private-context',
      },
    ],
  })
})

test('project discovery uses the current session and strips non-reference fields', async () => {
  const response = await request(app())
    .get('/api/ontology/projects')
    .set('Authorization', 'Bearer forged')
  expect(response.status).toBe(200)
  expect(response.headers['cache-control']).toBe('no-store')
  expect(response.body).toEqual({ projects: [project] })
  expect(upstream).toHaveBeenCalledExactlyOnceWith('https://current-moss.invalid', {
    method: 'GET',
    path: '/api/v1/ontology/projects',
    accessToken: 'current-user-token',
  })
})

test('anonymous requests cannot use bearer text to discover a model', async () => {
  expect(
    (await request(app(false)).get('/api/ontology/projects').set('Authorization', 'Bearer forged'))
      .status,
  ).toBe(401)
  expect(upstream).not.toHaveBeenCalled()
})

test.each([403, 404, 409, 503])(
  'upstream %s is explicit without disclosing its raw body',
  async (status) => {
    upstream.mockRejectedValue(
      new MossHttpError(status, 'private-worker-and-credential', '/private'),
    )
    const response = await request(app()).get('/api/ontology/projects')
    expect(response.status).toBe(status)
    expect(response.body).toEqual({ error: 'MODEL_PROJECT_UNAVAILABLE' })
  },
)

test('malformed project identities fail rather than masquerading as an empty inventory', async () => {
  upstream.mockResolvedValue({ projects: [{ ...wire, project_id: '/srv/models/customer' }] })
  const response = await request(app()).get('/api/ontology/projects')
  expect(response.status).toBe(502)
  expect(response.body).toEqual({ error: 'INVALID_MODEL_PROJECT_RESPONSE' })
})

test('discovery does not provide a worker/model registration proxy', async () => {
  expect(
    (
      await request(app())
        .post('/api/ontology/projects')
        .send({ worker_url: 'https://caller.invalid' })
    ).status,
  ).toBe(404)
  expect(upstream).not.toHaveBeenCalled()
})

test('the shared client recovers a session binding and preserves an ordinary null binding', async () => {
  const ctx = { baseUrl: 'https://owner-moss.invalid', accessToken: 'owner-token' }
  const port = createMossOntologyPort(upstream)
  upstream.mockResolvedValueOnce({ project: { ...wire, context: 'must-not-escape' } })
  expect(await port.sessionProject(ctx, 'session/with-segment')).toEqual(project)
  expect(upstream).toHaveBeenLastCalledWith(ctx.baseUrl, {
    method: 'GET',
    path: '/api/v1/sessions/session%2Fwith-segment/ontology-project',
    accessToken: ctx.accessToken,
  })
  upstream.mockResolvedValueOnce({ project: null })
  expect(await port.sessionProject(ctx, 'ordinary')).toBeNull()
})

test('ordinary session creation and canonical creation use the same client without a business prompt', async () => {
  const ctx = { baseUrl: 'https://owner-moss.invalid', accessToken: 'owner-token' }
  const port = createMossSessionPort(upstream)
  upstream.mockResolvedValue({
    session_id: 'new-session',
    ws_url: 'wss://owner-moss.invalid/session',
  })
  const input = { assistantName: 'owner-agent', enabledSkills: [] }
  await port.create(ctx, input)
  expect(upstream.mock.calls[0]?.[1].body).not.toHaveProperty('ontology_project_id')
  const canonical = CreateConversationRequestSchema.parse({
    ...input,
    ontologyProjectId: projectId,
  })
  await port.create(ctx, canonical)
  expect(upstream.mock.calls[1]?.[1].body).toEqual({
    assistant_name: input.assistantName,
    enabled_skills: [],
    dangerously_skip_permissions: false,
    ontology_project_id: projectId,
  })
  expect(() =>
    CreateConversationRequestSchema.parse({ ...input, ontologyProjectId: '/srv/model' }),
  ).toThrow()
})
