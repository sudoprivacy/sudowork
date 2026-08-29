import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 25808)
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`

// 使用本地已下载的完整 chromium（headless shell 变体缺失时绕过）
const LOCAL_CHROMIUM = join(
  process.env.LOCALAPPDATA ?? '',
  'ms-playwright',
  'chromium-1234',
  'chrome-win64',
  'chrome.exe',
)
const executablePath = existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    screenshot: 'only-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: 'node dist/server/index.js',
        port: PORT,
        timeout: 30_000,
        reuseExistingServer: true,
        env: {
          PORT: String(PORT),
          // E2E 走本地 http（开发语义）；生产 HTTPS 由 Compose/反向代理负责
          PUBLIC_ORIGIN: BASE_URL,
          DATABASE_URL:
            process.env.DATABASE_URL ??
            'postgresql://postgres:postgres@127.0.0.1:5432/sudowork_webui',
          SESSION_HMAC_KEY: process.env.SESSION_HMAC_KEY ?? '',
          TOKEN_AES_KEY: process.env.TOKEN_AES_KEY ?? '',
          MOSS_BASE_URL: process.env.MOSS_BASE_URL ?? 'http://10.0.1.79:43127',
          MOSS_WS_BASE_URL: process.env.MOSS_WS_BASE_URL ?? 'ws://10.0.1.79:43127',
          LOGIN_RATE_LIMIT: '1000',
        },
      },
})
