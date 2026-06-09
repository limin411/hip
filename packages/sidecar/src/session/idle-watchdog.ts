/**
 * A resettable idle timer. `kick()` (re)arms the countdown; if the full interval elapses with no
 * kick, `onTimeout` fires once. `stop()` cancels it permanently (later kicks are no-ops). Used to
 * abort a turn whose provider stream has stalled (no activity), without killing a turn that is
 * still progressing — any outbound activity kicks it.
 */
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
