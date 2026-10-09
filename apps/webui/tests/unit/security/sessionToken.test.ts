import { describe, expect, test } from 'vitest'
import { digestToken, generateSessionToken } from '@server/security/sessionToken'

describe('sessionToken', () => {
  test('generates unique url-safe tokens with 256-bit entropy', () => {
    const t1 = generateSessionToken()
    const t2 = generateSessionToken()
    expect(t1).not.toBe(t2)
    // 32 字节 base64url 恒为 43 字符
    expect(t1).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(t2).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  test('digest is deterministic for same key and token', () => {
    const token = generateSessionToken()
    const key = Buffer.from('unit-test-hmac-key')
    const d1 = digestToken(token, key)
    const d2 = digestToken(token, key)
    expect(d1.equals(d2)).toBe(true)
    expect(d1.length).toBe(32) // sha-256
  })

  test('digest depends on key and token', () => {
    const token = generateSessionToken()
    const other = digestToken(token, Buffer.from('another-key'))
    const d = digestToken(token, Buffer.from('unit-test-hmac-key'))
    expect(d.equals(other)).toBe(false)

    const dOtherToken = digestToken(generateSessionToken(), Buffer.from('unit-test-hmac-key'))
    expect(d.equals(dOtherToken)).toBe(false)
  })

  test('digest does not contain the raw token (one-way)', () => {
    const token = generateSessionToken()
    const d = digestToken(token, Buffer.from('k'))
    expect(d.toString('base64')).not.toContain(token)
  })
})
