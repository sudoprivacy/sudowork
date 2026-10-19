import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/acceptance',
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: process.env.PARK_ACCEPTANCE_URL ?? 'http://127.0.0.1:4176',
    ...devices['Desktop Chrome'],
  },
})
