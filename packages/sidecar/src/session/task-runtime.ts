/**
 * TaskRuntime — unified lifecycle for shell / agent / monitor / schedule tasks.
 * Evolves BackgroundManager API; exported both as TaskRuntime and BackgroundManager.
 * Spec: docs/design/2026-07-22-async-task-runtime-right-panel.md
 */
import { mkdirSync, appendFileSync, readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type {
  ServerMessage,
  TaskKind,
  TaskStatus,
  TaskSnapshot,
  TaskOutputPayload,
  TaskRunningCounts,
  TaskMetrics,
} from '@hip/protocol'
import { emptyTaskRunningCounts } from '@hip/protocol'
import { safeErrorMessage } from './error.js'
import { spawnShell, type SpawnedShell } from './shell-backend.js'

// ── Caps ───────────────────────────────────────────────────────────────────

export interface TaskCaps {
  agent: number
  shell: number
  monitor: number
  schedule: number
  globalRunning: number
}

export const DEFAULT_TASK_CAPS: TaskCaps = {
  agent: 10,
  shell: 20,
  monitor: 10,
  schedule: 50,
  globalRunning: 40,
}

// ── Types ──────────────────────────────────────────────────────────────────

export type BackgroundTaskStatus = TaskStatus

/** Extended metadata for a single runtime task (internal). */
export interface BackgroundTaskMeta {
  description: string
  status: TaskStatus
  kind: TaskKind
  result?: string
  error?: string
  abortController: AbortController
  outputChunks?: string[]
  outputSizeBytes?: number
  originConnectionId?: string | null
  originTurnId?: string | null
  originToolCallId?: string | null
  createdAt: number
  updatedAt: number
  detail?: string
  pid?: number | null
  exitCode?: number | null
  metrics?: TaskMetrics
  scheduleId?: string
  /** Shell/monitor process kill. */
  kill?: () => Promise<void>
  /** Active shell handle (bg). */
  shell?: SpawnedShell
}

export type TaskInternal = BackgroundTaskMeta

const DEFAULT_TASK_OUTPUT_DIR = join(homedir(), '.hip', 'task-output')
const LOG_TAIL_CHARS = 2048

// ── Persistence ────────────────────────────────────────────────────────────

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

  private eventsPath(sessionId: string, taskId: string): string {
    return join(this.taskDir(sessionId, taskId), 'events.jsonl')
  }

  saveOutput(sessionId: string, taskId: string, chunk: string): void {
    const dir = this.taskDir(sessionId, taskId)
    mkdirSync(dir, { recursive: true })
    appendFileSync(this.outputPath(sessionId, taskId), chunk, 'utf8')
  }

  appendEvent(sessionId: string, taskId: string, line: string, seq: number): void {
    const dir = this.taskDir(sessionId, taskId)
    mkdirSync(dir, { recursive: true })
    appendFileSync(this.eventsPath(sessionId, taskId), `${JSON.stringify({ seq, line, t: Date.now() })}\n`, 'utf8')
  }

  flushMeta(
    sessionId: string,
    taskId: string,
    meta: {
      status: string
      description?: string
      result?: string
      error?: string
      kind?: TaskKind
      pid?: number | null
      exitCode?: number | null
      metrics?: TaskMetrics
      originTurnId?: string | null
      scheduleId?: string
    },
  ): void {
    const dir = this.taskDir(sessionId, taskId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(this.metaPath(sessionId, taskId), JSON.stringify(meta), 'utf8')
  }

  readOutput(sessionId: string, taskId: string): string | null {
    const path = this.outputPath(sessionId, taskId)
    if (!existsSync(path)) return null
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null
    }
  }

  readMeta(
    sessionId: string,
    taskId: string,
  ): {
    status: string
    description?: string
    result?: string
    error?: string
    kind?: TaskKind
    pid?: number | null
    exitCode?: number | null
    metrics?: TaskMetrics
  } | null {
    const path = this.metaPath(sessionId, taskId)
    if (!existsSync(path)) return null
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as {
        status: string
        description?: string
        result?: string
        error?: string
        kind?: TaskKind
        pid?: number | null
        exitCode?: number | null
        metrics?: TaskMetrics
      }
    } catch {
      return null
    }
  }

  listTaskIds(sessionId: string): string[] {
    const dir = join(this.baseDir, sessionId)
    if (!existsSync(dir)) return []
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch {
      return []
    }
  }
}

