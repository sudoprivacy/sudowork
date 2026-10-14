import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EXTERNAL_REQUEST_TIMEOUT_MS } from '@sudowork/moss-client/external-providers'

let adapter: typeof import('@client/bridgeAdapter/mossAdapter')
const identity = JSON.stringify(['http://moss.test', 'user-a'])
beforeEach(async () => {
  vi.resetModules()
  adapter = await import('@client/bridgeAdapter/mossAdapter')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('bounds browser requests, forwards current identity and never replays a timed-out task', async () => {
  vi.useFakeTimers()
  let signal!: AbortSignal
  const fetcher = vi.fn(async (path, init) => {
    if (path.endsWith('/external-context'))
      return Response.json({ success: true, data: { isAvailable: true, identity } })
    signal = init.signal
    expect(init.headers['X-Sudo-External-Identity']).toBe(identity)
    return new Promise<Response>(() => {})
  })
  vi.stubGlobal('fetch', fetcher)
  const rejected = expect(
    adapter.externalBrowserPort.create({
      agent_id: 'a',
      query: 'synthetic',
      idempotency_key: 'key-123456',
    }),
  ).rejects.toThrow('EXTERNAL_TASK_TIMEOUT')
  await vi.advanceTimersByTimeAsync(EXTERNAL_REQUEST_TIMEOUT_MS)
  await rejected
  expect(signal.aborted).toBe(true)
  expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/tasks'))).toHaveLength(1)
})

it('rejects a response when the browser identity changes during the request', async () => {
  let currentIdentity = identity
  let finish!: (response: Response) => void
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path) => {
      if (path.endsWith('/external-context'))
        return Response.json({
          success: true,
          data: { isAvailable: true, identity: currentIdentity },
        })
      entered()
      return new Promise<Response>((resolve) => {
        finish = resolve
      })
    }),
  )
  await adapter.readExternalContext(new AbortController().signal)
  const rejected = expect(adapter.externalBrowserPort.agents()).rejects.toThrow(
    'EXTERNAL_IDENTITY_CHANGED',
  )
  await started
  currentIdentity = JSON.stringify(['http://moss.test', 'user-b'])
  await adapter.readExternalContext(new AbortController().signal)
  finish(Response.json({ success: true, data: [] }))
  await rejected
})

it.each([false, true])(
  'allows concurrent context reads for the same identity, newer first: %s',
  async (isNewerFirst) => {
    const complete: Array<(response: Response) => void> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            complete.push(resolve)
          }),
      ),
    )
    const first = adapter.readExternalContext(new AbortController().signal)
    const second = adapter.readExternalContext(new AbortController().signal)
    const both = Promise.all([first, second])
    await vi.waitFor(() => expect(complete).toHaveLength(2))
    const early = isNewerFirst ? 1 : 0
    complete[early]!(Response.json({ success: true, data: { isAvailable: true, identity } }))
    await (isNewerFirst ? second : first)
    complete[1 - early]!(Response.json({ success: true, data: { isAvailable: true, identity } }))
    expect((await both).map((result) => result.data?.identity)).toEqual([identity, identity])
  },
)

it('does not restore an older identity after a newer context response', async () => {
  const complete: Array<(response: Response) => void> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          complete.push(resolve)
        }),
    ),
  )
  const rejected = expect(
    adapter.readExternalContext(new AbortController().signal),
  ).rejects.toThrow('EXTERNAL_IDENTITY_CHANGED')
  const second = adapter.readExternalContext(new AbortController().signal)
  await vi.waitFor(() => expect(complete).toHaveLength(2))
  complete[1]!(
    Response.json({ success: true, data: { isAvailable: true, identity: 'new-identity' } }),
  )
  await second
  complete[0]!(Response.json({ success: true, data: { isAvailable: true, identity } }))
  await rejected
})
