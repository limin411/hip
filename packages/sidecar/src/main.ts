import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { WsServer } from './server/ws-server.js'
import { openDatabase } from './persistence/open.js'
import { SessionStore } from './persistence/store.js'
import { WORKFLOW_DDL } from './persistence/schema.js'
import { watchParentViaStdin } from './parent-watch.js'
import { loadActiveModelFromEnv } from './config/providers.js'
import { acpConnections } from './session/agents/acp-connection.js'
import { initLangSmith } from './observability/langsmith.js'

/** Best-effort boot log under ~/.hip/logs (or HIP_DATA_DIR) for Windows install diagnosis. */
function bootLog(msg: string): void {
  try {
    const base =
      process.env.HIP_DATA_DIR?.trim() ||
      join(process.env.USERPROFILE || process.env.HOME || homedir(), '.hip')
    const dir = join(base, 'logs')
    mkdirSync(dir, { recursive: true })
    appendFileSync(
      join(dir, 'sidecar-boot.log'),
      `${new Date().toISOString()} ${msg}\n`,
      'utf8',
    )
  } catch {
    /* ignore */
  }
}

/** node:sqlite needs Node >= 22.5 (experimental builtin). */
function assertNodeSupportsSqlite(): void {
  const parts = process.versions.node.split('.').map((x) => Number(x) || 0)
  const major = parts[0] ?? 0
  const minor = parts[1] ?? 0
  if (major < 22 || (major === 22 && minor < 5)) {
    throw new Error(
      `Node ${process.versions.node} is too old for node:sqlite (need >= 22.5). ` +
        `Rebuild with a newer Node: yarn sidecar:prod-bin`,
    )
  }
}

async function main(): Promise<void> {
  bootLog(`boot node=${process.versions.node} platform=${process.platform} arch=${process.arch}`)
  assertNodeSupportsSqlite()

  // Persist sessions to the path Tauri injects (app data dir); fall back to an
  // in-memory DB for standalone runs / tests. node:sqlite is loaded indirectly
  // via persistence/sqlite.ts so Vite/vitest never sees the bare specifier.
  const dbPath = process.env.HIP_DB_PATH?.trim() || ':memory:'
  bootLog(`HIP_DB_PATH=${dbPath}`)
  // Opt-in LangSmith traces (LANGSMITH_TRACING=true + API key). No-op when unset.
  initLangSmith()
  loadActiveModelFromEnv()
  const { db, ftsEnabled } = openDatabase(dbPath)

  // Ensure workflow store tables exist
  for (const ddl of WORKFLOW_DDL) {
    db.exec(ddl)
  }
  // Migrate existing DBs that predate session-bound workflow runs.
  try { db.exec(`ALTER TABLE workflow_runs ADD COLUMN session_id TEXT`) } catch { /* exists */ }
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_session ON workflow_runs(session_id, updated_at DESC)`) } catch { /* ignore */ }

  const store = new SessionStore(db, ftsEnabled)

  const port = await WsServer.findAvailablePort()
  const token = randomUUID()
  const server = new WsServer(port, token, store)
  await server.start()
  // Tauri reads this line from stdout to discover the WebSocket port + auth token.
  // Await the write callback so Windows pipes flush before parent-watch can exit.
  const readyLine = JSON.stringify({ port, token }) + '\n'
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(readyLine, (err) => (err ? reject(err) : resolve()))
  })
  bootLog(`ready port=${port}`)

  // Tear down the warm ACP child processes (one per agent-config) when the
  // sidecar goes away, so we don't orphan `<agent> acp` children. 'exit' covers
  // the parent-watch EOF path (which calls process.exit(0)) and the fatal exit;
  // SIGTERM covers a direct signal kill of the sidecar itself.
  process.on('exit', () => {
    server.dispose()
    acpConnections.disposeAll()
  })
  process.on('SIGTERM', () => {
    server.dispose()
    acpConnections.disposeAll()
    process.exit(0)
  })

  // When spawned by the Tauri shell (which sets HIP_PARENT_WATCH), tie our
  // lifetime to the app: exit if the parent's stdin pipe closes, i.e. the app
  // quit, crashed, or was SIGKILLed by E2E teardown — none of which run Tauri's
  // own child.kill(). Standalone runs (no flag) keep their dev-friendly behavior.
  if (process.env.HIP_PARENT_WATCH) {
    watchParentViaStdin()
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
  console.error('[sidecar] fatal', err)
  bootLog(`fatal ${msg}`)
  process.exit(1)
})
