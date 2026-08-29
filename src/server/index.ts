import { Pool } from 'pg'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  createApp,
  attachConversationWebSocket,
  registerApiRoutes,
  registerStaticSpa,
} from './app.js'
import { loadConfig } from './config.js'
import { createMossAuthPort } from './moss/MossAuthClient.js'
import { mossRequest } from './moss/MossHttpClient.js'
import { closePool, getPool } from './db.js'

const config = loadConfig()

const app = createApp({ publicOrigin: config.publicOrigin })
const pool: Pool = getPool(config.databaseUrl)
const mossAuth = createMossAuthPort(mossRequest, config.moss.baseUrl)

const handles = registerApiRoutes(app, { config, pool, mossAuth })

// 生产 SPA 静态服务（dist/client 存在时启用；计划 3.6）
const distClientDir = join(process.cwd(), 'dist', 'client')
if (existsSync(join(distClientDir, 'index.html'))) {
  registerStaticSpa(app, distClientDir)
}

const server = app.listen({ port: config.server.port, host: config.server.host }, () => {
  console.log(
    `[sudowork-webui] server listening on ${config.server.host}:${config.server.port} ` +
      `(publicOrigin=${config.publicOrigin}, moss=${config.moss.baseUrl})`,
  )
})

attachConversationWebSocket(server, { config, pool, coordinator: handles.coordinator })

// 启动恢复：遗留 running 锁 → uncertain（计划 2.1）
void handles.coordinator.startupRecovery(pool).catch((err: unknown) => {
  console.error(`[sudowork-webui] startup recovery failed: ${(err as Error).message}`)
})

async function shutdown(): Promise<void> {
  server.close()
  await closePool()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
