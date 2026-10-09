import { randomBytes } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { decryptToken, encryptToken } from '@server/security/tokenCipher'

describe('tokenCipher (AES-256-GCM)', () => {
  test('roundtrips plaintext', () => {
    const key = randomBytes(32)
    const enc = encryptToken('moss-access-token-plaintext', key)
    expect(decryptToken(enc, key)).toBe('moss-access-token-plaintext')
  })

  test('tampered ciphertext fails authentication', () => {
    const key = randomBytes(32)
    const enc = encryptToken('secret', key)
    const tampered = {
      ...enc,
      ciphertext: Buffer.from([enc.ciphertext[0]! ^ 0xff, ...enc.ciphertext.subarray(1)]),
    }
    expect(() => decryptToken(tampered, key)).toThrow()
  })

  test('wrong key fails authentication', () => {
    const enc = encryptToken('secret', randomBytes(32))
    expect(() => decryptToken(enc, randomBytes(32))).toThrow()
  })

  test('each encryption uses a fresh iv', () => {
    const key = randomBytes(32)
    const a = encryptToken('same-plaintext', key)
    const b = encryptToken('same-plaintext', key)
    expect(a.iv.equals(b.iv)).toBe(false)
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false)
  })

  test('iv is 12 bytes and auth tag is 16 bytes', () => {
    const enc = encryptToken('x', randomBytes(32))
    expect(enc.iv.length).toBe(12)
    expect(enc.authTag.length).toBe(16)
  })
})
