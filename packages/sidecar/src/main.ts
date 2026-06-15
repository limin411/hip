import { randomUUID } from 'node:crypto'
import { WsServer } from './server/ws-server.js'
import { openDatabase } from './persistence/open.js'
import { SessionStore } from './persistence/store.js'
import { watchParentViaStdin } from './parent-watch.js'
import { loadActiveModelFromEnv } from './config/providers.js'
import { acpConnections } from './session/agents/acp-connection.js'

async function main(): Promise<void> {
  // Persist sessions to the path Tauri injects (app data dir); fall back to an
  // in-memory DB for standalone runs / tests. node:sqlite is loaded indirectly
  // via persistence/sqlite.ts so Vite/vitest never sees the bare specifier.
  const dbPath = process.env.HIP_DB_PATH?.trim() || ':memory:'
  loadActiveModelFromEnv()
  const { db, ftsEnabled } = openDatabase(dbPath)
  const store = new SessionStore(db, ftsEnabled)

  const port = await WsServer.findAvailablePort()
  const token = randomUUID()
  const server = new WsServer(port, token, store)
  await server.start()
  // Tauri reads this line from stdout to discover the WebSocket port + auth token
  process.stdout.write(JSON.stringify({ port, token }) + '\n')

  // Tear down the warm ACP child processes (one per agent-config) when the
  // sidecar goes away, so we don't orphan `<agent> acp` children. 'exit' covers
  // the parent-watch EOF path (which calls process.exit(0)) and the fatal exit;
  // SIGTERM covers a direct signal kill of the sidecar itself.
  process.on('exit', () => acpConnections.disposeAll())
  process.on('SIGTERM', () => { acpConnections.disposeAll(); process.exit(0) })

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