// ── Runtime ────────────────────────────────────────────────────────────────

export interface TaskRuntimeOpts {
  maxTasks?: number
  maxRetainedMeta?: number
  persistence?: BackgroundTaskPersistence
  caps?: Partial<TaskCaps>
  /** Session-level broadcast (no IdleWatchdog). */
  broadcast?: (msg: ServerMessage) => void
  /** G4: per-spawn sandbox decision resolver (shell/monitor). */
  sandbox?: SandboxResolver
}

export interface SpawnShellOpts {
  command: string
  cwd: string
  description?: string
  originConnectionId?: string | null
  originTurnId?: string | null
  originToolCallId?: string | null
}

/**
 * G4: sandbox resolver — returns an active SandboxDecision (with argv) or
 * inactive. Consulted per shell/monitor spawn.
 */
export type SandboxResolver = (kind: 'shell' | 'monitor') => import('./sandbox/index.js').SandboxDecision

export interface SpawnMonitorOpts {
  command: string
  cwd: string
  description: string
  persistent?: boolean
  timeoutMs?: number
  originConnectionId?: string | null
  originTurnId?: string | null
  /** Called for each stdout line (after rate limit accepts). */
  onLine?: (line: string, seq: number) => void
}

export interface UpsertScheduleOpts {
  id: string
  prompt: string
  nextFireAt?: number
  description?: string
}

export interface WaitManyResult {
  mode: 'wait_any' | 'wait_all'
  timed_out: boolean
  tasks: TaskOutputPayload[]
}

/**
 * Full lifecycle manager for background shell / agent / monitor / schedule tasks.
 * Backward-compatible with existing agent BackgroundManager call sites.
 */
export class BackgroundManager {
  readonly tasks = new Map<string, Promise<void>>()
  readonly meta = new Map<string, BackgroundTaskMeta>()

  /** @deprecated Prefer caps.agent — kept for tests that read maxTasks. */
  readonly maxTasks: number
  private readonly maxRetainedMeta: number
  private readonly persistence?: BackgroundTaskPersistence
  readonly caps: TaskCaps
  private broadcast?: (msg: ServerMessage) => void
  private shellSeq = 0
  private monSeq = 0
  /** G4: per-spawn sandbox decision resolver. */
  private readonly sandbox?: SandboxResolver

  constructor(
    private readonly sessionId: string,
    opts?: TaskRuntimeOpts,
  ) {
    this.caps = { ...DEFAULT_TASK_CAPS, ...opts?.caps }
    // Legacy single-cap field = agent cap (historical MAX_BACKGROUND_TASKS)
    this.maxTasks = opts?.maxTasks ?? this.caps.agent
    this.caps.agent = this.maxTasks
    this.maxRetainedMeta = opts?.maxRetainedMeta ?? 50
    this.persistence = opts?.persistence
    this.broadcast = opts?.broadcast
    this.sandbox = opts?.sandbox
  }

  /** G4: resolve wrapper argv for a spawn kind, or undefined when inactive. */
  private sandboxArgv(kind: 'shell' | 'monitor'): string[] | undefined {
    const decision = this.sandbox?.(kind)
    return decision?.active ? decision.argv : undefined
  }

  setBroadcast(fn: (msg: ServerMessage) => void): void {
    this.broadcast = fn
  }

  // ── Read helpers ─────────────────────────────────────────────────────────

  /** Running task promise ids (legacy listBackgroundTasks). */
  listIds(): string[] {
    return [...this.tasks.keys()]
  }

  get runningCount(): number {
    let count = 0
    for (const m of this.meta.values()) {
      if (m.status === 'running' && m.kind !== 'schedule') count++
    }
    return count
  }

  get totalCount(): number {
    return this.tasks.size
  }

  completedEntries(): Array<{ id: string; description: string; status: 'completed' | 'failed' }> {
    const entries: Array<{ id: string; description: string; status: 'completed' | 'failed' }> = []
    for (const [id, m] of this.meta) {
      if (m.status === 'completed' || m.status === 'failed') {
        entries.push({ id, description: m.description, status: m.status })
      }
    }
    return entries
  }

