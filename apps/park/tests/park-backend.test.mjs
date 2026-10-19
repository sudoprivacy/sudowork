import assert from 'node:assert/strict'
import http from 'node:http'
import { after, test } from 'node:test'
import { clearParkCookie, createParkBackend, parkCookie } from '../park-backend.mjs'
import { MossParkClient } from '@sudowork/moss-client'

const previous = {
  hmac: process.env.PARK_SESSION_HMAC_KEY,
  aes: process.env.PARK_TOKEN_AES_KEY,
  database: process.env.PARK_SESSION_DB,
}
process.env.PARK_SESSION_HMAC_KEY = '1'.repeat(64)
process.env.PARK_TOKEN_AES_KEY = '2'.repeat(64)
process.env.PARK_SESSION_DB = ':memory:'

after(() => {
  for (const [name, value] of [
    ['PARK_SESSION_HMAC_KEY', previous.hmac],
    ['PARK_TOKEN_AES_KEY', previous.aes],
    ['PARK_SESSION_DB', previous.database],
  ]) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

test('park session cookies stay under /park and use Secure on HTTPS', () => {
  const httpCookie = parkCookie('token', 'http://127.0.0.1:4176')
  assert.match(httpCookie, /^park_session=token; HttpOnly; SameSite=Strict; Path=\/park;/)
  assert.doesNotMatch(httpCookie, /; Secure/)
  assert.match(parkCookie('token', 'https://park.example'), /; Secure$/)
  assert.match(clearParkCookie('https://park.example'), /Max-Age=0; Secure$/)
})

test('park client refuses an absolute URL before sending its bearer token', async () => {
  const client = new MossParkClient()
  await assert.rejects(
    client.request(
      { accessToken: 'secret-token', baseUrl: 'https://moss.example' },
      'https://attacker.example/api/v1/parks/park-1/metrics',
      'GET',
    ),
    /Invalid park API path/,
  )
})

test('park backend gates roles and paths, refreshes Moss tokens, and revokes logout', async () => {
  const calls = []
  let refreshes = 0
  const server = http.createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    calls.push(`${request.method} ${path}`)
    let body = ''
    for await (const chunk of request) body += chunk
    const input = body ? JSON.parse(body) : {}
    const reply = (status, value) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(value))
    }
    if (path === '/api/v1/auth/login') {
      const actor = input.username
      return reply(200, {
        access_token: `${actor}-token`,
        refresh_token: `${actor}-refresh`,
        token_type: 'Bearer',
        expires_in: 3600,
      })
    }
    if (path === '/api/v1/auth/token') {
      refreshes++
      return reply(200, {
        access_token: 'leader-refreshed-token',
        refresh_token: 'leader-refresh-next',
        token_type: 'Bearer',
        expires_in: 3600,
      })
    }
    if (path === '/api/v1/auth/me') {
      const actor = String(request.headers.authorization).includes('visitor') ? 'visitor' : 'leader'
      return reply(200, {
        user: { id: `${actor}-1`, name: actor },
        organization: { id: 'park-1', name: '测试园区' },
        role: 'USER',
        scopes: [],
      })
    }
    if (path === '/api/v1/parks/park-1/me') {
      const isVisitor = String(request.headers.authorization).includes('visitor')
      return reply(
        isVisitor ? 403 : 200,
        isVisitor
          ? { error: 'FORBIDDEN' }
          : {
              park_role: 'park_leader',
            },
      )
    }
    if (path === '/api/v1/parks/park-1/metrics') {
      const isRefreshed = request.headers.authorization === 'Bearer leader-refreshed-token'
      return reply(
        isRefreshed ? 200 : 401,
        isRefreshed
          ? { cards: {} }
          : {
              error: 'EXPIRED',
            },
      )
    }
    reply(404, { error: 'NOT_FOUND' })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const backend = createParkBackend(`http://127.0.0.1:${address.port}`)
  try {
    await assert.rejects(backend.login({ username: '', password: 'secret' }), {
      status: 400,
    })
    await assert.rejects(backend.login({ username: 'visitor', password: 'secret' }), {
      status: 403,
    })
    const token = await backend.login({ username: 'leader', password: 'secret' })
    const cookie = `park_session=${token}`
    assert.equal((await backend.currentSession(cookie))?.user.id, 'leader-1')
    assert.equal(await backend.currentSession('park_session=invalid'), null)
    const callCount = calls.length
    await assert.rejects(backend.parkRequest(cookie, '/api/v1/parks/park-1/roles/target', 'GET'), {
      status: 404,
    })
    await assert.rejects(backend.parkRequest(cookie, '/api/v1/parks/other-park/metrics', 'GET'), {
      status: 403,
    })
    await assert.rejects(backend.parkRequest(cookie, '/api/v1/parks/%ZZ/metrics', 'GET'), {
      status: 400,
    })
    assert.equal(calls.length, callCount)
    const metrics = await backend.parkRequest(cookie, '/api/v1/parks/park-1/metrics', 'GET')
    assert.equal(metrics.status, 200)
    assert.equal(refreshes, 1)
    backend.logout(cookie)
    assert.equal(await backend.currentSession(cookie), null)
    await assert.rejects(backend.parkRequest(cookie, '/api/v1/parks/park-1/metrics', 'GET'), {
      status: 401,
    })
  } finally {
    backend.close()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
