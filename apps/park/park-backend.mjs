import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  createMossAuthPort,
  mossRequest,
  MossHttpError,
  MossNetworkError,
  MossParkClient,
} from '@sudowork/moss-client'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const SESSION_COOKIE = 'park_session'
const PARK_ROLES = new Set(['park_leader', 'park_recruiter', 'park_system_operator'])
const ALLOWED = [
  {
    method: 'GET',
    path: /^\/(me|metrics|reports|compliance\/summary|leads\/summary|leads|follow-ups)$/,
  },
  { method: 'GET', path: /^\/leads\/[^/]+$/ },
  { method: 'POST', path: /^\/leads\/[^/]+\/(claim|follow-ups)$/ },
  { method: 'PATCH', path: /^\/leads\/[^/]+$/ },
  {
    method: 'GET',
    path: /^\/admin\/(config|quick-questions|assistant|public-links|rate-limits|redaction|audit-events)$/,
  },
  { method: 'GET', path: /^\/admin\/policy\/(tree|wikis)$/ },
  { method: 'GET', path: /^\/admin\/policy\/nodes\/[^/]+\/documents$/ },
  { method: 'GET', path: /^\/admin\/policy\/documents\/[^/]+$/ },
  { method: 'GET', path: /^\/admin\/policy\/wikis\/[^/]+\/build-status$/ },
  { method: 'GET', path: /^\/admin\/policy\/wikis\/[^/]+\/sources$/ },
  { method: 'PUT', path: /^\/admin\/(config|assistant|rate-limits|redaction)$/ },
  { method: 'POST', path: /^\/admin\/(quick-questions|public-links)$/ },
  { method: 'POST', path: /^\/admin\/policy\/(tree\/nodes|wikis)$/ },
  { method: 'POST', path: /^\/admin\/policy\/nodes\/[^/]+\/documents$/ },
  { method: 'POST', path: /^\/admin\/policy\/wikis\/[^/]+\/build$/ },
  { method: 'PATCH', path: /^\/admin\/policy\/wikis\/[^/]+$/ },
  { method: 'DELETE', path: /^\/admin\/policy\/documents\/[^/]+$/ },
  { method: 'DELETE', path: /^\/admin\/quick-questions\/[^/]+$/ },
  { method: 'DELETE', path: /^\/admin\/public-links\/[^/]+$/ },
  { method: 'PUT', path: /^\/roles\/[^/]+$/ },
  { method: 'GET', path: /^\/admin\/public-links\/[^/]+\/qr$/ },
  { method: 'GET', path: /^\/admin\/operations$/ },
  { method: 'GET', path: /^\/admin\/operations\/tasks\/[a-f0-9-]+$/ },
  {
    method: 'POST',
    path: /^\/admin\/operations\/(backup|restore|verify-upgrade|upgrade|rollback|reindex|model-check)$/,
  },
]

export class ParkBackendError extends Error {
  constructor(status, code) {
    super(code)
    this.status = status
    this.code = code
  }
}

function readKey(name) {
  const value = process.env[name]
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error(name + ' must be a 64-character hexadecimal key')
  }
  return Buffer.from(value, 'hex')
}

function parseCookie(header) {
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index < 0 || part.slice(0, index).trim() !== SESSION_COOKIE) continue
    return part.slice(index + 1).trim()
  }
  return null
}

function digest(token, key) {
  return createHmac('sha256', key).update(token).digest('hex')
}

function encrypt(value, key) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()])
  return JSON.stringify({
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  })
}

function decrypt(value, key) {
  const stored = JSON.parse(value)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(stored.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(stored.tag, 'base64'))
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(stored.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8'),
  )
}

function sessionDatabase() {
  const filename =
    process.env.PARK_SESSION_DB ?? resolve(import.meta.dirname, 'data/sessions.sqlite')
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true })
  const db = new DatabaseSync(filename)
  db.exec(`
    CREATE TABLE IF NOT EXISTS park_sessions (
      token_digest TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      org_id TEXT NOT NULL,
      org_name TEXT NOT NULL,
      encrypted_tokens TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `)
  return db
}

function tokenValues(tokens) {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  }
}

export function parkCookie(token, publicOrigin) {
  const secure = new URL(publicOrigin).protocol === 'https:' ? '; Secure' : ''
  return (
    SESSION_COOKIE +
    '=' +
    token +
    '; HttpOnly; SameSite=Strict; Path=/park; Max-Age=' +
    Math.floor(SESSION_TTL_MS / 1000) +
    secure
  )
}

export function clearParkCookie(publicOrigin) {
  const secure = new URL(publicOrigin).protocol === 'https:' ? '; Secure' : ''
  return SESSION_COOKIE + '=; HttpOnly; SameSite=Strict; Path=/park; Max-Age=0' + secure
}

