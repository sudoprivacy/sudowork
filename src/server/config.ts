import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'

/**
 * 配置加载（计划 Task 2）：
 * - 配置文件提供 server/publicOrigin/trustProxy/moss/session/upload
 * - 敏感值（数据库 URL、HMAC key、AES key）只来自环境变量
 * - 开发 localhost 允许非 Secure Cookie；生产非 HTTPS 配置直接拒绝启动
 */

const ConfigFileSchema = z.object({
  server: z.object({
    host: z.string().min(1).default('0.0.0.0'),
    port: z.number().int().min(1).max(65535).default(25809),
  }),
  publicOrigin: z.string().url(),
  trustProxy: z.boolean().default(false),
  moss: z.object({
    baseUrl: z.string().url(),
    wsBaseUrl: z.string().url(),
  }),
  session: z.object({
    ttlSeconds: z.number().int().positive().default(604800),
  }),
  upload: z.object({
    maxFileBytes: z.number().int().positive().default(10 * 1024 * 1024),
    maxFilesPerRequest: z.number().int().positive().default(10),
    maxTotalBytes: z.number().int().positive().default(50 * 1024 * 1024),
  }),
})

export type ConfigFile = z.infer<typeof ConfigFileSchema>

export interface AppConfig extends ConfigFile {
  isProduction: boolean
  databaseUrl: string
  sessionHmacKey: Buffer
  tokenAesKey: Buffer
  /** 生产恒 true；开发仅 localhost http 允许 false（计划 3.6） */
  cookieSecure: boolean
}

export class ConfigError extends Error {}

function readEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new ConfigError(`missing required environment variable: ${name}`)
  }
  return value.trim()
}

function loadKey(envName: string, minBytes: number, purpose: string): Buffer {
  const raw = readEnv(envName)
  // 优先按 base64 解（含 padding 或非 hex 字符时），否则按 hex，最后按 utf8
  let key: Buffer
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0 && raw.length >= minBytes * 2) {
    key = Buffer.from(raw, 'hex')
  } else {
    try {
      key = Buffer.from(raw, 'base64')
    } catch {
      key = Buffer.from(raw, 'utf8')
    }
  }
  if (key.length < minBytes) {
    throw new ConfigError(
      `${envName} for ${purpose} must decode to at least ${minBytes} bytes (got ${key.length})`,
    )
  }
  return key
}

export function loadConfig(configPath?: string): AppConfig {
  const resolvedPath = resolve(configPath ?? process.env.CONFIG_PATH ?? 'config/sudowork-webui.json')

  let file: ConfigFile
  if (existsSync(resolvedPath)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(resolvedPath, 'utf8'))
    } catch (err) {
      throw new ConfigError(`invalid JSON in ${resolvedPath}: ${(err as Error).message}`)
    }
    file = ConfigFileSchema.parse(parsed)
  } else if (configPath || process.env.CONFIG_PATH) {
    throw new ConfigError(`config file not found: ${resolvedPath}`)
  } else {
    // 未提供配置文件时允许全部来自环境变量默认值以外必须项报错
    file = ConfigFileSchema.parse({
      publicOrigin: process.env.PUBLIC_ORIGIN,
      moss: {
        baseUrl: process.env.MOSS_BASE_URL,
        wsBaseUrl: process.env.MOSS_WS_BASE_URL,
      },
    })
  }

  // 环境变量覆盖
  if (process.env.PUBLIC_ORIGIN) {
    file = { ...file, publicOrigin: process.env.PUBLIC_ORIGIN }
  }
  if (process.env.MOSS_BASE_URL) {
    file = { ...file, moss: { ...file.moss, baseUrl: process.env.MOSS_BASE_URL } }
  }
  if (process.env.MOSS_WS_BASE_URL) {
    file = { ...file, moss: { ...file.moss, wsBaseUrl: process.env.MOSS_WS_BASE_URL } }
  }
  if (process.env.PORT && /^\d+$/.test(process.env.PORT)) {
    file = { ...file, server: { ...file.server, port: Number(process.env.PORT) } }
  }

  const isProduction = process.env.NODE_ENV === 'production'
  const publicOriginUrl = new URL(file.publicOrigin)

  let cookieSecure: boolean
  if (isProduction) {
    if (publicOriginUrl.protocol !== 'https:') {
      throw new ConfigError(
        `production requires HTTPS publicOrigin (got ${file.publicOrigin}); ` +
          'terminate TLS at an external reverse proxy (计划 3.6)',
      )
    }
    cookieSecure = true
  } else {
    const isLocalhost =
      publicOriginUrl.protocol === 'http:' &&
      (publicOriginUrl.hostname === 'localhost' || publicOriginUrl.hostname === '127.0.0.1')
    if (!isLocalhost && publicOriginUrl.protocol !== 'https:') {
      throw new ConfigError(
        `non-localhost http publicOrigin not allowed (got ${file.publicOrigin}); ` +
          'use https or http://localhost[:port] in development',
      )
    }
    cookieSecure = publicOriginUrl.protocol === 'https:'
  }

  // wsBaseUrl 必须与 baseUrl 同源（计划 3.5 上游 WS 校验的前提）
  const wsUrl = new URL(file.moss.wsBaseUrl)
  const httpUrl = new URL(file.moss.baseUrl)
  if (wsUrl.host !== httpUrl.host) {
    throw new ConfigError(
      `moss.wsBaseUrl host (${wsUrl.host}) must equal moss.baseUrl host (${httpUrl.host})`,
    )
  }

  return {
    ...file,
    isProduction,
    databaseUrl: readEnv('DATABASE_URL'),
    sessionHmacKey: loadKey('SESSION_HMAC_KEY', 32, 'session token HMAC'),
    tokenAesKey: loadKey('TOKEN_AES_KEY', 32, 'moss token AES-256-GCM').subarray(0, 32),
    cookieSecure,
  }
}
