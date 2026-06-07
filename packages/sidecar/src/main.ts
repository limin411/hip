import { randomUUID } from 'node:crypto'
import { WsServer } from './server/ws-server.js'
import { openDatabase } from './persistence/open.js'
import { SessionStore } from './persistence/store.js'

async function main(): Promise<void> {
  // Persist sessions to the path Tauri injects (app data dir); fall back to an
  // in-memory DB for standalone runs / tests. node:sqlite is loaded indirectly
  // via persistence/sqlite.ts so Vite/vitest never sees the bare specifier.
  const dbPath = process.env.HIP_DB_PATH?.trim() || ':memory:'
  const { db, ftsEnabled } = openDatabase(dbPath)
  const store = new SessionStore(db, ftsEnabled)

  const port = await WsServer.findAvailablePort()
  const token = randomUUID()
  const server = new WsServer(port, token, store)
  await server.start()
  // Tauri reads this line from stdout to discover the WebSocket port + auth token
  process.stdout.write(JSON.stringify({ port, token }) + '\n')
}

main().catch((err) => {
  console.error('[sidecar] fatal', err)
  process.exit(1)
})
