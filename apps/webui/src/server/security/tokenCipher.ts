import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Moss access/refresh token 的静态加密（计划 3.1）：
 * AES-256-GCM，密钥来自环境变量 TOKEN_AES_KEY（32 字节），
 * 每个 Web Session 独立保存 iv/authTag/ciphertext。
 */

export interface EncryptedToken {
  ciphertext: Buffer
  iv: Buffer
  authTag: Buffer
}

export function encryptToken(plaintext: string, key: Buffer): EncryptedToken {
  if (key.length !== 32) {
    throw new Error('TOKEN_AES_KEY must be 32 bytes for AES-256-GCM')
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return { ciphertext, iv, authTag: cipher.getAuthTag() }
}

export function decryptToken(enc: EncryptedToken, key: Buffer): string {
  if (key.length !== 32) {
    throw new Error('TOKEN_AES_KEY must be 32 bytes for AES-256-GCM')
  }
  const decipher = createDecipheriv('aes-256-gcm', key, enc.iv)
  decipher.setAuthTag(enc.authTag)
  return Buffer.concat([decipher.update(enc.ciphertext), decipher.final()]).toString('utf8')
}
