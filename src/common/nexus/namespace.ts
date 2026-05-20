/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Build a secret namespace from pinyin and optional userId.
 * C端: buildNamespace('openai') → "service:openai"
 * B端: buildNamespace('openai', 'u_123') → "user:u_123:openai"
 */
export function buildNamespace(pinyin: string, userId?: string): string {
  if (userId) {
    return `user:${userId}:${pinyin}`
  }
  return `service:${pinyin}`
}
