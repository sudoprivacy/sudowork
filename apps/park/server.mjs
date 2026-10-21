import http from 'node:http'
import { createHmac } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { isIP } from 'node:net'
import { extname, resolve, sep } from 'node:path'
import { createParkBackend, parkCookie, clearParkCookie, ParkBackendError, isMossUnavailable } from './park-backend.mjs'

const mossBaseUrl = process.env.MOSS_BASE_URL
if (!mossBaseUrl) throw new Error('MOSS_BASE_URL is required')
const moss = new URL(mossBaseUrl)
if (!['http:', 'https:'].includes(moss.protocol)) throw new Error('MOSS_BASE_URL must use HTTP(S)')

const port = Number(process.env.PORT ?? 4176)
const host = process.env.HOST ?? '127.0.0.1'
const publicOrigin = new URL(process.env.PARK_PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`).origin
const dist = resolve(import.meta.dirname, 'dist')
const backend = createParkBackend(moss.origin)
const proxyKey = process.env.PARK_PUBLIC_PROXY_HMAC_KEY
const trustedFrontProxies = new Set(
  (process.env.PARK_TRUSTED_FRONT_PROXY_IPS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
)
const normalizeIp = (value) => value?.replace(/^::ffff:/, '') ?? ''
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}
const authPaths = new Map([
  ['/api/auth/session', 'GET'],
  ['/api/auth/login/password', 'POST'],
  ['/api/auth/logout', 'POST'],
])

function json(res, status, value, cookie) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(cookie ? { 'set-cookie': cookie } : {}),
  })
  res.end(JSON.stringify(value))
}

async function readJson(req, maxBytes = 1_048_576) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new ParkBackendError(413, 'REQUEST_TOO_LARGE')
    chunks.push(chunk)
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
  } catch {
    throw new ParkBackendError(400, 'INVALID_JSON')
  }
}

function responseHeaders(response) {
  return Object.fromEntries(
    [...response.headers].filter(
      ([name]) =>
        ![
          'connection',
          'content-encoding',
          'content-length',
          'set-cookie',
          'transfer-encoding',
        ].includes(name),
    ),
  )
}

async function relay(response, res, headers) {
  res.writeHead(response.status, headers)
  if (response.body) for await (const chunk of response.body) res.write(chunk)
  res.end()
}

async function proxyPublic(req, res, requestUrl) {
  const peerIp = normalizeIp(req.socket.remoteAddress)
  const realIp = String(req.headers['x-real-ip'] ?? '')
  const clientIp = trustedFrontProxies.has(peerIp) && isIP(realIp) ? realIp : peerIp
  const forwardedProto =
    trustedFrontProxies.has(peerIp) && req.headers['x-forwarded-proto'] === 'https'
      ? 'https'
      : 'http'
  const proxyTime = String(Date.now())
  const proxySignature =
    proxyKey && isIP(clientIp)
      ? createHmac('sha256', proxyKey).update(`${clientIp}|${proxyTime}`).digest('hex')
      : null
  const response = await fetch(new URL(requestUrl.pathname + requestUrl.search, moss), {
    method: req.method,
    headers: {
      'content-type': req.headers['content-type'] ?? 'application/json',
      cookie: req.headers.cookie ?? '',
      'user-agent': req.headers['user-agent'] ?? '',
      'x-forwarded-proto': req.socket.encrypted ? 'https' : forwardedProto,
      ...(proxySignature
        ? {
            'x-park-client-ip': clientIp,
            'x-park-client-time': proxyTime,
            'x-park-client-signature': proxySignature,
          }
        : {}),
    },
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req,
    duplex: 'half',
  })
  const headers = responseHeaders(response)
  const cookies = response.headers.getSetCookie()
  if (cookies.length) headers['set-cookie'] = cookies
  await relay(response, res, headers)
}

async function proxyParkApi(req, res, requestUrl) {
  const apiPath = requestUrl.pathname.slice('/park'.length)
  const method = req.method ?? 'GET'
  if (authPaths.get(apiPath) !== method && !apiPath.startsWith('/api/v1/parks/')) {
    json(res, 404, { error: 'NOT_FOUND' })
    return
  }
  const origin = req.headers.origin
  if (origin && origin !== publicOrigin) {
    json(res, 403, { error: 'INVALID_ORIGIN' })
    return
  }
  const cookie = req.headers.cookie
  if (apiPath === '/api/auth/login/password') {
    const token = await backend.login(await readJson(req))
    json(res, 200, { ok: true }, parkCookie(token, publicOrigin))
    return
  }
  if (apiPath === '/api/auth/session') {
    const session = await backend.currentSession(cookie)
    json(res, session ? 200 : 401, session ?? { error: 'SESSION_REQUIRED' })
    return
  }
  if (apiPath === '/api/auth/logout') {
    backend.logout(cookie)
    json(res, 200, { ok: true }, clearParkCookie(publicOrigin))
    return
  }
  // Policy document uploads carry base64 payloads up to ~70MB (50MB file × 1.33).
  const isPolicyUpload = apiPath.startsWith('/api/v1/parks/') && apiPath.includes('/admin/policy/') && apiPath.endsWith('/documents')
  const body = method === 'GET' || method === 'DELETE' ? undefined : await readJson(req, isPolicyUpload ? 73_400_320 : 1_048_576)
  const upstream = await backend.parkRequest(cookie, `${apiPath}${requestUrl.search}`, method, body)
  res.writeHead(upstream.status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(upstream.body)
}

function serveFile(res, file, isAsset) {
  if (!file.startsWith(`${dist}${sep}`) || !existsSync(file)) {
    res.writeHead(404).end('Not found')
    return
  }
  res.writeHead(200, {
    'content-type': contentTypes[extname(file)] ?? 'application/octet-stream',
    'cache-control': isAsset ? 'public, max-age=31536000, immutable' : 'no-store',
  })
  createReadStream(file).pipe(res)
}

http
  .createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? '/', publicOrigin)
      const path = requestUrl.pathname
      if (path.startsWith('/public/')) {
        await proxyPublic(req, res, requestUrl)
        return
      }
      if (path.startsWith('/park/api/')) {
        await proxyParkApi(req, res, requestUrl)
        return
      }
      if (path === '/' || path === '/consult' || path === '/consult/') {
        serveFile(res, resolve(dist, 'consult/index.html'), false)
        return
      }
      if (path === '/park' || path.startsWith('/park/')) {
        const suffix = path.slice('/park'.length)
        const file =
          suffix && extname(suffix) ? resolve(dist, `.${suffix}`) : resolve(dist, 'index.html')
        serveFile(res, file, suffix.startsWith('/assets/'))
        return
      }
      res.writeHead(404).end('Not found')
    } catch (error) {
      if (res.headersSent) {
        res.end()
      } else if (error instanceof ParkBackendError) {
        json(res, error.status, { error: error.code })
      } else if (isMossUnavailable(error)) {
        json(res, 503, { error: 'MOSS_UNAVAILABLE' })
      } else {
        console.error('Park request failed', error)
        json(res, 500, { error: 'INTERNAL_ERROR' })
      }
    }
  })
  .listen(port, host)

process.on('SIGTERM', () => backend.close())
