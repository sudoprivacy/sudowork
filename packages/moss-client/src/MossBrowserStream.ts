import WebSocket from 'ws'
import { BrowserSessionActionSchema } from '@sudowork/contracts/browser-session'
import { MossHttpError, MossNetworkError, type MossCallContext } from './MossHttpClient.js'
import { deriveWsBaseUrl } from './MossWebSocket.js'

export interface BrowserStreamOperation {
  viewerId: string
  controlEpoch: number
  targetEpoch: number
}

/** Open a binary browser channel using only this web session's server-held token. */
export function openMossBrowserStream(
  ctx: MossCallContext,
  sessionId: string,
  operation: BrowserStreamOperation,
): Promise<WebSocket> {
  const action = BrowserSessionActionSchema.parse({
    ...operation,
    kind: 'window-stream',
  })
  if (action.kind !== 'window-stream') throw new Error('Invalid browser stream operation')
  const path = `/ws/sessions/${encodeURIComponent(sessionId)}/browser/window`
  const url = new URL(path, deriveWsBaseUrl(ctx.baseUrl))
  url.search = new URLSearchParams({
    viewerId: action.viewerId,
    controlEpoch: String(action.controlEpoch),
    targetEpoch: String(action.targetEpoch),
  }).toString()
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, ['binary'], {
      headers: { authorization: `Bearer ${ctx.accessToken}` },
      handshakeTimeout: 10_000,
      followRedirects: false,
      perMessageDeflate: false,
      maxPayload: 16 * 1024 * 1024,
    })
    socket.once('open', () => {
      // Keep upgrade-head frames until the caller has installed both relay directions.
      socket.pause()
      resolve(socket)
    })
    socket.on('error', () =>
      reject(new MossNetworkError(path, new Error('Browser stream unavailable'))),
    )
    socket.once('unexpected-response', (_request, response) => {
      response.resume()
      reject(new MossHttpError(response.statusCode ?? 502, '', path))
      socket.terminate()
    })
  })
}

/** Binary relay shared by Desktop/server adapters, with no retry or input authority. */
export function relayMossBrowserStream(
  client: WebSocket,
  upstream: WebSocket,
  verify: () => Promise<boolean>,
): void {
  let isClosed = false
  let checking: Promise<boolean> | null = null
  const check = () => {
    checking ??= Promise.resolve()
      .then(verify)
      .catch(() => false)
      .finally(() => {
        checking = null
      })
    return checking
  }
  const close = (code: number, reason: string) => {
    if (isClosed) return
    isClosed = true
    clearInterval(timer)
    clearInterval(heartbeat)
    for (const socket of [client, upstream]) {
      if (socket.readyState === socket.OPEN) socket.close(code, reason)
      else if (socket.readyState === socket.CONNECTING) socket.terminate()
    }
  }
  const timer = setInterval(() => {
    void check().then((isAllowed) => {
      if (!isAllowed) close(1008, 'Browser permission revoked')
    })
  }, 5000)
  timer.unref()
  const heartbeat = setInterval(() => {
    for (const socket of [client, upstream]) if (socket.readyState === socket.OPEN) socket.ping()
  }, 20_000)
  heartbeat.unref()
  for (const [source, destination] of [
    [client, upstream],
    [upstream, client],
  ] as const) {
    let queue = Promise.resolve()
    let pendingFrames = 0
    let pendingBytes = 0
    source.on('message', (value, isBinary) => {
      if (isClosed) return
      if (!isBinary) {
        close(1003, 'Binary browser stream required')
        return
      }
      const data = Array.isArray(value)
        ? Buffer.concat(value)
        : Buffer.isBuffer(value)
          ? value
          : Buffer.from(value)
      pendingBytes += data.length
      if (++pendingFrames > 64 || pendingBytes > 16 * 1024 * 1024) {
        close(1009, 'Browser stream queue exceeded')
        return
      }
      queue = queue
        .then(async () => {
          if (isClosed) return
          if (!(await check())) {
            close(1008, 'Browser permission revoked')
            return
          }
          if (isClosed || destination.readyState !== destination.OPEN) return
          await new Promise<void>((resolve, reject) => {
            destination.send(data, { binary: true }, (error) => (error ? reject(error) : resolve()))
          })
        })
        .catch(() => close(1011, 'Browser stream disconnected'))
        .finally(() => {
          pendingFrames--
          pendingBytes -= data.length
        })
    })
    source.once('close', () => close(1000, 'Browser stream disconnected'))
    source.once('error', () => close(1011, 'Browser stream disconnected'))
  }
  upstream.resume()
}
