import { WsServer } from './server/ws-server.js'

async function main(): Promise<void> {
  const port = await WsServer.findAvailablePort()
  const server = new WsServer(port)
  await server.start()
  // Tauri reads this line from stdout to discover the WebSocket port
  process.stdout.write(JSON.stringify({ port }) + '\n')
}

main().catch((err) => {
  console.error('[sidecar] fatal', err)
  process.exit(1)
})
