// packages/sidecar/src/session/background-inject.ts
// Background task status injection (G5): after compaction the model loses its
// memory of still-running background tasks; this module rebuilds that memory
// as a compact system message. Completed results are held as pending and
// injected once at the start of the next user turn.
import type { BackgroundManager } from './task-runtime.js'

/**
 * Compact status line for every still-running background task, or null when
 * nothing is running. Format is deliberately terse — one line per task:
 * `task <id> (<description>): running, started <relative time>`.
 */
export function backgroundStatusText(bg: BackgroundManager | undefined): string | null {
  if (!bg) return null
  const running: Array<{ id: string; description: string; startedMsAgo: number }> = []
  const now = Date.now()
  for (const [id, meta] of bg.meta) {
    if (meta.status === 'running' && meta.kind !== 'schedule') {
      running.push({
        id,
        description: meta.description,
        startedMsAgo: now - (meta.createdAt ?? now),
      })
    }
  }
  if (running.length === 0) return null
  const lines = running
    .map((t) => {
      const mins = Math.max(1, Math.round(t.startedMsAgo / 60000))
      return `- task ${t.id} (${t.description}): running, started ${mins} min ago`
    })
    .join('\n')
  return (
    'Background tasks still running (do not assume they finished):\n' +
    lines +
    '\nUse wait_tasks / monitor to collect results, or continue other work in parallel.'
  )
}

/** Collects completed background task results and injects each exactly once. */
export class PendingBackgroundResults {
  private readonly pending = new Map<string, string>()

  /** Record a completion (status 'completed' or 'failed') for later injection. */
  collect(taskId: string, status: string, result: string | undefined): void {
    if (status !== 'completed' && status !== 'failed') return
    const body = (result ?? '').trim().slice(0, 2000)
    this.pending.set(taskId, body || `(no output)`)
  }

  /** Drain all pending results as one system message, or null when empty. */
  drain(): string | null {
    if (this.pending.size === 0) return null
    const lines = [...this.pending.entries()]
      .map(([id, body]) => `- task ${id}: ${body}`)
      .join('\n')
    this.pending.clear()
    return `Completed background task results:\n${lines}`
  }

  get size(): number {
    return this.pending.size
  }
}
