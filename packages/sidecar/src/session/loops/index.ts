import type { DatabaseSync } from '../../persistence/sqlite.js'
import { HeartbeatLoop, type HeartbeatConfig, type HeartbeatState, type TickHandler } from './heartbeat-loop.js'

// ── DDL ────────────────────────────────────────────────────────────────────

/** DDL for the heartbeat_loops table. The LoopManager creates this table in its
 *  constructor (CREATE TABLE IF NOT EXISTS), following the same pattern as
 *  SqliteWorkflowStore / the cron_tasks table in schema.ts. */
export const HEARTBEAT_LOOPS_DDL = `
CREATE TABLE IF NOT EXISTS heartbeat_loops (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL,
  prompt        TEXT NOT NULL,
  interval_ms   INTEGER NOT NULL,
  max_runs      INTEGER,
  status        TEXT NOT NULL DEFAULT 'idle',
  run_count     INTEGER NOT NULL DEFAULT 0,
  last_run_at   INTEGER,
  last_output   TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
)`

// ── Types ──────────────────────────────────────────────────────────────────

export interface LoopRow {
  id: string
  agent_id: string
  prompt: string
  interval_ms: number
  max_runs: number | null
  status: string
  run_count: number
  last_run_at: number | null
  last_output: string | null
  created_at: number
  updated_at: number
}

// ── LoopManager ────────────────────────────────────────────────────────────

/**
 * Manages multiple HeartbeatLoop instances with optional SQLite persistence.
 *
 * Each loop is identified by its config.id. The manager provides:
 *   - register() / unregister() lifecycle
 *   - startAll() / stopAll() bulk operations
 *   - Auto-persistence of loop state to SQLite after each state change
 *   - Restoration of persisted loops on construction
 */
export class LoopManager {
  private readonly loops = new Map<string, HeartbeatLoop>()
  private readonly db: DatabaseSync | null
  private readonly upsertStmt: ReturnType<DatabaseSync['prepare']> | null
  private readonly deleteStmt: ReturnType<DatabaseSync['prepare']> | null
  private readonly loadStmt: ReturnType<DatabaseSync['prepare']> | null

  /**
   * @param db     Optional SQLite database. When provided, loop state is persisted
   *               on every state change and restored on construction.
   * @param runner A function that runs the agent prompt and returns the output.
   *               Called once per loop tick with the prompt and an AbortSignal.
   */
  constructor(
    db: DatabaseSync | null,
    private readonly runner: TickHandler,
  ) {
    this.db = db

    if (db) {
      db.exec(HEARTBEAT_LOOPS_DDL)
      this.upsertStmt = db.prepare(
        `INSERT OR REPLACE INTO heartbeat_loops
         (id, agent_id, prompt, interval_ms, max_runs, status, run_count, last_run_at, last_output, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      this.deleteStmt = db.prepare(`DELETE FROM heartbeat_loops WHERE id = ?`)
      this.loadStmt = db.prepare(`SELECT * FROM heartbeat_loops`)
    } else {
      this.upsertStmt = null
      this.deleteStmt = null
      this.loadStmt = null
    }

    // Restore any persisted loops
    this.restoreLoops()
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Register and start a new heartbeat loop. Returns the loop ID.
   * If a loop with the same ID already exists, it is stopped and replaced.
   */
  register(config: HeartbeatConfig): string {
    this.unregister(config.id)

    // If we have persistence, load any saved state
    const saved = this.loadState(config.id)

    const loop = new HeartbeatLoop(
      config,
      this.runner,
      (state) => this.persistState(state),
      saved ?? undefined,
    )

    this.loops.set(config.id, loop)

    // Persist the initial state immediately
    this.persistState(loop.status())

    return config.id
  }

  /**
   * Stop and remove a loop. Returns true if the loop existed and was removed.
   */
  unregister(loopId: string): boolean {
    const loop = this.loops.get(loopId)
    if (!loop) return false
    loop.stop()
    this.loops.delete(loopId)
    this.deleteStmt?.run(loopId)
    return true
  }

  /**
   * Get a registered loop by ID. Returns undefined if not found.
   */
  get(loopId: string): HeartbeatLoop | undefined {
    return this.loops.get(loopId)
  }

  /**
   * Start all registered loops that are not already running.
   */
  startAll(): void {
    for (const loop of this.loops.values()) {
      loop.start()
    }
  }

  /**
   * Stop all running loops.
   */
  stopAll(): void {
    for (const loop of this.loops.values()) {
      loop.stop()
    }
  }

  /**
   * Return status snapshots for all registered loops.
   */
  listStatuses(): HeartbeatState[] {
    return [...this.loops.values()].map((l) => l.status())
  }

  /**
   * Return the number of registered loops.
   */
  get size(): number {
    return this.loops.size
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private persistState(state: HeartbeatState): void {
    if (!this.upsertStmt) return
    this.upsertStmt.run(
      state.id,
      state.config.agentId,
      state.config.prompt,
      state.config.intervalMs,
      state.config.maxRuns ?? null,
      state.status,
      state.runCount,
      state.lastRunAt,
      state.lastOutput,
      state.createdAt,
      state.updatedAt,
    )
  }

  private deleteRow(loopId: string): void {
    this.deleteStmt?.run(loopId)
  }

  private loadState(loopId: string): { runCount: number; lastRunAt: number | null; lastOutput: string | null; status: 'idle' | 'running' | 'stopped' } | null {
    if (!this.db) return null

    // Check if there's an existing row for this ID
    const row = this.db.prepare(`SELECT * FROM heartbeat_loops WHERE id = ?`).get(loopId) as LoopRow | undefined
    if (!row) return null

    return {
      runCount: row.run_count,
      lastRunAt: row.last_run_at,
      lastOutput: row.last_output,
      status: row.status as 'idle' | 'running' | 'stopped',
    }
  }

  /** Restore all persisted loops that don't have a corresponding in-memory entry.
   *  This brings loops back to life after a sidecar restart. They are created as
   *  idle so the caller must explicitly call start() or startAll(). */
  private restoreLoops(): void {
    if (!this.loadStmt) return
    const rows = this.loadStmt.all() as LoopRow[]

    for (const row of rows) {
      if (this.loops.has(row.id)) continue

      const config: HeartbeatConfig = {
        id: row.id,
        agentId: row.agent_id,
        prompt: row.prompt,
        intervalMs: row.interval_ms,
        maxRuns: row.max_runs ?? undefined,
      }

      const loop = new HeartbeatLoop(
        config,
        this.runner,
        (state) => this.persistState(state),
        {
          runCount: row.run_count,
          lastRunAt: row.last_run_at,
          lastOutput: row.last_output,
          status: 'idle', // Always restore as idle; caller starts explicitly
        },
      )

      this.loops.set(row.id, loop)
    }
  }
}
