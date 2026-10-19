import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

const parkApiBaseUrl = process.env.PARK_API_BASE_URL ?? 'http://127.0.0.1:4177'
const mossBaseUrl = process.env.MOSS_BASE_URL ?? 'http://127.0.0.1:3000'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/park/' : '/',
  plugins: [
    react(),
    {
      name: 'consult-route',
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          if (request.url?.split('?', 1)[0] === '/consult') {
            request.url = request.url.replace(/^\/consult/, '/consult/index.html')
          }
          next()
        })
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        park: resolve(import.meta.dirname, 'index.html'),
        consult: resolve(import.meta.dirname, 'consult/index.html'),
      },
    },
  },
  server: {
    port: 4176,
    proxy: {
      '/public': {
        target: mossBaseUrl,
        changeOrigin: true,
      },
      '/park/api': {
        target: parkApiBaseUrl,
        changeOrigin: false,
      },
    },
  },
}))
