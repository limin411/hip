/**
 * A resettable idle timer. `kick()` (re)arms the countdown; if the full interval elapses with no
 * kick, `onTimeout` fires once. `stop()` cancels it permanently (later kicks are no-ops). Used to
 * abort a turn whose provider stream has stalled (no activity), without killing a turn that is
 * still progressing — any outbound activity kicks it.
 *
 * Note: the timeout is **idle** (no outbound activity), not wall-clock turn duration.
 */

/** How often a long-running tool should signal activity so the idle watchdog does not fire mid-walk. */
export const TOOL_ACTIVITY_INTERVAL_MS = 5_000

/** Human-readable TIMEOUT error body for the client. */
export function idleTimeoutMessage(idleTimeoutMs: number): string {
  return `Idle timeout after ${idleTimeoutMs}ms with no outbound activity`
}

export class IdleWatchdog {
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  constructor(private readonly ms: number, private readonly onTimeout: () => void) {}

  kick(): void {
    if (this.stopped) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; this.onTimeout() }, this.ms)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
  }
}