  runningEntries(): Array<{ id: string; description: string; status: 'running' }> {
    const entries: Array<{ id: string; description: string; status: 'running' }> = []
    for (const [id, m] of this.meta) {
      if (m.status === 'running') {
        entries.push({ id, description: m.description, status: 'running' })
      }
    }
    return entries
  }

  runningCounts(): TaskRunningCounts {
    const c = emptyTaskRunningCounts()
    for (const m of this.meta.values()) {
      if (m.kind === 'schedule') {
        if (m.status === 'scheduled' || m.status === 'running') c.schedule++
        continue
      }
      if (m.status === 'running') {
        if (m.kind === 'shell') c.shell++
        else if (m.kind === 'agent') c.agent++
        else if (m.kind === 'monitor') c.monitor++
      }
    }
    return c
  }

  private countRunningKind(kind: TaskKind): number {
    let n = 0
    for (const m of this.meta.values()) {
      if (m.kind === kind && m.status === 'running') n++
    }
    return n
  }

  private countSchedules(): number {
    let n = 0
    for (const m of this.meta.values()) {
      if (m.kind === 'schedule' && (m.status === 'scheduled' || m.status === 'running')) n++
    }
    return n
  }

  private globalRunningProcessCount(): number {
    let n = 0
    for (const m of this.meta.values()) {
      if (m.status === 'running' && (m.kind === 'shell' || m.kind === 'agent' || m.kind === 'monitor')) n++
    }
    return n
  }

  private checkCaps(kind: TaskKind): string | null {
    if (kind === 'schedule') {
      if (this.countSchedules() >= this.caps.schedule) {
        return `Error: maximum ${this.caps.schedule} schedule definitions reached`
      }
      return null
    }
    const kindCap = this.caps[kind]
    if (this.countRunningKind(kind) >= kindCap) {
      return `Error: maximum ${kindCap} concurrent ${kind} tasks reached`
    }
    if (this.globalRunningProcessCount() >= this.caps.globalRunning) {
      return `Error: maximum ${this.caps.globalRunning} concurrent running tasks reached`
    }
    return null
  }

  private trimMeta(): void {
    if (this.meta.size <= this.maxRetainedMeta) return
    for (const [id, m] of this.meta) {
      if (m.status !== 'running' && m.status !== 'scheduled') {
        this.meta.delete(id)
        break
      }
    }
  }

  private toSnapshot(id: string, m: BackgroundTaskMeta): TaskSnapshot {
    const full = m.outputChunks?.join('') ?? ''
    const logTail = full.length > LOG_TAIL_CHARS ? full.slice(-LOG_TAIL_CHARS) : full || undefined
    return {
      id,
      kind: m.kind,
      description: m.description,
      status: m.status,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      detail: m.detail,
      pid: m.pid ?? null,
      exitCode: m.exitCode ?? null,
      metrics: m.metrics,
      originTurnId: m.originTurnId ?? null,
      originToolCallId: m.originToolCallId ?? null,
      logTail,
    }
  }

  listSnapshot(): TaskSnapshot[] {
    return [...this.meta.entries()].map(([id, m]) => this.toSnapshot(id, m))
  }

  private emitDelta(id: string): void {
    const m = this.meta.get(id)
    if (!m || !this.broadcast) return
    this.broadcast({ type: 'task:delta', sessionId: this.sessionId, task: this.toSnapshot(id, m) })
  }

  private emitNotification(
    id: string,
    m: BackgroundTaskMeta,
    status: 'completed' | 'failed' | 'killed' | 'suppressed' | 'lost',
  ): void {
    if (!this.broadcast) return
    this.broadcast({
      type: 'task:notification',
      sessionId: this.sessionId,
      taskId: id,
      kind: m.kind,
      description: m.description,
      status,
      result: m.result,
      error: m.error,
      originTurnId: m.originTurnId ?? null,
      originToolCallId: m.originToolCallId ?? null,
    })
  }

  pushSnapshot(): void {
    if (!this.broadcast) return
    this.broadcast({
      type: 'task:snapshot',
      sessionId: this.sessionId,
      tasks: this.listSnapshot(),
      runningCounts: this.runningCounts(),
    })
  }

  // ── Spawn agent (compat) ─────────────────────────────────────────────────

