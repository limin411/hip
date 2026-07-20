/**
 * Coalesce high-frequency stream deltas onto rAF (or setTimeout fallback)
 * so React commits once per frame. Flush immediately on complete/cancel/tools.
 *
 * Bucket key: sessionId\0turnId\0agentId\0kind\0stepSeq
 * PR-3 only pushes token:stream (text / text-legacy / run-output). reasoning is not coalesced.
 */

export type StreamKind = 'text' | 'text-legacy' | 'run-output' | 'reasoning'

export interface CoalesceBucket {
  sessionId: string
  turnId: string
  agentId: string
  kind: StreamKind
  stepSeq: number
  role?: string
  text: string
}

export type StreamCoalescePush = {
  sessionId: string
  turnId: string
  agentId: string
  kind: StreamKind
  stepSeq: number
  role?: string
  delta: string
}

export type StreamCoalesceFlush = (bucket: CoalesceBucket) => void

type BucketKey = string

function keyOf(
  sessionId: string,
  turnId: string,
  agentId: string,
  kind: StreamKind,
  stepSeq: number,
): BucketKey {
  return `${sessionId}\0${turnId}\0${agentId}\0${kind}\0${stepSeq}`
}

export class StreamCoalescer {
  private buckets = new Map<BucketKey, CoalesceBucket>()
  private scheduled = false
  /** Cancel handle returned by `schedule`; must be retained (prior bug discarded it). */
  private cancelScheduled: (() => void) | null = null

  constructor(
    private readonly flush: StreamCoalesceFlush,
    private readonly schedule: (cb: () => void) => () => void = defaultSchedule,
  ) {}

  push(input: StreamCoalescePush): void {
    if (!input.delta) return
    const k = keyOf(input.sessionId, input.turnId, input.agentId, input.kind, input.stepSeq)
    const prev = this.buckets.get(k)
    if (prev) {
      prev.text += input.delta
      if (input.role !== undefined) prev.role = input.role
    } else {
      this.buckets.set(k, {
        sessionId: input.sessionId,
        turnId: input.turnId,
        agentId: input.agentId,
        kind: input.kind,
        stepSeq: input.stepSeq,
        ...(input.role !== undefined ? { role: input.role } : {}),
        text: input.delta,
      })
    }
    this.ensureScheduled()
  }

  /** Immediately flush all pending deltas (message complete / dispose / global error). */
  flushAll(): void {
    this.cancelSchedule()
    const pending = [...this.buckets.values()]
    this.buckets.clear()
    for (const b of pending) {
      if (b.text) this.flush(b)
    }
  }

  /** Flush one turn (e.g. before tool / message:complete / interrupt for that turn). */
  flushTurn(sessionId: string, turnId: string): void {
    for (const [k, b] of [...this.buckets.entries()]) {
      if (b.sessionId === sessionId && b.turnId === turnId) {
        this.buckets.delete(k)
        if (b.text) this.flush(b)
      }
    }
    // If nothing remains, drop the pending frame so we don't fire an empty flush later.
    if (this.buckets.size === 0) this.cancelSchedule()
  }

  /** Flush every pending bucket for a session (e.g. session-scoped error). */
  flushSession(sessionId: string): void {
    for (const [k, b] of [...this.buckets.entries()]) {
      if (b.sessionId === sessionId) {
        this.buckets.delete(k)
        if (b.text) this.flush(b)
      }
    }
    if (this.buckets.size === 0) this.cancelSchedule()
  }

  private ensureScheduled(): void {
    if (this.scheduled) return
    this.scheduled = true
    this.cancelScheduled = this.schedule(() => {
      this.scheduled = false
      this.cancelScheduled = null
      this.flushAll()
    })
  }

  private cancelSchedule(): void {
    this.scheduled = false
    if (this.cancelScheduled) {
      this.cancelScheduled()
      this.cancelScheduled = null
    }
  }
}

function defaultSchedule(cb: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(() => cb())
    return () => cancelAnimationFrame(id)
  }
  const id = setTimeout(cb, 16)
  return () => clearTimeout(id)
}

/** Test helper: manual-clock coalescer. */
export function createManualCoalescer(flush: StreamCoalesceFlush): {
  coalescer: StreamCoalescer
  tick: () => void
} {
  let pending: (() => void) | null = null
  const coalescer = new StreamCoalescer(flush, (cb) => {
    pending = cb
    return () => {
      pending = null
    }
  })
  return {
    coalescer,
    tick: () => {
      const fn = pending
      pending = null
      fn?.()
    },
  }
}
