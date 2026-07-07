import { logInfo, logDebug } from '../../debug-logger.js'

// ── Types ──────────────────────────────────────────────────────────────────

export interface HeartbeatConfig {
  /** Unique identifier for this loop. */
  id: string
  /** Interval between ticks in milliseconds. */
  intervalMs: number
  /** Agent identifier (unused by the loop itself; consumed by the tick handler). */
  agentId: string
  /** Prompt message to send on each tick. */
  prompt: string
  /** Optional maximum number of runs. null or undefined = unlimited. */
  maxRuns?: number
}

export type HeartbeatStatus = 'idle' | 'running' | 'stopped'

export interface HeartbeatState {
  id: string
  config: HeartbeatConfig
  status: HeartbeatStatus
  lastRunAt: number | null
  runCount: number
  lastOutput: string | null
  createdAt: number
  updatedAt: number
}

/** Signature for the tick execution callback. Receives the prompt text and an
 *  AbortSignal so cancellation propagates into the running call. Returns the
 *  output text from the agent. */
export type TickHandler = (prompt: string, signal: AbortSignal) => Promise<string>

/** Callback invoked whenever the loop's state changes (run completed, started,
 *  stopped, etc.). The caller should persist the state or react accordingly. */
export type StateChangeHandler = (state: HeartbeatState) => void

// ── HeartbeatLoop ──────────────────────────────────────────────────────────

/**
 * An autonomous loop that runs an agent prompt on a recurring interval.
 *
 * Lifecycle:
 *   1. Construct with a config, a tick handler, and an optional state-change handler.
 *   2. Call `start()` to begin the recurring tick cycle.
 *   3. Call `stop()` to cancel the current and all future ticks.
 *   4. Call `status()` at any time to inspect the loop state.
 *
 * Each tick:
 *   - Invokes the TickHandler with the configured prompt and an AbortSignal.
 *   - Waits for the handler to resolve (or reject).
 *   - Records runCount++, lastRunAt, and lastOutput in the in-memory state.
 *   - Calls the StateChangeHandler so the caller can persist.
 *   - If maxRuns is reached, auto-stops.
 */
export class HeartbeatLoop {
  private timer: ReturnType<typeof setTimeout> | null = null
  private abortController: AbortController | null = null
  private _status: HeartbeatStatus = 'idle'
  private _runCount = 0
  private _lastRunAt: number | null = null
  private _lastOutput: string | null = null
  private readonly _createdAt: number
  private _updatedAt: number

  constructor(
    readonly config: HeartbeatConfig,
    private readonly onTick: TickHandler,
    private readonly onStateChange?: StateChangeHandler,
    /** Initial state to resume from (e.g. after a sidecar restart). */
    initial?: { runCount?: number; lastRunAt?: number | null; lastOutput?: string | null; status?: HeartbeatStatus },
  ) {
    if (config.intervalMs < 10) {
      throw new Error(`Heartbeat interval must be at least 10ms, got ${config.intervalMs}`)
    }
    this._createdAt = Date.now()
    this._updatedAt = this._createdAt
    this._runCount = initial?.runCount ?? 0
    this._lastRunAt = initial?.lastRunAt ?? null
    this._lastOutput = initial?.lastOutput ?? null
    this._status = initial?.status ?? 'idle'
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /** Start the loop. If the loop is already running, this is a no-op. If it
   *  was stopped, it resets and starts fresh. If it was idle (newly created
   *  or resumed from persistence), it begins ticking. */
  start(): void {
    if (this._status === 'running') return
    logDebug('heartbeat', 'start', { id: this.config.id, intervalMs: this.config.intervalMs })
    this._status = 'running'
    this.abortController = new AbortController()
    this._updatedAt = Date.now()
    this.emitStateChange()
    this.scheduleTick()
  }

  /** Stop the loop immediately. Cancels any in-progress tick and prevents
   *  future ticks from scheduling. */
  stop(): void {
    if (this._status === 'stopped') return
    logInfo('heartbeat', 'stop', { id: this.config.id })
    this._status = 'stopped'
    this.abortController?.abort()
    this.abortController = null
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this._updatedAt = Date.now()
    this.emitStateChange()
  }

  /** Return a snapshot of the current loop state. */
  status(): HeartbeatState {
    return {
      id: this.config.id,
      config: { ...this.config },
      status: this._status,
      lastRunAt: this._lastRunAt,
      runCount: this._runCount,
      lastOutput: this._lastOutput,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
    }
  }

  /** Serialized state for persistence (excludes config, which is stored separately). */
  snapshot(): Pick<HeartbeatState, 'runCount' | 'lastRunAt' | 'lastOutput' | 'status'> {
    return {
      runCount: this._runCount,
      lastRunAt: this._lastRunAt,
      lastOutput: this._lastOutput,
      status: this._status,
    }
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private scheduleTick(): void {
    if (this._status !== 'running') return

    // Stop if maxRuns reached
    if (this.config.maxRuns !== undefined && this._runCount >= this.config.maxRuns) {
      logInfo('heartbeat', 'maxRunsReached', { id: this.config.id, runCount: this._runCount })
      this.stop()
      return
    }

    this.timer = setTimeout(() => {
      this.timer = null
      if (this._status !== 'running') return
      this.executeTick()
    }, this.config.intervalMs)
  }

  private async executeTick(): Promise<void> {
    if (this._status !== 'running') return

    const signal = this.abortController?.signal
    if (!signal || signal.aborted) return

    logDebug('heartbeat', 'tick', { id: this.config.id, runCount: this._runCount + 1 })

    try {
      const output = await this.onTick(this.config.prompt, signal)

      this._runCount++
      this._lastRunAt = Date.now()
      this._lastOutput = output
      this._updatedAt = this._lastRunAt

      logInfo('heartbeat', 'tickComplete', {
        id: this.config.id,
        runCount: this._runCount,
        outputLength: output.length,
      })
    } catch (err) {
      // AbortError = loop was stopped during tick — don't record or reschedule
      if (err instanceof Error && err.name === 'AbortError') {
        logDebug('heartbeat', 'tickAborted', { id: this.config.id })
        return
      }

      // Other errors: record the failure and continue
      const errorMsg = err instanceof Error ? err.message : String(err)
      logInfo('heartbeat', 'tickError', { id: this.config.id, error: errorMsg })
      this._runCount++
      this._lastRunAt = Date.now()
      this._lastOutput = `Error: ${errorMsg}`
      this._updatedAt = this._lastRunAt
    }

    this.emitStateChange()

    // Schedule next tick (unless stopped by the tick handler or maxRuns)
    this.scheduleTick()
  }

  private emitStateChange(): void {
    this.onStateChange?.(this.status())
  }
}
