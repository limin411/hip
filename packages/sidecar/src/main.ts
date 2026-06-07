import { randomUUID } from 'node:crypto'
import { WsServer } from './server/ws-server.js'

async function main(): Promise<void> {
  const port = await WsServer.findAvailablePort()
  const token = randomUUID()
  const server = new WsServer(port, token)
  await server.start()
  // Tauri reads this line from stdout to discover the WebSocket port + auth token
  process.stdout.write(JSON.stringify({ port, token }) + '\n')
}

main().catch((err) => {
  console.error('[sidecar] fatal', err)
  process.exit(1)
})
