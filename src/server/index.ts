import { Pool } from 'pg'
import { createApp, registerApiRoutes } from './app.js'
import { loadConfig } from './config.js'
import { createMossAuthPort } from './moss/MossAuthClient.js'
import { mossRequest } from './moss/MossHttpClient.js'
import { closePool, getPool } from './db.js'

const config = loadConfig()

const app = createApp({ publicOrigin: config.publicOrigin })
const pool: Pool = getPool(config.databaseUrl)
const mossAuth = createMossAuthPort(mossRequest, config.moss.baseUrl)

registerApiRoutes(app, { config, pool, mossAuth })

const server = app.listen({ port: config.server.port, host: config.server.host }, () => {
  console.log(
    `[sudowork-webui] server listening on ${config.server.host}:${config.server.port} ` +
      `(publicOrigin=${config.publicOrigin}, moss=${config.moss.baseUrl})`,
  )
})

// WebSocket upgrade（/ws）在 Task 5 注册。

async function shutdown(): Promise<void> {
  server.close()
  await closePool()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
