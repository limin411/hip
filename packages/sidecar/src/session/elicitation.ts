// packages/sidecar/src/session/elicitation.ts
// Elicitation coordination (G3): lets the agent pause a turn to ask the user a
// clarifying question instead of guessing for hundreds of steps. Reference:
// codex elicitation.rs (reference-counted paused coordination) — this sidecar
// implementation is simpler: one outstanding question at a time, auto-resolve
// on timeout, resolve-by-id idempotent.

export interface PendingElicitation {
  id: string
  question: string
  /** Optional answer options suggested by the agent (plain text, one per line). */
  options?: string[]
  /** Agent-side context note (why the question matters). */
  context?: string
  createdAt: number
}

export interface ElicitationResolveInput {
  id: string
  answer: string
  /** 'user' | 'timeout' | 'cancel' */
  by: 'user' | 'timeout' | 'cancel'
}

export interface ElicitationCoordinatorOptions {
  /** Auto-resolve after this many ms. 0 disables the timeout. Default 600000 (10 min). */
  timeoutMs?: number
  /** Fired when an elicitation is registered. */
  onStarted?: (e: PendingElicitation) => void
  /** Fired when an elicitation resolves (user answer, timeout, or cancel). */
  onResolved?: (e: PendingElicitation, input: ElicitationResolveInput) => void
}

let idSeq = 0

/**
 * Single-outstanding-question coordinator. `isPaused()` is true while a
 * question is pending; the agent loop checks it after a step and stops the
 * turn (awaiting_user). Resolving clears the pause; the answer is delivered
 * to the session as a deferred ToolMessage so the next turn can continue.
 */
export class ElicitationCoordinator {
  private pending: PendingElicitation | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly timeoutMs: number
  private readonly onStarted?: ElicitationCoordinatorOptions['onStarted']
  private readonly onResolved?: ElicitationCoordinatorOptions['onResolved']

  constructor(opts: ElicitationCoordinatorOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 600000
    this.onStarted = opts.onStarted
    this.onResolved = opts.onResolved
  }

  get paused(): boolean {
    return this.pending !== null
  }

  /** The currently outstanding question, if any. */
  current(): PendingElicitation | null {
    return this.pending
  }

  /** Register a new question. Replaces any previous unanswered question (auto-resolved as 'cancel'). */
  register(question: string, opts: { options?: string[]; context?: string } = {}): PendingElicitation {
    if (this.pending) {
      // A new question supersedes the old one — resolve the old as cancelled.
      this.resolve(this.pending.id, '', 'cancel')
    }
    const e: PendingElicitation = {
      id: `el-${Date.now().toString(36)}-${++idSeq}`,
      question,
      options: opts.options,
      context: opts.context,
      createdAt: Date.now(),
    }
    this.pending = e
    if (this.timeoutMs > 0) {
      this.timer = setTimeout(() => {
        if (this.pending?.id === e.id) {
          this.resolve(e.id, '', 'timeout')
        }
      }, this.timeoutMs)
      this.timer.unref?.()
    }
    this.onStarted?.(e)
    return e
  }

  /** Resolve the outstanding question. Idempotent: unknown ids are a no-op. */
  resolve(id: string, answer: string, by: ElicitationResolveInput['by'] = 'user'): boolean {
    const e = this.pending
    if (!e || e.id !== id) return false
    this.clearTimer()
    this.pending = null
    this.onResolved?.(e, { id, answer, by })
    return true
  }

  /** Cancel without an answer (e.g. session teardown). */
  cancelAll(): void {
    if (this.pending) this.resolve(this.pending.id, '', 'cancel')
    this.clearTimer()
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}

/** Marker prefix on deferred tool messages waiting for an elicitation answer. */
export const ELICITATION_PENDING_PREFIX = '[Deferred: elicitation pending]'
