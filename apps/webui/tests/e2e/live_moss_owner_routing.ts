/** Run against a fresh operator-owned Moss session; credentials arrive on stdin. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  buildUserMessage,
  decodeMossEventPayloads,
  deriveWsBaseUrl,
  MossUpstreamSocket,
  validateMossWsUrl,
} from '@sudowork/moss-client'

const input = JSON.parse(readFileSync(0, 'utf8')) as { baseUrl: string; accessToken: string }
const base = new URL(input.baseUrl)
assert.equal(base.protocol, 'https:')
assert(!base.username && !base.password && !base.search && !base.hash)
assert(input.accessToken)
let sessionId: string | undefined
let socket: MossUpstreamSocket | undefined
const report: Record<string, unknown> = { passed: false, realModelTurns: 0 }

interface ModelEvent {
  type?: string
  is_error?: boolean
  message?: { content?: string | { text?: string }[] }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(new URL(path, base), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${input.accessToken}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error',
    signal: AbortSignal.timeout(180_000),
  })
  const raw = await response.text()
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}: ${raw.slice(0, 500)}`)
  return JSON.parse(raw) as T
}

async function turn(wsUrl: string, text: string): Promise<string> {
  assert(sessionId)
  const validated = validateMossWsUrl(wsUrl, sessionId, deriveWsBaseUrl(base.href))
  assert.deepEqual([...validated.searchParams.keys()], ['moss_route'])
  report.routingHintPreserved = true
  const events: ModelEvent[] = []
  const failures: string[] = []
  socket = new MossUpstreamSocket(wsUrl, input.accessToken, sessionId, deriveWsBaseUrl(base.href), {
    onEvent(event) {
      events.push(...decodeMossEventPayloads(event))
    },
    onError(error) {
      failures.push(error.message)
    },
    onClose(code, reason) {
      if (code !== 1000) failures.push(`Closed ${code}: ${reason}`)
    },
  })
  try {
    await socket.whenOpen()
    assert(socket.send(buildUserMessage({ sessionId, text, images: [], parentToolUseId: null })))
    const deadline = Date.now() + 180_000
    let processed = 0
    let assistant = ''
    while (Date.now() < deadline) {
      assert.equal(failures.length, 0, failures.join('\n'))
      for (const event of events.slice(processed)) {
        processed += 1
        assert(event.type !== 'error', JSON.stringify(event))
        if (event.type === 'assistant') {
          const content = event.message?.content ?? []
          assistant +=
            typeof content === 'string'
              ? content
              : content.map((block: { text?: string }) => block.text ?? '').join('')
        }
        if (event.type === 'result') {
          assert(!event.is_error, JSON.stringify(event))
          report.realModelTurns = Number(report.realModelTurns) + 1
          return assistant.trim()
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('No real model result within the normal 180s acceptance deadline')
  } finally {
    socket.close(true)
    socket = undefined
  }
}

try {
  const me = await request<{ user?: { id: string } }>('/api/v1/auth/me')
  report.ownerId = me.user?.id
  const created = await request<{ runtime?: { type: string }; session_id: string; ws_url: string }>(
    '/api/v1/sessions',
    { runtime: { type: 'cohost' } },
  )
  assert.equal(created.runtime?.type, 'cohost')
  assert(typeof created.session_id === 'string')
  sessionId = created.session_id
  report.sessionId = sessionId
  const marker = `ROUTED_${randomUUID().replaceAll('-', '')}`
  assert.equal(
    await turn(created.ws_url, `Remember ${marker}. Do not use tools. Reply exactly ${marker}.`),
    marker,
  )
  const resumed = await request<{ session: { sessionId: string }; ws_url: string }>(
    `/api/v1/sessions/${sessionId}/resume`,
    {},
  )
  assert.equal(resumed.session.sessionId, sessionId)
  assert.equal(
    await turn(
      resumed.ws_url,
      'Without using tools, reply exactly the marker I asked you to remember.',
    ),
    marker,
  )
  report.disconnectResumePreservedContext = true
  report.passed = true
} catch (error) {
  report.failure =
    error instanceof Error
      ? error.message.replaceAll(input.accessToken, '[redacted]')
      : String(error)
  process.exitCode = 1
} finally {
  socket?.close(true)
  if (sessionId) {
    try {
      await request(`/api/v1/sessions/${sessionId}/terminate`, {})
      report.ownedFreshFixtureTerminated = true
    } catch (error) {
      report.cleanupFailure =
        error instanceof Error
          ? error.message.replaceAll(input.accessToken, '[redacted]')
          : String(error)
      process.exitCode = 1
    }
  }
  console.log(JSON.stringify(report))
}