export function createParkBackend(mossBaseUrl) {
  const sessionKey = readKey('PARK_SESSION_HMAC_KEY')
  const tokenKey = readKey('PARK_TOKEN_AES_KEY')
  const db = sessionDatabase()
  const auth = createMossAuthPort(mossRequest)
  const park = new MossParkClient()
  const find = db.prepare('SELECT * FROM park_sessions WHERE token_digest = ? AND expires_at > ?')
  const insert = db.prepare(
    'INSERT INTO park_sessions (token_digest, user_id, user_name, org_id, org_name, encrypted_tokens, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const update = db.prepare('UPDATE park_sessions SET encrypted_tokens = ? WHERE token_digest = ?')
  const remove = db.prepare('DELETE FROM park_sessions WHERE token_digest = ?')

  async function refresh(session, stored, isForced = false) {
    if (!isForced && stored.expiresAt - Date.now() >= 60_000) return stored
    let tokens
    try {
      tokens = await auth.refresh(stored.refreshToken, mossBaseUrl)
    } catch (error) {
      if (error instanceof MossHttpError && [400, 401, 403].includes(error.status)) {
        remove.run(session.token_digest)
        return null
      }
      throw error
    }
    const next = tokenValues(tokens)
    update.run(encrypt(next, tokenKey), session.token_digest)
    return next
  }

  async function storedSession(cookieHeader) {
    const token = parseCookie(cookieHeader)
    if (!token) return null
    const session = find.get(digest(token, sessionKey), Date.now())
    if (!session) return null
    let stored
    try {
      stored = decrypt(session.encrypted_tokens, tokenKey)
    } catch {
      remove.run(session.token_digest)
      return null
    }
    const tokens = await refresh(session, stored)
    return tokens ? { session, tokens } : null
  }

  async function login(input) {
    if (
      !input ||
      typeof input.username !== 'string' ||
      !input.username.trim() ||
      input.username.length > 255 ||
      typeof input.password !== 'string' ||
      !input.password ||
      input.password.length > 1024
    ) {
      throw new ParkBackendError(400, 'INVALID_REQUEST')
    }
    let tokens
    try {
      tokens = await auth.loginWithPassword(
        { username: input.username.trim(), password: input.password },
        mossBaseUrl,
      )
    } catch (error) {
      if (error instanceof MossHttpError && [400, 401, 403, 404].includes(error.status)) {
        throw new ParkBackendError(401, 'INVALID_CREDENTIALS')
      }
      throw error
    }
    const me = await auth.me(tokens.access_token, mossBaseUrl)
    if (!me.organization) throw new ParkBackendError(403, 'PARK_ROLE_REQUIRED')
    const roleResponse = await park.request(
      { accessToken: tokens.access_token, baseUrl: mossBaseUrl },
      '/api/v1/parks/' + encodeURIComponent(me.organization.id) + '/me',
      'GET',
    )
    if (roleResponse.status !== 200) {
      throw new ParkBackendError(
        roleResponse.status === 401 ? 401 : roleResponse.status >= 500 ? 503 : 403,
        'PARK_ROLE_REQUIRED',
      )
    }
    const role = JSON.parse(roleResponse.body).park_role
    if (!PARK_ROLES.has(role)) throw new ParkBackendError(403, 'PARK_ROLE_REQUIRED')

    const token = randomBytes(32).toString('base64url')
    db.prepare('DELETE FROM park_sessions WHERE expires_at <= ?').run(Date.now())
    insert.run(
      digest(token, sessionKey),
      me.user.id,
      me.user.name,
      me.organization.id,
      me.organization.name,
      encrypt(tokenValues(tokens), tokenKey),
      Date.now() + SESSION_TTL_MS,
    )
    return token
  }

  async function currentSession(cookieHeader) {
    const stored = await storedSession(cookieHeader)
    if (!stored) return null
    const { session, tokens } = stored
    let me
    try {
      me = await auth.me(tokens.accessToken, mossBaseUrl)
    } catch (error) {
      if (error instanceof MossHttpError && [401, 403].includes(error.status)) {
        remove.run(session.token_digest)
        return null
      }
      throw error
    }
    if (me.user.id !== session.user_id || me.organization?.id !== session.org_id) {
      remove.run(session.token_digest)
      return null
    }
    return {
      user: { id: me.user.id, name: me.user.name },
      organization: { id: me.organization.id, name: me.organization.name },
      role: me.role,
      scopes: me.scopes,
    }
  }

  async function parkRequest(cookieHeader, path, method, body) {
    const route = /^\/api\/v1\/parks\/([^/]+)(\/.*)$/.exec(new URL(path, mossBaseUrl).pathname)
    if (!route || !ALLOWED.some((entry) => entry.method === method && entry.path.test(route[2]))) {
      throw new ParkBackendError(404, 'NOT_FOUND')
    }
    let requestedOrgId
    try {
      requestedOrgId = decodeURIComponent(route[1])
    } catch {
      throw new ParkBackendError(400, 'INVALID_PARK_ID')
    }
    const stored = await storedSession(cookieHeader)
    if (!stored) throw new ParkBackendError(401, 'SESSION_REQUIRED')
    const { session } = stored
    if (requestedOrgId !== session.org_id) {
      throw new ParkBackendError(403, 'PARK_ACCESS_DENIED')
    }
    const send = (accessToken) =>
      park.request({ accessToken, baseUrl: mossBaseUrl }, path, method, body)
    let result = await send(stored.tokens.accessToken)
    if (result.status === 401) {
      const next = await refresh(session, stored.tokens, true)
      if (!next) throw new ParkBackendError(401, 'SESSION_REQUIRED')
      result = await send(next.accessToken)
    }
    return result
  }

  function logout(cookieHeader) {
    const token = parseCookie(cookieHeader)
    if (token) remove.run(digest(token, sessionKey))
  }

  return { login, currentSession, parkRequest, logout, close: () => db.close() }
}

export function isParkSessionCookie(name) {
  return name === SESSION_COOKIE
}

export function isMossUnavailable(error) {
  return (
    error instanceof MossNetworkError || (error instanceof MossHttpError && error.status >= 500)
  )
}
