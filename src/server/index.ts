import { createApp } from './app.js'

const port = Number(process.env.PORT ?? 25808)

const app = createApp()
const server = app.listen(port, () => {
  console.log(`[sudowork-webui] server listening on :${port}`)
})

// WebSocket upgrade（/ws）在 Task 5 注册。
export { app, server }