  spawn(
    taskId: string,
    description: string,
    runner: (signal: AbortSignal) => Promise<void>,
    opts?: {
      originConnectionId?: string | null
      kind?: TaskKind
      originTurnId?: string | null
      originToolCallId?: string | null
    },
  ): string {
    const kind: TaskKind = opts?.kind ?? 'agent'
    if (this.tasks.has(taskId) || (this.meta.get(taskId)?.status === 'running')) {
      return `Error: background task ${taskId} is already running`
    }
    // Legacy agent cap: tasks.size includes pre-seeded test entries without meta.
    if (kind === 'agent' && this.tasks.size >= this.maxTasks) {
      return `Error: maximum ${this.maxTasks} concurrent background tasks reached`
    }
    const capErr = this.checkCaps(kind)
    if (capErr) return capErr

    const now = Date.now()
    const ac = new AbortController()
    const meta: BackgroundTaskMeta = {
      description,
      status: 'running',
      kind,
      abortController: ac,
      outputChunks: [],
      outputSizeBytes: 0,
      originConnectionId: opts?.originConnectionId ?? null,
      originTurnId: opts?.originTurnId ?? null,
      originToolCallId: opts?.originToolCallId ?? null,
      createdAt: now,
      updatedAt: now,
    }
    this.meta.set(taskId, meta)

    this.persistence?.flushMeta(this.sessionId, taskId, {
      status: 'running',
      description,
      kind,
    })
    this.emitDelta(taskId)

    const promise = runner(ac.signal)
      .catch(() => {
        /* completion via completeTask */
      })
      .finally(() => {
        this.tasks.delete(taskId)
        this.trimMeta()
      })
    this.tasks.set(taskId, promise)
    return taskId
  }

  // ── Shell background ─────────────────────────────────────────────────────

  spawnShell(opts: SpawnShellOpts): { taskId: string } | { error: string } {
    const capErr = this.checkCaps('shell')
    if (capErr) return { error: capErr }

    const taskId = `shell-${Date.now().toString(36)}-${(++this.shellSeq).toString(36)}`
    const description = opts.description ?? opts.command.slice(0, 120)
    const now = Date.now()
    const ac = new AbortController()

    const shell = spawnShell({
      command: opts.command,
      cwd: opts.cwd,
      signal: ac.signal,
      onStdout: (c) => this.appendOutput(taskId, c),
      onStderr: (c) => this.appendOutput(taskId, c),
      ...(this.sandboxArgv('shell') ? { wrapperArgv: this.sandboxArgv('shell') } : {}),
    })

    const meta: BackgroundTaskMeta = {
      description,
      status: 'running',
      kind: 'shell',
      abortController: ac,
      outputChunks: [],
      outputSizeBytes: 0,
      originConnectionId: opts.originConnectionId ?? null,
      originTurnId: opts.originTurnId ?? null,
      originToolCallId: opts.originToolCallId ?? null,
      createdAt: now,
      updatedAt: now,
      pid: shell.pid,
      kill: () => shell.kill(),
      shell,
    }
    this.meta.set(taskId, meta)
    this.persistence?.flushMeta(this.sessionId, taskId, {
      status: 'running',
      description,
      kind: 'shell',
      pid: shell.pid,
    })
    this.emitDelta(taskId)

    const promise = shell.done
      .then((r) => {
        const m = this.meta.get(taskId)
        if (!m || m.status !== 'running') return
        m.exitCode = r.exitCode
        m.updatedAt = Date.now()
        const out = m.outputChunks?.join('') ?? ''
        if (r.timedOut) {
          this.completeTask(taskId, 'failed', undefined, 'timed out')
        } else if ((r.exitCode ?? 0) !== 0) {
          this.completeTask(taskId, 'failed', out || undefined, `exitCode: ${r.exitCode}`)
        } else {
          this.completeTask(taskId, 'completed', out || `exitCode: ${r.exitCode ?? 0}`)
        }
      })
      .catch((err) => {
        this.completeTask(taskId, 'failed', undefined, safeErrorMessage(err))
      })
      .finally(() => {
        this.tasks.delete(taskId)
        this.trimMeta()
      })
    this.tasks.set(taskId, promise)
    return { taskId }
  }

  // ── Monitor ──────────────────────────────────────────────────────────────

