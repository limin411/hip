/**
 * Coalesce high-frequency stream deltas onto rAF (or setTimeout fallback)
 * so React commits once per frame. Flush immediately on complete/cancel.
 */

export type StreamCoalesceFlush = (sessionId: string, turnId: string, agentId: string, text: string) => void

type BucketKey = string

function keyOf(sessionId: string, turnId: string, agentId: string): BucketKey {
  return `${sessionId}\0${turnId}\0${agentId}`
}

export class StreamCoalescer {
  private buckets = new Map<BucketKey, { sessionId: string; turnId: string; agentId: string; text: string }>()
  private scheduled = false
  private rafId: number | null = null
  private timerId: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly flush: StreamCoalesceFlush,
    private readonly schedule: (cb: () => void) => () => void = defaultSchedule,
  ) {}

  push(sessionId: string, turnId: string, agentId: string, delta: string): void {
    if (!delta) return
    const k = keyOf(sessionId, turnId, agentId)
    const prev = this.buckets.get(k)
    if (prev) prev.text += delta
    else this.buckets.set(k, { sessionId, turnId, agentId, text: delta })
    this.ensureScheduled()
  }

  /** Immediately flush all pending deltas (message complete / dispose). */
  flushAll(): void {
    this.cancelSchedule()
    const pending = [...this.buckets.values()]
    this.buckets.clear()
    for (const b of pending) {
      if (b.text) this.flush(b.sessionId, b.turnId, b.agentId, b.text)
    }
  }

  /** Flush one turn (e.g. before message:complete for that turn). */
  flushTurn(sessionId: string, turnId: string): void {
    for (const [k, b] of [...this.buckets.entries()]) {
      if (b.sessionId === sessionId && b.turnId === turnId) {
        this.buckets.delete(k)
        if (b.text) this.flush(b.sessionId, b.turnId, b.agentId, b.text)
      }
    }
  }

  private ensureScheduled(): void {
    if (this.scheduled) return
    this.scheduled = true
    const cancel = this.schedule(() => {
      this.scheduled = false
      this.rafId = null
      this.timerId = null
      this.flushAll()
    })
    // Store cancel via schedule return; defaultSchedule uses rAF id tracking below.
    void cancel
  }

  private cancelSchedule(): void {
    this.scheduled = false
    if (typeof cancelAnimationFrame === 'function' && this.rafId != null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.timerId != null) {
      clearTimeout(this.timerId)
      this.timerId = null
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
