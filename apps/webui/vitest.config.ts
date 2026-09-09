import { createRequire } from 'node:module'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

const alias = {
  '@client': fileURLToPath(new URL('./src/client', import.meta.url)),
  '@server': fileURLToPath(new URL('./src/server', import.meta.url)),
  '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
}

const abs = (p: string): string => fileURLToPath(new URL(p, import.meta.url))

// The bridgeAdapter unit tests import the mossAdapter, which pulls the shared
// packages from source (same resolution as vite.config.ts: `@office-ai/platform`
// is a dep of host-bridge, not of apps/webui).
const requireFromHostBridge = createRequire(abs('../../packages/host-bridge/package.json'))
const officeAiPlatformEntry = requireFromHostBridge.resolve('@office-ai/platform')

const bridgeAlias = [
  { find: '@client', replacement: abs('./src/client') },
  { find: '@server', replacement: abs('./src/server') },
  { find: '@shared', replacement: abs('./src/shared') },
  { find: /^@sudowork\/renderer\/(.*)$/, replacement: abs('../../packages/renderer/src') + '/$1' },
  { find: /^@sudowork\/common\/(.*)$/, replacement: abs('../../packages/common/src') + '/$1' },
  { find: /^@sudowork\/common$/, replacement: abs('../../packages/common/src/index.ts') },
  {
    find: /^@sudowork\/host-bridge\/(.*)$/,
    replacement: abs('../../packages/host-bridge/src') + '/$1',
  },
  { find: /^@sudowork\/host-bridge$/, replacement: abs('../../packages/host-bridge/src/index.ts') },
  { find: /^@office-ai\/platform$/, replacement: officeAiPlatformEntry },
]

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: bridgeAlias },
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
