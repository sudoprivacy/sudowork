import { afterEach, describe, expect, test } from 'vitest'
import { createApp } from '@server/app'
import { loadConfig } from '@server/config'

/**
 * Proxy trust fails silently when it is wrong: it only pins req.ip to the
 * gateway's address.
 *
 * The cost lands on login rate limiting. /send-code, /login/phone,
 * /login/password, /login/api-key and /register/phone share a single counter of
 * 10 per 15 minutes, bucketed by req.ip. A req.ip that never varies means every
 * user of the deployment shares those 10.
 *
 * These assert the wiring rather than the behaviour, because the wiring is what
 * broke: the setting was in the schema all along, but container deployments had
 * no way to turn it on, and nothing called app.set() even when they did.
 */

const ENV_KEYS = [
  'TRUST_PROXY',
  'PUBLIC_ORIGIN',
  'MOSS_BASE_URL',
  'MOSS_WS_BASE_URL',
  'DATABASE_URL',
  'SESSION_HMAC_KEY',
  'TOKEN_AES_KEY',
] as const

const saved = new Map<string, string | undefined>()

function setEnv(values: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    if (!saved.has(key)) saved.set(key, process.env[key])
  }
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  saved.clear()
})

const BASE_ENV = {
  PUBLIC_ORIGIN: 'https://webui.example.com',
  MOSS_BASE_URL: 'https://moss.example.com',
  MOSS_WS_BASE_URL: 'wss://moss.example.com',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  SESSION_HMAC_KEY: 'a'.repeat(64),
  TOKEN_AES_KEY: 'b'.repeat(64),
}

describe('TRUST_PROXY (the only handle a container deployment has)', () => {
  test('stays off when unset', () => {
    setEnv({ ...BASE_ENV, TRUST_PROXY: undefined })
    expect(loadConfig().trustProxy).toBe(false)
  })

  test('true / 1 turn it on, case-insensitively', () => {
    for (const raw of ['true', 'TRUE', '1', ' true ']) {
      setEnv({ ...BASE_ENV, TRUST_PROXY: raw })
      expect(loadConfig().trustProxy, `TRUST_PROXY=${JSON.stringify(raw)}`).toBe(true)
    }
  })

  test('anything else reads as off, with no generous interpretation', () => {
    for (const raw of ['false', '0', 'yes', 'on']) {
      setEnv({ ...BASE_ENV, TRUST_PROXY: raw })
      expect(loadConfig().trustProxy, `TRUST_PROXY=${JSON.stringify(raw)}`).toBe(false)
    }
  })
})

describe("createApp's 'trust proxy' setting", () => {
  test('trusts exactly one hop when enabled, not `true`', () => {
    const app = createApp({ publicOrigin: 'https://webui.example.com', trustProxy: true })
    // `true` would take the leftmost X-Forwarded-For entry, which the caller
    // chooses — the rate limit would stop meaning anything. `1` trusts only the
    // segment nginx itself appended.
    expect(app.get('trust proxy')).toBe(1)
  })

  test('trusts no forwarding header when disabled', () => {
    const app = createApp({ publicOrigin: 'https://webui.example.com', trustProxy: false })
    expect(app.get('trust proxy')).toBe(false)
  })

  test('defaults to off, so a directly exposed deployment cannot be told a client IP', () => {
    const app = createApp({ publicOrigin: 'https://webui.example.com' })
    expect(app.get('trust proxy')).toBe(false)
  })
})
