import { createHmac, randomBytes } from 'node:crypto'

/**
 * Web Session Cookie token（计划 3.1）：
 * - 浏览器只保存随机 HttpOnly Cookie（32 字节 base64url）
 * - 数据库只保存 HMAC-SHA256 摘要，绝不存原文
 */

/** 生成 256 位随机 token（base64url，43 字符）。 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

/** 计算 token 的 HMAC-SHA256 摘要（存库 bytea，唯一索引查找用）。 */
export function digestToken(token: string, hmacKey: Buffer): Buffer {
  return createHmac('sha256', hmacKey).update(token, 'utf8').digest()
}
