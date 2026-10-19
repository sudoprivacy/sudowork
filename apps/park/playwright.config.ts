import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const mossPort = process.env.PARK_E2E_MOSS_PORT ?? '4174'
const parkPort = process.env.PARK_E2E_PORT ?? '4176'
const mossUrl = `http://127.0.0.1:${mossPort}`
const parkUrl = `http://127.0.0.1:${parkPort}`

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  workers: 1,
  use: { baseURL: parkUrl, ...devices['Desktop Chrome'] },
  webServer: [
    {
      command: 'node --import tsx src/server/park/testing/bridgeFixture.ts',
      cwd: fileURLToPath(new URL('../../../moss/', import.meta.url)),
      env: {
        PARK_FIXTURE_PORT: mossPort,
        PARK_PUBLIC_PROXY_HMAC_KEY: 'park-e2e-proxy-key-with-more-than-32-characters',
      },
      url: `${mossUrl}/public/consult/context`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'node server.mjs',
      env: {
        MOSS_BASE_URL: mossUrl,
        PARK_SESSION_DB: ':memory:',
        PARK_SESSION_HMAC_KEY: '1111111111111111111111111111111111111111111111111111111111111111',
        PARK_TOKEN_AES_KEY: '2222222222222222222222222222222222222222222222222222222222222222',
        PARK_PUBLIC_PROXY_HMAC_KEY: 'park-e2e-proxy-key-with-more-than-32-characters',
        PARK_PUBLIC_ORIGIN: parkUrl,
        PORT: parkPort,
      },
      url: `${parkUrl}/consult`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
