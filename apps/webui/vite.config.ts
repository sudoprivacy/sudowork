import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import UnoCss from 'unocss/vite'

const abs = (p: string): string => fileURLToPath(new URL(p, import.meta.url))

// `@office-ai/platform` is a dep of the shared packages (renderer / host-bridge /
// common) but NOT of apps/webui, so it does not resolve from src/client on its own.
// Resolve it once from host-bridge (which declares it) and alias every import to
// that single file — one bridge singleton shared by the adapter and the renderer.
const requireFromHostBridge = createRequire(abs('../../packages/host-bridge/package.json'))
const officeAiPlatformEntry = requireFromHostBridge.resolve('@office-ai/platform')

export default defineConfig({
  plugins: [UnoCss(), react()],
  resolve: {
    // Array form so regex source-aliases (mirroring apps/desktop/electron.vite)
    // can sit next to the existing exact-string client aliases.
    alias: [
      { find: '@client', replacement: abs('./src/client') },
      { find: '@shared', replacement: abs('./src/shared') },
      // Shared renderer + its workspace deps, bundled from source (same as desktop).
      { find: '@renderer', replacement: abs('../../packages/renderer/src') },
      { find: /^@sudowork\/renderer\/(.*)$/, replacement: abs('../../packages/renderer/src') + '/$1' },
      { find: /^@sudowork\/common\/(.*)$/, replacement: abs('../../packages/common/src') + '/$1' },
      { find: /^@sudowork\/common$/, replacement: abs('../../packages/common/src/index.ts') },
      { find: /^@sudowork\/host-bridge\/(.*)$/, replacement: abs('../../packages/host-bridge/src') + '/$1' },
      { find: /^@sudowork\/host-bridge$/, replacement: abs('../../packages/host-bridge/src/index.ts') },
      { find: /^@office-ai\/platform$/, replacement: officeAiPlatformEntry },
    ],
    // Single React across the client console and the shared-renderer graph.
    dedupe: ['react', 'react-dom', 'react-router-dom'],
  },
  define: {
    // Some transitive deps expect a `global`; the shared renderer's desktop build
    // sets this too. Harmless for the existing client (does not reference it).
    global: 'globalThis',
  },
  server: {
    port: 26808,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:26809',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:26809',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    rollupOptions: {
      // Keep the existing client (index.html) AND emit the additive shared-renderer
      // entry, which bundles the shared renderer from packages/renderer/src.
      input: {
        index: abs('./index.html'),
        'shared-renderer': abs('./shared-renderer.html'),
      },
    },
  },
})
