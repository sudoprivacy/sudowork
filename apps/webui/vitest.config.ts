import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

const alias = {
  '@client': fileURLToPath(new URL('./src/client', import.meta.url)),
  '@server': fileURLToPath(new URL('./src/server', import.meta.url)),
  '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
}

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['tests/unit/**/*.{test,spec}.{ts,tsx}'],
          setupFiles: ['tests/unit/setup.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.{test,spec}.ts'],
          fileParallelism: false,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'contract',
          environment: 'node',
          include: ['tests/contract/**/*.{test,spec}.ts'],
        },
      },
    ],
  },
})
