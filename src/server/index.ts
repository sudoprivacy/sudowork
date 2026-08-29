import { createApp } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()

const app = createApp({ publicOrigin: config.publicOrigin })
const server = app.listen({ port: config.server.port, host: config.server.host }, () => {
  console.log(
    `[sudowork-webui] server listening on ${config.server.host}:${config.server.port} ` +
      `(publicOrigin=${config.publicOrigin}, moss=${config.moss.baseUrl})`,
  )
})

// WebSocket upgrade（/ws）在 Task 5 注册。
export { app, server }