  spawnMonitor(opts: SpawnMonitorOpts): { taskId: string } | { error: string } {
    const capErr = this.checkCaps('monitor')
    if (capErr) return { error: capErr }

    const taskId = `mon-${Date.now().toString(36)}-${(++this.monSeq).toString(36)}`
    const now = Date.now()
    const ac = new AbortController()
    let seq = 0
    let lineBuf = ''
    let suppressed = 0
    // Token bucket: 10 events / 5s ≈ 2/s, burst 20
    let tokens = 20
    let lastRefill = Date.now()
    const RATE = 10
    const REFILL_MS = 5_000
    const SESSION_BUDGET_PER_MIN = 30
    let sessionEventsWindow: number[] = []

    const refill = () => {
      const t = Date.now()
      const elapsed = t - lastRefill
      if (elapsed >= REFILL_MS) {
        tokens = Math.min(20, tokens + RATE * Math.floor(elapsed / REFILL_MS))
        lastRefill = t
      }
    }

    const allowEvent = (): boolean => {
      refill()
      const nowMs = Date.now()
      sessionEventsWindow = sessionEventsWindow.filter((t) => nowMs - t < 60_000)
      if (sessionEventsWindow.length >= SESSION_BUDGET_PER_MIN) return false
      if (tokens < 1) return false
      tokens -= 1
      sessionEventsWindow.push(nowMs)
      return true
    }

    const onData = (chunk: string) => {
      lineBuf += chunk
      const parts = lineBuf.split(/\r?\n/)
      lineBuf = parts.pop() ?? ''
      for (const line of parts) {
        if (!line.trim()) continue
        this.appendOutput(taskId, `${line}\n`)
        if (!allowEvent()) {
          suppressed++
          const m = this.meta.get(taskId)
          if (m) {
            m.metrics = { ...m.metrics, suppressedLines: suppressed, lines: seq }
            // sustained overload → auto-kill
            if (suppressed > 200) {
              void this.stop(taskId, 'monitor volume limit')
              const mm = this.meta.get(taskId)
              if (mm && mm.status === 'running') {
                // stop already killed; complete as suppressed if still running race
              }
              // mark suppressed after kill
              if (mm) {
                mm.status = 'suppressed'
                mm.error = 'auto-killed: event volume limit'
                mm.updatedAt = Date.now()
                this.emitNotification(taskId, mm, 'suppressed')
                this.emitDelta(taskId)
              }
              return
            }
          }
          continue
        }
        seq++
        const m = this.meta.get(taskId)
        if (m) {
          m.metrics = { ...m.metrics, lines: seq, suppressedLines: suppressed }
        }
        this.persistence?.appendEvent(this.sessionId, taskId, line, seq)
        this.broadcast?.({
          type: 'task:event',
          sessionId: this.sessionId,
          taskId,
          description: opts.description,
          line,
          seq,
        })
        opts.onLine?.(line, seq)
      }
    }

    const shell = spawnShell({
      command: opts.command,
      cwd: opts.cwd,
      signal: ac.signal,
      onStdout: onData,
      onStderr: onData,
      ...(this.sandboxArgv('monitor') ? { wrapperArgv: this.sandboxArgv('monitor') } : {}),
    })

    const meta: BackgroundTaskMeta = {
      description: opts.description,
      status: 'running',
      kind: 'monitor',
      abortController: ac,
      outputChunks: [],
      outputSizeBytes: 0,
      originConnectionId: opts.originConnectionId ?? null,
      originTurnId: opts.originTurnId ?? null,
      createdAt: now,
      updatedAt: now,
      pid: shell.pid,
      kill: () => shell.kill(),
      shell,
      metrics: { lines: 0, suppressedLines: 0 },
    }
    this.meta.set(taskId, meta)
    this.persistence?.flushMeta(this.sessionId, taskId, {
      status: 'running',
      description: opts.description,
      kind: 'monitor',
      pid: shell.pid,
    })
    this.emitDelta(taskId)

    const timeoutMs = opts.persistent ? 0 : (opts.timeoutMs ?? 10 * 60 * 60 * 1000)
    let timer: ReturnType<typeof setTimeout> | undefined
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        void this.stop(taskId, 'monitor timeout')
      }, timeoutMs)
      timer.unref?.()
    }

    const promise = shell.done
      .then((r) => {
        if (timer) clearTimeout(timer)
        const m = this.meta.get(taskId)
        if (!m || m.status !== 'running') return
        m.exitCode = r.exitCode
        this.completeTask(
          taskId,
          (r.exitCode ?? 0) === 0 ? 'completed' : 'failed',
          m.outputChunks?.join('') ?? '',
          (r.exitCode ?? 0) === 0 ? undefined : `exitCode: ${r.exitCode}`,
        )
      })
      .catch((err) => {
        if (timer) clearTimeout(timer)
        this.completeTask(taskId, 'failed', undefined, safeErrorMessage(err))
      })
      .finally(() => {
        this.tasks.delete(taskId)
        this.trimMeta()
      })
    this.tasks.set(taskId, promise)
    return { taskId }
  }

  // ── Schedule mirror ──────────────────────────────────────────────────────

  upsertSchedule(opts: UpsertScheduleOpts): { taskId: string } | { error: string } {
    const existing = this.meta.get(opts.id)
    if (!existing) {
      const capErr = this.checkCaps('schedule')
      if (capErr) return { error: capErr }
    }
    const now = Date.now()
    const meta: BackgroundTaskMeta = existing ?? {
      description: opts.description ?? opts.prompt.slice(0, 120),
      status: 'scheduled',
      kind: 'schedule',
      abortController: new AbortController(),
      createdAt: now,
      updatedAt: now,
      scheduleId: opts.id,
      metrics: {},
    }
    meta.description = opts.description ?? opts.prompt.slice(0, 120)
    meta.status = 'scheduled'
    meta.kind = 'schedule'
    meta.scheduleId = opts.id
    meta.updatedAt = now
    if (opts.nextFireAt != null) {
      meta.metrics = { ...meta.metrics, nextFireAt: opts.nextFireAt }
    }
    this.meta.set(opts.id, meta)
    this.emitDelta(opts.id)
    return { taskId: opts.id }
  }

  deleteSchedule(taskId: string): boolean {
    const m = this.meta.get(taskId)
    if (!m || m.kind !== 'schedule') {
      // still try delete if present
    }
    const existed = this.meta.delete(taskId)
    if (existed) this.pushSnapshot()
    return existed
  }

  // ── Stop ─────────────────────────────────────────────────────────────────

  stop(taskId: string, reason?: string): string {
    const m = this.meta.get(taskId)
    if (!m) return `Error: background task ${taskId} not found`

    if (m.kind === 'schedule') {
      this.meta.delete(taskId)
      this.pushSnapshot()
      return 'killed'
    }

    if (m.status !== 'running') {
      return `Error: background task ${taskId} is already ${m.status}`
    }

    const reasonMsg = reason ? `: ${reason}` : ''
    m.status = 'killed'
    m.error = `killed by user${reasonMsg}`
    m.updatedAt = Date.now()
    m.abortController.abort()
    void m.kill?.()
    this.tasks.delete(taskId)

    this.persistence?.flushMeta(this.sessionId, taskId, {
      status: 'killed',
      description: m.description,
      error: m.error,
      kind: m.kind,
    })
    this.emitNotification(taskId, m, 'killed')
    this.emitDelta(taskId)
    return 'killed'
  }

  stopFromOrigin(connectionId: string, reason = 'owner_disconnect'): string[] {
    const stopped: string[] = []
    for (const [taskId, m] of this.meta) {
      if (m.status === 'running' && m.originConnectionId === connectionId) {
        this.stop(taskId, reason)
        stopped.push(taskId)
      }
    }
    return stopped
  }

  async destroyAll(opts?: { killSchedules?: boolean }): Promise<void> {
    const ids = [...this.meta.keys()]
    for (const id of ids) {
      const m = this.meta.get(id)
      if (!m) continue
      if (m.kind === 'schedule') {
        if (opts?.killSchedules !== false) this.meta.delete(id)
        continue
      }
      if (m.status === 'running') {
        m.abortController.abort()
        try {
          await m.kill?.()
        } catch {
          /* best effort */
        }
        m.status = 'killed'
        m.error = m.error ?? 'session destroyed'
        m.updatedAt = Date.now()
      }
    }
    // Wait briefly for promises
    await Promise.race([
      Promise.allSettled([...this.tasks.values()]),
      new Promise((r) => setTimeout(r, 3_000)),
    ])
    this.tasks.clear()
  }

  // ── Wait / output ────────────────────────────────────────────────────────

  async wait(taskId: string, timeoutMs?: number): Promise<string> {
    const promise = this.tasks.get(taskId)
    if (!promise) {
      const m = this.meta.get(taskId)
      if (!m) return `Error: background task ${taskId} not found`
      if (m.status === 'completed' && m.result !== undefined) return m.result
      if (m.status === 'failed') return `Error: ${m.error ?? 'unknown error'}`
      if (m.status === 'killed') return `Error: ${m.error ?? 'task was killed'}`
      if (m.status === 'lost') return `Error: lost: ${m.error ?? 'task was lost'}`
      if (m.status === 'suppressed') return `Error: ${m.error ?? 'suppressed'}`
      return `Error: background task ${taskId} is ${m.status} with no result`
    }

    if (timeoutMs !== undefined) {
      const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs))
      const result = await Promise.race([promise.then(() => 'settled' as const), timeout])
      if (result === 'timeout') {
        return `Error: timeout waiting for background task ${taskId}`
      }
    } else {
      await promise
    }

    const m = this.meta.get(taskId)
    if (!m) return `Error: background task ${taskId} completed but meta was cleaned up`
    if (m.status === 'completed' && m.result !== undefined) return m.result
    if (m.status === 'failed') return `Error: ${m.error ?? 'unknown error'}`
    if (m.status === 'killed') return `Error: ${m.error ?? 'task was killed'}`
    if (m.status === 'lost') return `Error: lost: ${m.error ?? 'task was lost'}`
    if (m.status === 'suppressed') return `Error: ${m.error ?? 'suppressed'}`
    return `Error: unknown status ${m.status}`
  }

  async waitMany(
    taskIds: string[],
    mode: 'wait_any' | 'wait_all',
    timeoutMs?: number,
  ): Promise<WaitManyResult> {
    const start = Date.now()
    const remaining = () =>
      timeoutMs === undefined ? undefined : Math.max(0, timeoutMs - (Date.now() - start))

    const isTerminal = (id: string) => {
      const m = this.meta.get(id)
      return m != null && m.status !== 'running' && m.status !== 'scheduled'
    }

    if (mode === 'wait_any') {
      const polls: Promise<void>[] = taskIds.map(async (id) => {
        const p = this.tasks.get(id)
        if (p) await p
        else if (!isTerminal(id)) {
          // spin short for schedule-only
          while (!isTerminal(id)) {
            await new Promise((r) => setTimeout(r, 50))
            const rem = remaining()
            if (rem === 0) break
          }
        }
      })
      const timeout =
        timeoutMs !== undefined
          ? new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), timeoutMs))
          : null
      const raced = timeout
        ? await Promise.race([Promise.any(polls).then(() => 'done' as const), timeout])
        : await Promise.any(polls).then(() => 'done' as const)
      return {
        mode,
        timed_out: raced === 'timeout',
        tasks: taskIds.map((id) => this.getOutputStructured(id)),
      }
    }

    // wait_all
    const timeout =
      timeoutMs !== undefined
        ? new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), timeoutMs))
        : null
    const all = Promise.all(taskIds.map((id) => this.wait(id, remaining())))
    if (timeout) {
      const raced = await Promise.race([all.then(() => 'done' as const), timeout])
      return {
        mode,
        timed_out: raced === 'timeout',
        tasks: taskIds.map((id) => this.getOutputStructured(id)),
      }
    }
    await all
    return { mode, timed_out: false, tasks: taskIds.map((id) => this.getOutputStructured(id)) }
  }

  appendOutput(taskId: string, chunk: string): void {
    const m = this.meta.get(taskId)
    if (!m) return
    if (!m.outputChunks) m.outputChunks = []
    m.outputChunks.push(chunk)
    m.outputSizeBytes = (m.outputSizeBytes ?? 0) + Buffer.byteLength(chunk, 'utf8')
    m.updatedAt = Date.now()
    m.metrics = { ...m.metrics, bytes: m.outputSizeBytes }
    this.persistence?.saveOutput(this.sessionId, taskId, chunk)
  }

  getOutput(taskId: string): string {
    const m = this.meta.get(taskId)
    if (!m) {
      if (this.persistence) {
        const persistedLog = this.persistence.readOutput(this.sessionId, taskId)
        if (persistedLog != null) return persistedLog
        const pm = this.persistence.readMeta(this.sessionId, taskId)
        if (pm?.result !== undefined) return pm.result
        if (pm?.error) {
          if (pm.status === 'lost') return `Error: lost: ${pm.error}`
          return `Error: ${pm.error}`
        }
      }
      return `Error: background task ${taskId} not found`
    }

    if (m.status !== 'running' && m.result !== undefined) return m.result
    if (m.outputChunks && m.outputChunks.length > 0) return m.outputChunks.join('')
    const persisted = this.persistence?.readOutput(this.sessionId, taskId)
    if (persisted != null) return persisted
    if (m.error) {
      if (m.status === 'lost') return `Error: lost: ${m.error}`
      return `Error: ${m.error}`
    }
    const persistedMeta = this.persistence?.readMeta(this.sessionId, taskId)
    if (persistedMeta?.result !== undefined) return persistedMeta.result
    if (persistedMeta?.error) {
      if (persistedMeta.status === 'lost') return `Error: lost: ${persistedMeta.error}`
      return `Error: ${persistedMeta.error}`
    }
    return `Error: no output for background task ${taskId}`
  }

  getOutputStructured(taskId: string): TaskOutputPayload {
    const m = this.meta.get(taskId)
    if (!m) {
      return {
        task_id: taskId,
        kind: 'agent',
        status: 'lost',
        error: 'not found',
      }
    }
    const output = this.getOutput(taskId)
    const isErr = output.startsWith('Error:')
    return {
      task_id: taskId,
      kind: m.kind,
      status: m.status,
      exit_code: m.exitCode ?? null,
      output: isErr ? undefined : output,
      bytes: m.outputSizeBytes,
      truncated: false,
      lines: m.metrics?.lines,
      suppressed_lines: m.metrics?.suppressedLines,
      error: isErr ? output.replace(/^Error:\s*/, '') : m.error,
    }
  }

  completeTask(
    taskId: string,
    status: 'completed' | 'failed' | 'suppressed',
    result?: string,
    error?: string,
  ): boolean {
    const m = this.meta.get(taskId)
    if (!m) return false
    if (m.status !== 'running') return false

    m.status = status
    m.updatedAt = Date.now()
    if (result !== undefined) m.result = result
    if (error !== undefined) m.error = error

    this.persistence?.flushMeta(this.sessionId, taskId, {
      status,
      description: m.description,
      kind: m.kind,
      ...(result !== undefined ? { result } : {}),
      ...(error !== undefined ? { error } : {}),
      exitCode: m.exitCode ?? null,
      metrics: m.metrics,
    })
    this.emitNotification(taskId, m, status)
    this.emitDelta(taskId)

    // Agent kind: also keep legacy agent:notification for existing UI
    if (m.kind === 'agent' && this.broadcast && (status === 'completed' || status === 'failed')) {
      this.broadcast({
        type: 'agent:notification',
        sessionId: this.sessionId,
        taskId,
        description: m.description,
        status,
        result: m.result,
        error: m.error,
      })
    }
    return true
  }

  clear(): void {
    this.tasks.clear()
    this.meta.clear()
  }

  reconcile(): string[] {
    if (!this.persistence) return []
    const ids = this.persistence.listTaskIds(this.sessionId)
    const lost: string[] = []

    for (const taskId of ids) {
      if (this.meta.has(taskId)) continue
      const persistedMeta = this.persistence.readMeta(this.sessionId, taskId)
      if (persistedMeta && persistedMeta.status === 'running') {
        const ac = new AbortController()
        const now = Date.now()
        const meta: BackgroundTaskMeta = {
          description: persistedMeta.description ?? taskId,
          status: 'lost',
          kind: persistedMeta.kind ?? 'agent',
          error: 'process terminated while task was running',
          abortController: ac,
          createdAt: now,
          updatedAt: now,
        }
        if (persistedMeta.result !== undefined) meta.result = persistedMeta.result
        this.meta.set(taskId, meta)
        this.persistence.flushMeta(this.sessionId, taskId, {
          status: 'lost',
          description: meta.description,
          error: meta.error,
          kind: meta.kind,
        })
        this.emitNotification(taskId, meta, 'lost')
        lost.push(taskId)
      }
    }
    return lost
  }
}

/** Alias per design. */
export { BackgroundManager as TaskRuntime }
