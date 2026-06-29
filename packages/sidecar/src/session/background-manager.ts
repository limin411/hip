import { mkdirSync, appendFileSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { safeErrorMessage } from './error.js'

// ── Types ──────────────────────────────────────────────────────────────────

/** Extended metadata for a single background task. */
export interface BackgroundTaskMeta {
  description: string
  status: 'running' | 'completed' | 'failed' | 'killed'
  result?: string
  error?: string
  abortController: AbortController
  outputChunks?: string[]
  outputSizeBytes?: number
}

/** Durable location for background task output logs. */
const DEFAULT_TASK_OUTPUT_DIR = join(homedir(), '.hip', 'task-output')

// ── Persistence ────────────────────────────────────────────────────────────

/**
 * Filesystem persistence for background task output.
 * Each task's output is appended to `<baseDir>/<sessionId>/<taskId>/output.log`.
 * On task completion, the output is flushed and a marker file signals finality.
 */
export class BackgroundTaskPersistence {
  constructor(private readonly baseDir: string = DEFAULT_TASK_OUTPUT_DIR) {}

  private taskDir(sessionId: string, taskId: string): string {
    return join(this.baseDir, sessionId, taskId)
  }

  private outputPath(sessionId: string, taskId: string): string {
    return join(this.taskDir(sessionId, taskId), 'output.log')
  }

  private metaPath(sessionId: string, taskId: string): string {
    return join(this.taskDir(sessionId, taskId), 'meta.json')
  }

  /** Append a chunk to the task's output log. Creates the directory on first write. */
  saveOutput(sessionId: string, taskId: string, chunk: string): void {
    const dir = this.taskDir(sessionId, taskId)
    mkdirSync(dir, { recursive: true })
    appendFileSync(this.outputPath(sessionId, taskId), chunk, 'utf8')
  }

  /** Write the final meta marker (status, result, error) so a reconciled session can see the outcome. */
  flushMeta(sessionId: string, taskId: string, meta: { status: string; result?: string; error?: string }): void {
    const dir = this.taskDir(sessionId, taskId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(this.metaPath(sessionId, taskId), JSON.stringify(meta), 'utf8')
  }

  /** Read the persisted output log. Returns null if no output has been written. */
  readOutput(sessionId: string, taskId: string): string | null {
    const path = this.outputPath(sessionId, taskId)
    if (!existsSync(path)) return null
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null
    }
  }

  /** Read the persisted meta (status, result, error). Returns null if no meta exists. */
  readMeta(sessionId: string, taskId: string): { status: string; result?: string; error?: string } | null {
    const path = this.metaPath(sessionId, taskId)
    if (!existsSync(path)) return null
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as { status: string; result?: string; error?: string }
    } catch {
      return null
    }
  }

  /** List all known task IDs for a session by scanning the task directory. */
  listTaskIds(sessionId: string): string[] {
    const dir = join(this.baseDir, sessionId)
    if (!existsSync(dir)) return []
    try {
      const { readdirSync } = require('node:fs') as typeof import('node:fs')
      return readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch {
      return []
    }
  }
}

// ── Manager ────────────────────────────────────────────────────────────────

/**
 * Full lifecycle manager for background sub-agent tasks.
 *
 * Wraps the two per-session Maps (`tasks` / `meta`) that were previously
 * managed directly on {@link Session} and adds:
 * - `stop()` — abort a running task via AbortController
 * - `wait()` — await a single task with an optional timeout
 * - `getOutput()` — in-memory output collection
 * - optional `BackgroundTaskPersistence` for durable output across restarts
 */
export class BackgroundManager {
  /** Publicly readable for test access and backward-compat with existing tests. */
  readonly tasks = new Map<string, Promise<void>>()
  /** Publicly readable for test access and backward-compat with existing tests. */
  readonly meta = new Map<string, BackgroundTaskMeta>()

  readonly maxTasks: number
  private readonly maxRetainedMeta: number
  private readonly persistence?: BackgroundTaskPersistence

  constructor(
    private readonly sessionId: string,
    opts?: {
      maxTasks?: number
      maxRetainedMeta?: number
      persistence?: BackgroundTaskPersistence
    },
  ) {
    this.maxTasks = opts?.maxTasks ?? 100
    this.maxRetainedMeta = opts?.maxRetainedMeta ?? 50
    this.persistence = opts?.persistence
  }

  // ── Read helpers ─────────────────────────────────────────────────────────

  listIds(): string[] {
    return [...this.tasks.keys()]
  }

  get runningCount(): number {
    let count = 0
    for (const m of this.meta.values()) {
      if (m.status === 'running') count++
    }
    return count
  }

  get totalCount(): number {
    return this.tasks.size
  }

  /** Snapshot of all completed/failed tasks for context injection (killed tasks excluded). */
  completedEntries(): Array<{ id: string; description: string; status: 'completed' | 'failed' }> {
    const entries: Array<{ id: string; description: string; status: 'completed' | 'failed' }> = []
    for (const [id, m] of this.meta) {
      if (m.status === 'completed' || m.status === 'failed') {
        entries.push({ id, description: m.description, status: m.status })
      }
    }
    return entries
  }

  /** Snapshot of running tasks for context injection. */
  runningEntries(): Array<{ id: string; description: string; status: 'running' }> {
    const entries: Array<{ id: string; description: string; status: 'running' }> = []
    for (const [id, m] of this.meta) {
      if (m.status === 'running') {
        entries.push({ id, description: m.description, status: 'running' })
      }
    }
    return entries
  }

  // ── Trim ─────────────────────────────────────────────────────────────────

  private trimMeta(): void {
    if (this.meta.size <= this.maxRetainedMeta) return
    for (const [id, m] of this.meta) {
      if (m.status !== 'running') {
        this.meta.delete(id)
        break
      }
    }
  }

  // ── Spawn ────────────────────────────────────────────────────────────────

  /**
   * Register a new background task.
   *
   * Returns the `taskId` on success, or an error string when:
   * - the task is a duplicate (already running)
   * - the concurrency cap is exceeded
   */
  spawn(taskId: string, description: string, runner: (signal: AbortSignal) => Promise<void>): string {
    if (this.tasks.has(taskId)) {
      return `Error: background task ${taskId} is already running`
    }
    if (this.tasks.size >= this.maxTasks) {
      return `Error: maximum ${this.maxTasks} concurrent background tasks reached`
    }

    const ac = new AbortController()
    const meta: BackgroundTaskMeta = {
      description,
      status: 'running',
      abortController: ac,
      outputChunks: [],
      outputSizeBytes: 0,
    }
    this.meta.set(taskId, meta)

    const promise = runner(ac.signal)
      .catch((_err) => {
        // Errors are handled by the specific runner implementation;
        // suppress unhandled rejection here. Completion is signalled via completeTask().
      })
      .finally(() => {
        this.tasks.delete(taskId)
        this.trimMeta()
      })
    this.tasks.set(taskId, promise)

    return taskId
  }

  // ── Stop ─────────────────────────────────────────────────────────────────

  /**
   * Abort a running background task.
   *
   * Returns:
   * - `"killed"` — task was running and has been aborted
   * - `"already terminal"` — task was already completed/failed/killed
   * - `"not found"` — no task with this ID exists
   */
  stop(taskId: string, reason?: string): string {
    const m = this.meta.get(taskId)
    if (!m) return `Error: background task ${taskId} not found`

    if (m.status !== 'running') {
      return `Error: background task ${taskId} is already ${m.status}`
    }

    const reasonMsg = reason ? `: ${reason}` : ''
    m.status = 'killed'
    m.error = `killed by user${reasonMsg}`
    m.abortController.abort()
    this.tasks.delete(taskId)

    // Persist the killed status
    this.persistence?.flushMeta(this.sessionId, taskId, {
      status: 'killed',
      error: m.error,
    })

    return `killed`
  }

  // ── Wait ─────────────────────────────────────────────────────────────────

  /**
   * Wait for a background task to settle (complete, fail, or be killed).
   *
   * Returns the task's result text or error message. When `timeoutMs` is
   * provided and exceeded, returns a timeout error string instead.
   */
  async wait(taskId: string, timeoutMs?: number): Promise<string> {
    const promise = this.tasks.get(taskId)
    if (!promise) {
      // Task may have already been removed — check meta for terminal status
      const m = this.meta.get(taskId)
      if (!m) return `Error: background task ${taskId} not found`
      if (m.status === 'completed' && m.result !== undefined) return m.result
      if (m.status === 'failed') return `Error: ${m.error ?? 'unknown error'}`
      if (m.status === 'killed') return `Error: ${m.error ?? 'task was killed'}`
      return `Error: background task ${taskId} is ${m.status} with no result`
    }

    if (timeoutMs !== undefined) {
      const timeout = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), timeoutMs),
      )
      const result = await Promise.race([promise.then(() => 'settled' as const), timeout])
      if (result === 'timeout') {
        return `Error: timeout waiting for background task ${taskId}`
      }
    } else {
      await promise
    }

    // After settling, re-read meta
    const m = this.meta.get(taskId)
    if (!m) return `Error: background task ${taskId} completed but meta was cleaned up`
    if (m.status === 'completed' && m.result !== undefined) return m.result
    if (m.status === 'failed') return `Error: ${m.error ?? 'unknown error'}`
    if (m.status === 'killed') return `Error: ${m.error ?? 'task was killed'}`
    return `Error: unknown status ${m.status}`
  }

  // ── Output ───────────────────────────────────────────────────────────────

  /**
   * Collect an output chunk for a running task.
   * Appends to the in-memory buffer and optionally persists to filesystem.
   */
  appendOutput(taskId: string, chunk: string): void {
    const m = this.meta.get(taskId)
    if (!m) return
    if (!m.outputChunks) m.outputChunks = []
    m.outputChunks.push(chunk)
    m.outputSizeBytes = (m.outputSizeBytes ?? 0) + Buffer.byteLength(chunk, 'utf8')
    this.persistence?.saveOutput(this.sessionId, taskId, chunk)
  }

  /** Get the collected output for a task (in-memory). */
  getOutput(taskId: string): string {
    const m = this.meta.get(taskId)
    if (!m) return `Error: background task ${taskId} not found`
    if (!m.outputChunks || m.outputChunks.length === 0) {
      // Try persisted output as fallback
      const persisted = this.persistence?.readOutput(this.sessionId, taskId)
      if (persisted) return persisted
      return `Error: no output for background task ${taskId}`
    }
    return m.outputChunks.join('')
  }

  // ── Completion hook ──────────────────────────────────────────────────────

  /**
   * Called by `runBackgroundSubagent` after a task settles.
   * Updates meta and persists output.
   */
  completeTask(
    taskId: string,
    status: 'completed' | 'failed',
    result?: string,
    error?: string,
  ): void {
    const m = this.meta.get(taskId)
    if (!m) return
    m.status = status
    if (result !== undefined) m.result = result
    if (error !== undefined) m.error = error

    // Persist meta
    this.persistence?.flushMeta(this.sessionId, taskId, {
      status,
      ...(result !== undefined ? { result } : {}),
      ...(error !== undefined ? { error } : {}),
    })
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  /** Clear all tracked tasks (used on session destroy). */
  clear(): void {
    this.tasks.clear()
    this.meta.clear()
  }

  // ── Reconcile (crash recovery) ───────────────────────────────────────────

  /**
   * On session load, scan persisted task outputs for tasks that were marked
   * 'running' but the process is now gone. Mark them as 'lost' so the UI
   * doesn't show them as still running.
   *
   * Returns the list of reconciled task IDs.
   */
  reconcile(): string[] {
    if (!this.persistence) return []
    const ids = this.persistence.listTaskIds(this.sessionId)
    const lost: string[] = []

    for (const taskId of ids) {
      // Skip tasks already tracked in memory
      if (this.meta.has(taskId)) continue

      const persistedMeta = this.persistence.readMeta(this.sessionId, taskId)
      if (persistedMeta && persistedMeta.status === 'running') {
        // Task was running when the process died — mark as lost
        const ac = new AbortController()
        const meta: BackgroundTaskMeta = {
          description: taskId,
          status: 'killed',
          error: 'process terminated while task was running',
          abortController: ac,
        }
        if (persistedMeta.result !== undefined) {
          meta.result = persistedMeta.result
        }
        this.meta.set(taskId, meta)

        this.persistence.flushMeta(this.sessionId, taskId, {
          status: 'killed',
          error: meta.error,
        })

        lost.push(taskId)
      }
    }

    return lost
  }
}
