// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { BrowserConnection } from '@server/features/conversations/ConversationCoordinator'

const state = vi.hoisted(() => ({
  lock: null as {
    state: 'idle' | 'running' | 'uncertain'
    writerWebSessionId: string | null
  } | null,
  sockets: [] as {
    isClosed: boolean
    close: ReturnType<typeof vi.fn>
    onEvent: (event: unknown) => void
  }[],
}))
vi.mock('@server/features/conversations/lockRepository', () => ({
  getLock: vi.fn(async () => state.lock && { ...state.lock }),
  acquireWriteLock: vi.fn(async (_pool, input) => {
    state.lock = { state: 'running', writerWebSessionId: input.webSessionId }
    return { ok: true, state: 'running' }
  }),
  markUncertain: vi.fn(async () => {
    state.lock = { state: 'uncertain', writerWebSessionId: null }
  }),
  clearWriterIfIdle: vi.fn(async () => {
    state.lock = { state: 'idle', writerWebSessionId: null }
  }),
  releaseToIdle: vi.fn(async () => {
    state.lock = { state: 'idle', writerWebSessionId: null }
  }),
  releaseToIdleIfHeld: vi.fn(),
  deleteLock: vi.fn(async () => {
    state.lock = null
  }),
}))
vi.mock('@server/features/auth/authService', () => ({
  getMossContext: vi.fn(async () => ({ baseUrl: 'https://moss.test', accessToken: 'fixture' })),
}))
vi.mock('@server/features/conversations/conversationMetaRepository', () => ({
  setConversationTitleIfUnset: vi.fn(async () => {}),
  upsertConversationModel: vi.fn(async () => {}),
}))
vi.mock('@sudowork/moss-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sudowork/moss-client')>()
  return {
    ...actual,
    MossUpstreamSocket: class {
      isClosed = false
      close = vi.fn(() => {
        this.isClosed = true
      })
      onEvent: (event: unknown) => void
      constructor(
        _url: string,
        _token: string,
        _sessionId: string,
        _base: string,
        handlers: { onEvent: (event: unknown) => void },
      ) {
        this.onEvent = handlers.onEvent
        state.sockets.push(this)
      }
      whenOpen() {
        return Promise.resolve()
      }
      send() {
        return !this.isClosed
      }
    },
  }
})

const { ConversationCoordinator } =
  await import('@server/features/conversations/ConversationCoordinator')
function connection(): BrowserConnection {
  return {
    principalId: 'principal-a',
    mossSessionId: 'session-a',
    webSession: { id: 'web-a' },
    ws: { readyState: 1, OPEN: 1, send: vi.fn() },
  } as unknown as BrowserConnection
}
function coordinator() {
  return new ConversationCoordinator({
    pool: {} as never,
    config: {} as never,
    auth: {} as never,
    moss: { resume: vi.fn(async () => ({ wsUrl: 'wss://moss.test/ws' })) } as never,
  })
}
beforeEach(() => {
  state.lock = null
  state.sockets.length = 0
})

describe('conversation reconnect during generation', () => {
  test('keeps the upstream until a returning browser receives completion and can send again', async () => {
    const service = coordinator(),
      original = connection()
    service.subscribe(original)
    await service.handleClientMessage(original, { kind: 'send', text: 'QA' })
    const upstream = state.sockets[0]!
    await service.unsubscribe(original)
    expect(state.lock?.state).toBe('uncertain')
    expect(upstream.close).not.toHaveBeenCalled()
    const returning = connection()
    service.subscribe(returning)
    upstream.onEvent({ type: 'result', result: 'finished' })
    await vi.waitFor(() => expect(state.lock?.state).toBe('idle'))
    expect(returning.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ kind: 'upstream', event: { type: 'result', result: 'finished' } }),
    )
    expect(upstream.close).not.toHaveBeenCalled()
    await service.handleClientMessage(returning, { kind: 'send', text: 'Next turn' })
    expect(state.sockets).toHaveLength(1)
    await service.terminate('principal-a', 'session-a')
  })

  test('closes the retained upstream after completion if no browser returns', async () => {
    const service = coordinator(),
      original = connection()
    service.subscribe(original)
    await service.handleClientMessage(original, { kind: 'send', text: 'QA' })
    const upstream = state.sockets[0]!
    await service.unsubscribe(original)
    expect(upstream.close).not.toHaveBeenCalled()
    upstream.onEvent({ type: 'result', result: 'finished' })
    await vi.waitFor(() => expect(upstream.close).toHaveBeenCalledOnce())
    service.subscribe(connection())
    await service.handleClientMessage(connection(), { kind: 'send', text: 'New turn' })
    expect(state.sockets).toHaveLength(2)
  })
})
