import { randomUUID } from 'node:crypto'
import { WsServer } from './server/ws-server.js'
import { openDatabase } from './persistence/open.js'
import { SessionStore } from './persistence/store.js'
import { watchParentViaStdin } from './parent-watch.js'

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

  // When spawned by the Tauri shell (which sets HIP_PARENT_WATCH), tie our
  // lifetime to the app: exit if the parent's stdin pipe closes, i.e. the app
  // quit, crashed, or was SIGKILLed by E2E teardown — none of which run Tauri's
  // own child.kill(). Standalone runs (no flag) keep their dev-friendly behavior.
  if (process.env.HIP_PARENT_WATCH) {
    watchParentViaStdin()
  }
}

main().catch((err) => {
  console.error('[sidecar] fatal', err)
  process.exit(1)
})
