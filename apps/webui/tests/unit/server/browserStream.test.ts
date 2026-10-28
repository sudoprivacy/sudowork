// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import type { Duplex } from 'node:stream'
import WebSocket, { WebSocketServer } from 'ws'
import { openMossBrowserStream, relayMossBrowserStream } from '@sudowork/moss-client'
import { attachConversationWebSocket } from '../../../src/server/app'
import { digestToken } from '../../../src/server/security/sessionToken'
import type { Pool } from 'pg'
import type { AppConfig } from '../../../src/server/config'
import type { ConversationCoordinator } from '../../../src/server/features/conversations/ConversationCoordinator'

const servers: Server[] = []
const webSockets: WebSocketServer[] = []
const clients: WebSocket[] = []
const rawSockets: Duplex[] = []

afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate()
  for (const socket of rawSockets.splice(0)) socket.destroy()
  for (const server of webSockets.splice(0)) {
    for (const client of server.clients) client.terminate()
    server.close()
  }
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
})

async function listen(server: Server): Promise<string> {
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}

const operation = {
  viewerId: '00000000-0000-4000-8000-000000000000',
  controlEpoch: 8,
  targetEpoch: 11,
}

describe('real browser binary transport', () => {
  it('preserves the unsolicited first RFB frame coalesced with the upstream upgrade', async () => {
    const banner = Buffer.from('RFB 003.008\n')
    const remote = createServer()
    remote.on('upgrade', (request, socket) => {
      rawSockets.push(socket)
      const accept = createHash('sha1')
        .update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64')
      // A real server can include its first binary frame in the HTTP upgrade head.
      socket.write(
        Buffer.concat([
          Buffer.from(
            'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
              'Sec-WebSocket-Protocol: binary\r\nSec-WebSocket-Accept: ' +
              accept +
              '\r\n\r\n',
          ),
          Buffer.from([0x82, banner.length]),
          banner,
        ]),
      )
    })
    const baseUrl = await listen(remote)
    const gateway = createServer()
    const gatewayWs = new WebSocketServer({ noServer: true })
    webSockets.push(gatewayWs)
    gateway.on('upgrade', (request, socket, head) => {
      void openMossBrowserStream({ baseUrl, accessToken: 'fixture-only' }, 'task-17', operation)
        .then((upstream) => {
          clients.push(upstream)
          gatewayWs.handleUpgrade(request, socket, head, (downstream) => {
            relayMossBrowserStream(downstream, upstream, async () => true)
          })
        })
        .catch(() => socket.destroy())
    })
    const gatewayUrl = await listen(gateway)
    const client = new WebSocket(gatewayUrl.replace('http', 'ws'), ['binary'])
    clients.push(client)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const [message, isBinary] = await Promise.race([
        once(client, 'message'),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('First RFB banner lost')), 2000)
        }),
      ])
      expect(isBinary).toBe(true)
      expect(message).toEqual(banner)
    } finally {
      clearTimeout(timer)
    }
  })

  it('protects the real WebUI upgrade with origin, cookie, exact owner and live logout checks', async () => {
    const hmacKey = Buffer.alloc(32, 7)
    const cookie = 'isolated-stream-cookie'
    let isRevoked = false
    let ownerPrincipalId = 'someone-else'
    const pool = {
      async query(_sql: string, [digest]: [Buffer]) {
        return {
          rows:
            !isRevoked && digest.equals(digestToken(cookie, hmacKey))
              ? [{ id: 'web-session', principalId: 'owner' }]
              : [],
        }
      },
    } as unknown as Pool
    let attempts = 0
    let remoteSocket: WebSocket | undefined
    const remote = createServer()
    const remoteWs = new WebSocketServer({ server: remote })
    webSockets.push(remoteWs)
    remoteWs.on('connection', (socket, request) => {
      attempts++
      remoteSocket = socket
      expect(request.headers.authorization).toBe('Bearer owner-stream-token')
      expect(request.url).toContain('/ws/sessions/task-17/browser/window?')
      socket.on('message', (data) => socket.send(data, { binary: true }))
    })
    const baseUrl = await listen(remote)
    const gateway = createServer()
    const gatewayUrl = await listen(gateway)
    attachConversationWebSocket(gateway, {
      pool,
      config: { publicOrigin: gatewayUrl, sessionHmacKey: hmacKey } as AppConfig,
      coordinator: {
        async authorize(session: { principalId: string }, sessionId: string) {
          expect(session.principalId).toBe('owner')
          expect(sessionId).toBe('task-17')
          return { baseUrl, accessToken: 'owner-stream-token', ownerPrincipalId }
        },
      } as unknown as ConversationCoordinator,
    })
    const path =
      '/ws/browser/task-17?' +
      new URLSearchParams({
        viewerId: operation.viewerId,
        controlEpoch: String(operation.controlEpoch),
        targetEpoch: String(operation.targetEpoch),
      })
    const address = gatewayUrl.replace('http', 'ws')
    const headers = { origin: gatewayUrl, cookie: 'sudowork_session=' + cookie }
    const refused = (suffix: string, requestHeaders: Record<string, string>) =>
      new Promise<number>((resolve, reject) => {
        const socket = new WebSocket(address + suffix, ['binary'], { headers: requestHeaders })
        clients.push(socket)
        socket.on('error', () => {})
        socket.once('open', () => reject(new Error('Unexpected browser permission grant')))
        socket.once('unexpected-response', (_request, response) => {
          response.resume()
          resolve(response.statusCode!)
          socket.terminate()
        })
      })
    expect(await refused(path, { ...headers, origin: 'https://foreign.invalid' })).toBe(403)
    expect(await refused(path, { origin: gatewayUrl })).toBe(401)
    expect(await refused(path, headers)).toBe(403)
    expect(await refused(path.replace('controlEpoch=8', 'controlEpoch=invalid'), headers)).toBe(400)
    expect(attempts).toBe(0)
    ownerPrincipalId = 'owner'
    const client = new WebSocket(address + path, ['binary'], { headers })
    clients.push(client)
    await once(client, 'open')
    const echoed = once(client, 'message')
    client.send(Buffer.from([1, 2, 3]))
    expect((await echoed)[0]).toEqual(Buffer.from([1, 2, 3]))
    expect(attempts).toBe(1)
    const exposed: unknown[] = []
    client.on('message', (data) => exposed.push(data))
    const closed = once(client, 'close')
    const upstreamClosed = once(remoteSocket!, 'close')
    isRevoked = true
    remoteSocket!.send(Buffer.from('private-frame-after-logout'))
    expect((await closed)[0]).toBe(1008)
    await upstreamClosed
    expect(exposed).toEqual([])
    expect(attempts).toBe(1)
  })

  it('uses only the bound session credential, relays bytes, then stops private frames after revocation', async () => {
    const remote = createServer()
    const remoteWs = new WebSocketServer({ server: remote })
    webSockets.push(remoteWs)
    const received: Buffer[] = []
    let remoteSocket: WebSocket | undefined
    remoteWs.on('connection', (socket, request) => {
      remoteSocket = socket
      expect(request.headers.authorization).toBe('Bearer owner-session-credential')
      const url = new URL(request.url!, 'http://fixture.invalid')
      expect(url.pathname).toBe('/ws/sessions/task-17/browser/window')
      expect(Object.fromEntries(url.searchParams)).toEqual({
        viewerId: operation.viewerId,
        controlEpoch: '8',
        targetEpoch: '11',
      })
      socket.on('message', (data, isBinary) => {
        expect(isBinary).toBe(true)
        received.push(Buffer.from(data as Buffer))
        socket.send(data, { binary: true })
      })
    })
    const baseUrl = await listen(remote)
    const gateway = createServer()
    const gatewayWs = new WebSocketServer({ noServer: true })
    webSockets.push(gatewayWs)
    let isAllowed = true
    gateway.on('upgrade', (request, socket, head) => {
      void openMossBrowserStream(
        { baseUrl, accessToken: 'owner-session-credential' },
        'task-17',
        operation,
      )
        .then((upstream) => {
          clients.push(upstream)
          gatewayWs.handleUpgrade(request, socket, head, (client) => {
            relayMossBrowserStream(client, upstream, async () => isAllowed)
          })
        })
        .catch(() => socket.destroy())
    })
    const gatewayUrl = await listen(gateway)
    const client = new WebSocket(gatewayUrl.replace('http', 'ws'), ['binary'])
    clients.push(client)
    await once(client, 'open')
    const echoed = once(client, 'message')
    client.send(Buffer.from([0, 7, 99, 255]))
    const [message, isBinary] = await echoed
    expect(isBinary).toBe(true)
    expect(message).toEqual(Buffer.from([0, 7, 99, 255]))
    expect(received).toEqual([Buffer.from([0, 7, 99, 255])])
    const exposed: unknown[] = []
    client.on('message', (value) => exposed.push(value))
    const closed = once(client, 'close')
    const remoteClosed = once(remoteSocket!, 'close')
    isAllowed = false
    remoteSocket!.send(Buffer.from('private frame'))
    expect((await closed)[0]).toBe(1008)
    await remoteClosed
    expect(exposed).toEqual([])
  })

  it('preserves an upstream refusal without reconnecting or sending credentials in the URL', async () => {
    let attempts = 0
    const remote = createServer()
    remote.on('upgrade', (request, socket) => {
      attempts++
      expect(request.url).not.toContain('credential')
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
    })
    const baseUrl = await listen(remote)
    await expect(
      openMossBrowserStream(
        { baseUrl, accessToken: 'owner-session-credential' },
        'task-17',
        operation,
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect(attempts).toBe(1)
  })
})
