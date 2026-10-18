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
    onClose: () => void
    send: ReturnType<typeof vi.fn>
  }[],
  resumeFailure: null as Error | null,
  openFailure: null as Error | null,
  resumeGate: null as Promise<void> | null,
  resumeCalls: 0,
  releaseGate: null as Promise<void> | null,
  releaseCalls: 0,
  completionGate: null as Promise<void> | null,
  isSendRefused: false,
}))
vi.mock('@server/features/conversations/lockRepository', () => ({
  getLock: vi.fn(async () => state.lock && { ...state.lock }),
  getUncertainLockVersion: vi.fn(async () => (state.lock?.state === 'uncertain' ? 'v1' : null)),
  acquireRecoveredWriteLock: vi.fn(async (_pool, input) => {
    if (state.lock?.state !== 'uncertain') return false
    state.lock = { state: 'running', writerWebSessionId: input.webSessionId }
    return true
  }),
  acquireWriteLock: vi.fn(async (_pool, input) => {
    if (state.lock?.state === 'uncertain') return { ok: false, reason: 'UNCERTAIN' }
    if (
      state.lock?.state === 'running' &&
      (input.isExistingTurnAllowed === false ||
        state.lock.writerWebSessionId !== input.webSessionId)
    )
      return { ok: false, reason: 'BUSY', holderWebSessionId: state.lock.writerWebSessionId }
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
    if (state.completionGate) await state.completionGate
  }),
  releaseToIdleIfHeld: vi.fn(async (_pool, input) => {
    state.releaseCalls++
    if (state.releaseGate) await state.releaseGate
    if (state.lock?.state !== 'running' || state.lock.writerWebSessionId !== input.webSessionId)
      return false
    state.lock = { state: 'idle', writerWebSessionId: input.webSessionId }
    return true
  }),
  deleteLock: vi.fn(async () => {
    state.lock = null
  }),
}))
vi.mock('@server/features/auth/authService', () => ({
  getMossContext: vi.fn(async () => ({ baseUrl: 'https://moss.test', accessToken: 'fixture' })),
  MossUnauthorizedError: class extends Error {},
}))
vi.mock('@server/features/auth/principalRepository', () => ({
  findPrincipalById: vi.fn(async () => ({
    id: 'principal-a',
    mossUserId: 'moss-a',
    orgId: 'org-a',
  })),
  resolveSessionOwnerPrincipalId: vi.fn(async () => 'principal-a'),
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
      onClose: () => void
      send = vi.fn(() => !this.isClosed && !state.isSendRefused)
      constructor(
        _url: string,
        _token: string,
        _sessionId: string,
        _base: string,
        handlers: { onEvent: (event: unknown) => void; onClose: () => void },
      ) {
        this.onEvent = handlers.onEvent
        this.onClose = handlers.onClose
        state.sockets.push(this)
      }
      whenOpen() {
        if (state.openFailure) {
          this.isClosed = true
          queueMicrotask(() => this.onClose())
          return Promise.reject(state.openFailure)
        }
        return Promise.resolve()
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
    webSession: { id: 'web-a', principalId: 'principal-a' },
    ws: { readyState: 1, OPEN: 1, send: vi.fn() },
  } as unknown as BrowserConnection
}
function coordinator(activity = vi.fn(async () => ({ attemptId: 'current', state: 'busy' }))) {
  return new ConversationCoordinator({
    pool: {} as never,
    config: {} as never,
    auth: {} as never,
    moss: {
      get: vi.fn(async () => ({
        sessionId: 'session-a',
        userId: 'moss-a',
        orgId: 'org-a',
        status: 'active',
      })),
      resume: vi.fn(async () => {
        state.resumeCalls++
        if (state.resumeGate) await state.resumeGate
        if (state.resumeFailure) throw state.resumeFailure
        return { wsUrl: 'wss://moss.test/ws', session: { attemptId: 'current' } }
      }),
      activity,
    } as never,
  })
}
beforeEach(() => {
  state.lock = null
  state.sockets.length = 0
  state.resumeFailure = null
  state.openFailure = null
  state.resumeGate = null
  state.resumeCalls = 0
  state.releaseGate = null
  state.releaseCalls = 0
  state.completionGate = null
  state.isSendRefused = false
})

describe('conversation reconnect during generation', () => {
  test('admits a new explicit message after confirming the resumed current execution is idle', async () => {
    const activity = vi.fn(async () => ({ attemptId: 'current', state: 'idle' }))
    const service = coordinator(activity),
      browser = connection()
    service.subscribe(browser)
    state.lock = { state: 'uncertain', writerWebSessionId: null }
    await service.handleClientMessage(browser, {
      kind: 'send',
      text: 'Check existing results and continue',
    })
    expect(activity).toHaveBeenCalledTimes(1)
    expect(state.sockets).toHaveLength(1)
    expect(state.sockets[0]!.send).toHaveBeenCalledTimes(1)
    expect(state.lock?.state).toBe('running')
    await service.terminate('principal-a', 'session-a')
  })

  test.each([
    { attemptId: 'current', state: 'busy' },
    { attemptId: 'current', state: 'unavailable' },
    { attemptId: 'old', state: 'idle' },
    { attemptId: null, state: 'idle' },
  ])('preserves uncertainty when live activity cannot authorize a new turn: %j', async (reply) => {
    const service = coordinator(vi.fn(async () => reply) as never),
      browser = connection()
    service.subscribe(browser)
    state.lock = { state: 'uncertain', writerWebSessionId: null }
    await service.handleClientMessage(browser, { kind: 'send', text: 'New request' })
    expect(state.sockets).toHaveLength(0)
    expect(state.lock?.state).toBe('uncertain')
    expect(browser.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ kind: 'error', code: 'LOCK_UNCERTAIN' }),
    )
    await service.terminate('principal-a', 'session-a')
  })

  test('does not release a newer running lock while an idle observation is in flight', async () => {
    const service = coordinator(
        vi.fn(async () => {
          state.lock = { state: 'running', writerWebSessionId: 'another-writer' }
          return { attemptId: 'current', state: 'idle' }
        }),
      ),
      browser = connection()
    service.subscribe(browser)
    state.lock = { state: 'uncertain', writerWebSessionId: null }
    await service.handleClientMessage(browser, { kind: 'send', text: 'New request' })
    expect(state.sockets).toHaveLength(0)
    expect(state.lock).toEqual({ state: 'running', writerWebSessionId: 'another-writer' })
    await service.terminate('principal-a', 'session-a')
  })

  test('retires stale result and close callbacks before the recovered turn starts', async () => {
    const service = coordinator(vi.fn(async () => ({ attemptId: 'current', state: 'idle' }))),
      browser = connection()
    service.subscribe(browser)
    await service.handleClientMessage(browser, { kind: 'send', text: 'Original' })
    const old = state.sockets[0]!
    old.isClosed = true
    state.lock = { state: 'uncertain', writerWebSessionId: null }
    await service.handleClientMessage(browser, { kind: 'send', text: 'New request' })
    old.onEvent({ type: 'result', result: 'late old completion' })
    old.onClose()
    await service.handleClientMessage(browser, {
      kind: 'control_response',
      requestId: 'p1',
      optionId: 'allow_once',
    })
    expect(state.sockets).toHaveLength(2)
    expect(state.lock?.state).toBe('running')
    expect(browser.ws.send).not.toHaveBeenCalledWith(expect.stringContaining('late old completion'))
    await service.terminate('principal-a', 'session-a')
  })

  test('finishes the accepted turn before another send or browser return can reserve delivery', async () => {
    const service = coordinator(),
      browser = connection()
    service.subscribe(browser)
    await service.handleClientMessage(browser, { kind: 'send', text: 'Accepted' })
    let complete!: () => void
    state.completionGate = new Promise<void>((resolve) => {
      complete = resolve
    })
    const result = { type: 'result', result: 'First completed' }
    state.sockets[0]!.onEvent(result)
    await vi.waitFor(() => expect(state.lock?.state).toBe('idle'))
    await service.handleClientMessage(browser, { kind: 'send', text: 'Too early' })
    expect(browser.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ kind: 'error', code: 'CONVERSATION_BUSY' }),
    )
    await expect(
      service.prepareBrowserReturn(browser.webSession, browser.mossSessionId),
    ).rejects.toThrow('browser_return_conversation_busy')
    expect(state.sockets[0]!.send).toHaveBeenCalledOnce()
    complete()
    await vi.waitFor(() =>
      expect(browser.ws.send).toHaveBeenCalledWith(
        JSON.stringify({ kind: 'upstream', event: result }),
      ),
    )
    await service.handleClientMessage(browser, { kind: 'send', text: 'Next turn' })
    expect(state.sockets[0]!.send).toHaveBeenCalledTimes(2)
    await service.terminate('principal-a', 'session-a')
  })

  test.each(['resume', 'websocket', 'send'])(
    'allows another turn after a known pre-delivery %s failure',
    async (stage) => {
      const service = coordinator(),
        browser = connection()
      service.subscribe(browser)
      if (stage === 'resume') state.resumeFailure = new Error('startup refused')
      if (stage === 'websocket') state.openFailure = new Error('handshake refused')
      if (stage === 'send') state.isSendRefused = true
      await service.handleClientMessage(browser, { kind: 'send', text: 'Not delivered' })
      await vi.waitFor(() => expect(state.lock?.state).toBe('idle'))
      const retired = state.sockets[0]
      state.resumeFailure = null
      state.openFailure = null
      state.isSendRefused = false
      await service.handleClientMessage(browser, { kind: 'send', text: 'Explicit retry' })
      expect(state.lock?.state).toBe('running')
      if (stage === 'websocket' && retired) {
        retired.onClose()
        retired.onEvent({ type: 'result', result: 'stale completion' })
        await Promise.resolve()
        expect(state.lock?.state).toBe('running')
      }
      await service.terminate('principal-a', 'session-a')
    },
  )

  test('keeps an accepted turn uncertain after losing its upstream', async () => {
    const service = coordinator(),
      browser = connection()
    service.subscribe(browser)
    await service.handleClientMessage(browser, { kind: 'send', text: 'Accepted turn' })
    const upstream = state.sockets[0]!
    expect(upstream.send).toHaveBeenCalledOnce()
    upstream.isClosed = true
    upstream.onClose()
    await vi.waitFor(() => expect(state.lock?.state).toBe('uncertain'))
    await service.handleClientMessage(browser, { kind: 'send', text: 'Must not be replayed' })
    expect(state.resumeCalls).toBe(2)
    expect(upstream.send).toHaveBeenCalledOnce()
    expect(browser.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ kind: 'error', code: 'LOCK_UNCERTAIN' }),
    )
    await service.terminate('principal-a', 'session-a')
  })

  test('never dispatches a prepared prompt after its writer disconnects', async () => {
    const service = coordinator(),
      browser = connection()
    let resume!: () => void
    state.resumeGate = new Promise<void>((resolve) => {
      resume = resolve
    })
    service.subscribe(browser)
    const sending = service.handleClientMessage(browser, {
      kind: 'send',
      text: 'Cancelled preparation',
    })
    await vi.waitFor(() => expect(state.resumeCalls).toBe(1))
    Object.assign(browser.ws, { readyState: 3 })
    await service.unsubscribe(browser)
    expect(state.lock?.state).toBe('idle')
    resume()
    await sending
    expect(state.sockets).toHaveLength(0)
    await service.terminate('principal-a', 'session-a')
  })

  test('rejects a second new turn and external browser return while preparing the first', async () => {
    const service = coordinator(),
      browser = connection()
    let resume!: () => void
    state.resumeGate = new Promise<void>((resolve) => {
      resume = resolve
    })
    service.subscribe(browser)
    const sending = service.handleClientMessage(browser, { kind: 'send', text: 'First turn' })
    await vi.waitFor(() => expect(state.resumeCalls).toBe(1))
    await service.handleClientMessage(browser, { kind: 'send', text: 'Overlapping turn' })
    expect(browser.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ kind: 'error', code: 'CONVERSATION_BUSY' }),
    )
    await expect(
      service.prepareBrowserReturn(browser.webSession, browser.mossSessionId),
    ).rejects.toThrow('browser_return_conversation_busy')
    resume()
    await sending
    expect(state.resumeCalls).toBe(1)
    expect(state.sockets[0]!.send).toHaveBeenCalledOnce()
    await service.terminate('principal-a', 'session-a')
  })

  test('shares pending cleanup so repeated disconnects cannot release a later turn', async () => {
    const service = coordinator(),
      browser = connection()
    let resume!: () => void, release!: () => void
    state.resumeGate = new Promise<void>((resolve) => {
      resume = resolve
    })
    state.releaseGate = new Promise<void>((resolve) => {
      release = resolve
    })
    service.subscribe(browser)
    const sending = service.handleClientMessage(browser, { kind: 'send', text: 'Unsent' })
    await vi.waitFor(() => expect(state.resumeCalls).toBe(1))
    Object.assign(browser.ws, { readyState: 3 })
    const disconnects = Promise.all([service.unsubscribe(browser), service.unsubscribe(browser)])
    await vi.waitFor(() => expect(state.releaseCalls).toBe(1))
    release()
    await disconnects
    resume()
    await sending
    expect(state.releaseCalls).toBe(1)
    expect(state.lock?.state).toBe('idle')
    expect(state.sockets).toHaveLength(0)
    await service.terminate('principal-a', 'session-a')
  })

  test('keeps the writer active while another tab in the same authenticated session remains connected', async () => {
    const service = coordinator(),
      original = connection(),
      viewer = connection()
    service.subscribe(original)
    service.subscribe(viewer)
    await service.prepareBrowserReturn(original.webSession, original.mossSessionId)
    await service.unsubscribe(original)
    expect(state.lock).toEqual({ state: 'running', writerWebSessionId: 'web-a' })
    expect(state.sockets[0]!.close).not.toHaveBeenCalled()
    await service.unsubscribe(viewer)
    expect(state.lock?.state).toBe('uncertain')
    await service.terminate('principal-a', 'session-a')
  })
  test('reserves the first browser handoff until the actual model turn finishes', async () => {
    const service = coordinator(),
      browser = connection()
    service.subscribe(browser)
    expect(state.sockets).toHaveLength(0)
    await service.prepareBrowserReturn(browser.webSession, browser.mossSessionId)
    expect(state.sockets).toHaveLength(1)
    expect(state.lock).toEqual({ state: 'running', writerWebSessionId: 'web-a' })
    const event = { type: 'assistant', message: { content: 'The browser stays stopped' } }
    state.sockets[0]!.onEvent(event)
    await vi.waitFor(() =>
      expect(browser.ws.send).toHaveBeenCalledWith(JSON.stringify({ kind: 'upstream', event })),
    )
    await service.prepareBrowserReturn(browser.webSession, browser.mossSessionId)
    expect(state.sockets).toHaveLength(1)
    await service.terminate('principal-a', 'session-a')
  })

  test('replays a pending permission after reconnect and retires its answered request', async () => {
    const service = coordinator(),
      original = connection()
    service.subscribe(original)
    await service.prepareBrowserReturn(original.webSession, original.mossSessionId)
    const upstream = state.sockets[0]!
    const event = {
      type: 'control_request',
      request_id: 'permission-1',
      request: { tool_name: 'ToolSearch' },
    }
    upstream.onEvent(event)
    await service.unsubscribe(original)
    expect(upstream.close).not.toHaveBeenCalled()
    const returning = connection()
    service.subscribe(returning)
    const approval = vi
      .mocked(returning.ws.send)
      .mock.calls.map(([raw]) => JSON.parse(String(raw)))
      .find((frame) => frame.kind === 'upstream')
    expect(approval.event).toMatchObject({ type: 'control_request', request: event.request })
    expect(approval.event.request_id).not.toBe(event.request_id)
    await service.handleClientMessage(returning, {
      kind: 'control_response',
      requestId: approval.event.request_id,
      optionId: 'allow_once',
    })
    const another = connection()
    service.subscribe(another)
    expect(another.ws.send).not.toHaveBeenCalledWith(JSON.stringify(approval))
    expect(upstream.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'control_response',
        response: expect.objectContaining({ request_id: 'permission-1' }),
      }),
    )
    upstream.onEvent({ type: 'result', result: 'finished' })
    await vi.waitFor(() => expect(state.lock?.state).toBe('idle'))
    await service.terminate('principal-a', 'session-a')
  })

  test.each([true, false])(
    'preserves the known or uncertain outcome of a failed browser return (%s)',
    async (isRejected) => {
      const service = coordinator(),
        browser = connection()
      service.subscribe(browser)
      expect(await service.prepareBrowserReturn(browser.webSession, browser.mossSessionId)).toBe(
        true,
      )
      await service.failBrowserReturn(browser.webSession, browser.mossSessionId, isRejected)
      expect(state.lock?.state).toBe(isRejected ? 'idle' : 'uncertain')
      await service.terminate('principal-a', 'session-a')
    },
  )

  test('retains the current writer stream when another viewer returns browser control', async () => {
    const service = coordinator(),
      writer = connection(),
      viewer = connection()
    viewer.webSession = { ...viewer.webSession, id: 'web-b' }
    service.subscribe(writer)
    service.subscribe(viewer)
    await service.handleClientMessage(writer, { kind: 'send', text: 'Original turn' })
    const upstream = state.sockets[0]!
    await service.prepareBrowserReturn(viewer.webSession, viewer.mossSessionId)
    expect(state.sockets).toHaveLength(1)
    expect(upstream.close).not.toHaveBeenCalled()
    expect(state.lock?.writerWebSessionId).toBe('web-a')
    await service.terminate('principal-a', 'session-a')
  })

  test('forwards tool output and artifacts without treating tool completion as turn completion', async () => {
    const service = coordinator(),
      browser = connection()
    service.subscribe(browser)
    await service.handleClientMessage(browser, { kind: 'send', text: 'Read file' })
    const upstream = state.sockets[0]!
    const events = [
      { type: 'tool_result', tool_use_id: 'read-1', content: 'FileNotFound', is_error: true },
      { type: 'artifacts', v: 1, records: [] },
    ]
    for (const event of events) upstream.onEvent(event)
    await vi.waitFor(() => {
      for (const event of events)
        expect(browser.ws.send).toHaveBeenCalledWith(JSON.stringify({ kind: 'upstream', event }))
    })
    expect(state.lock?.state).toBe('running')
    upstream.onEvent({ type: 'private-internal-event', secret: 'must not be forwarded' })
    expect(browser.ws.send).not.toHaveBeenCalledWith(
      expect.stringContaining('must not be forwarded'),
    )
    await service.terminate('principal-a', 'session-a')
  })

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
    await vi.waitFor(() =>
      expect(returning.ws.send).toHaveBeenCalledWith(
        JSON.stringify({ kind: 'upstream', event: { type: 'result', result: 'finished' } }),
      ),
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
