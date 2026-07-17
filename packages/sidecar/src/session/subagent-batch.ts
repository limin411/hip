/** A single task to dispatch to a subagent. */
export interface QueuedSubagentTask {
  /** Unique identifier for correlating results. */
  id: string
  /** The instruction string passed to the subagent runner. */
  prompt: string
  /** Human-readable description (used in tool schemas / logging). */
  description: string
  /** Optional per-task abort signal. When aborted the runner promise rejects. */
  signal?: AbortSignal
  /** Optional specialized agent id (explore/plan/coder/…) for dispatch routing. */
  agent?: string
}

/** Runner for one queued batch task (receives full task so agent routing is possible). */
export type BatchRunSubagentFn = (task: QueuedSubagentTask, signal: AbortSignal) => Promise<string>

/** Result from a single subagent dispatch. */
export interface SubagentResult {
  /** Matches the originating task id. */
  id: string
  /** Subagent output text. Empty string when an error occurred. */
  text: string
  /** Error message when the subagent failed. Undefined on success. */
  error?: string
}

/** Heuristic: does the error message indicate an API rate-limit response? */
function isRateLimitError(err: unknown): boolean {
  if (err === null || err === undefined) return false
  const msg = err instanceof Error ? err.message : String(err)
  return /rate|429|too many requests|quota/i.test(msg)
}

/**
 * Resolve the max-concurrency cap for parallel subagent dispatch.
 *
 * Reads `HIP_SUBAGENT_MAX_CONCURRENCY` env var (default 4, clamped to 1–10).
 * Non-numeric or out-of-range values are clamped to the nearest bound.
 */
export function resolveMaxConcurrency(): number {
  const raw = process.env.HIP_SUBAGENT_MAX_CONCURRENCY
  if (raw === undefined) return 4
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return 1
  if (n > 10) return 10
  return Math.floor(n)
}

/**
 * Dispatch multiple subagent tasks in parallel with a concurrency cap.
 *
 * - Up to `maxConcurrency` tasks run concurrently.
 * - Individual task failure does NOT abort sibling tasks.
 * - On a rate-limit error ANY task in the current batch switches subsequent
 *   batches to serial mode (one-at-a-time) to avoid compounding the limit.
 * - Per-task `AbortSignal` is forwarded to the runner.
 */
export class SubagentBatch {
  private readonly runSubagent: BatchRunSubagentFn
  private readonly maxConcurrency: number

  constructor(
    runSubagent: BatchRunSubagentFn,
    opts?: { maxConcurrency?: number },
  ) {
    this.runSubagent = runSubagent
    this.maxConcurrency = opts?.maxConcurrency ?? resolveMaxConcurrency()
  }

  async run(tasks: QueuedSubagentTask[]): Promise<SubagentResult[]> {
    if (tasks.length === 0) return []

    // Map preserves ordering and allows post-hoc lookup.
    const results = new Map<string, SubagentResult>()
    let rateLimited = false
    let i = 0

    while (i < tasks.length) {
      const chunkSize = rateLimited ? 1 : this.maxConcurrency
      const chunk = tasks.slice(i, i + chunkSize)
      i += chunk.length

      const settled = await Promise.allSettled(
        chunk.map(async (task) => {
          const signal = task.signal ?? new AbortController().signal
          try {
            const text = await this.runSubagent(task, signal)
            results.set(task.id, { id: task.id, text })
          } catch (err) {
            if (isRateLimitError(err)) {
              rateLimited = true
            }
            results.set(task.id, {
              id: task.id,
              text: '',
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }),
      )

      // A rejected settlement here would mean the catch block above also threw —
      // treat that as a rate-limit signal to avoid cascading failures.
      for (const r of settled) {
        if (r.status === 'rejected') {
          rateLimited = true
        }
      }
    }

    // Return results in the same order as the input tasks.
    return tasks.map(
      (t) => results.get(t.id) ?? { id: t.id, text: '', error: 'unknown' },
    )
  }
}
