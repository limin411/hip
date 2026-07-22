/**
 * TurnEnqueuer — schedule/wake path using Session.enqueueInput + drainInputQueue.
 * Spec KD-20, KD-23.
 */
import type { SendFn } from './session-turn-runner.js'

export type WakeMode = 'notice' | 'auto'

export interface TurnEnqueuerHost {
  id: string
  running: boolean
  awaitingResume?: boolean
  enqueueInput: (item: {
    type: 'message' | 'steer'
    content: string
    messageId: string
    connectionId?: string | null
  }) => void
  drainInputQueue: (send: SendFn) => Promise<void>
}

const MAX_WAKE_BUFFER = 10

export class TurnEnqueuer {
  private buffer: Array<{ content: string; messageId: string }> = []
  private flushing = false

  constructor(
    private readonly host: TurnEnqueuerHost,
    private readonly getSend: () => SendFn | null,
  ) {}

  /** Enqueue a synthetic user message wake (schedule fire / auto completion). */
  enqueueWake(content: string, messageId = `wake-${Date.now()}`): void {
    if (this.host.running || this.host.awaitingResume) {
      if (this.buffer.length >= MAX_WAKE_BUFFER) {
        this.buffer.shift()
      }
      this.buffer.push({ content, messageId })
      return
    }
    this.host.enqueueInput({
      type: 'message',
      content,
      messageId,
      connectionId: null,
    })
    const send = this.getSend()
    if (send) void this.host.drainInputQueue(send)
  }

  /**
   * Drain buffered wakes. Must be called when session becomes idle
   * (Session.drainInputQueue finally). Always attempts drainInputQueue.
   */
  async flushWakeBuffer(): Promise<void> {
    if (this.flushing) return
    if (this.buffer.length === 0) return
    if (this.host.running || this.host.awaitingResume) return
    this.flushing = true
    try {
      while (this.buffer.length > 0 && !this.host.running && !this.host.awaitingResume) {
        const next = this.buffer.shift()!
        this.host.enqueueInput({
          type: 'message',
          content: next.content,
          messageId: next.messageId,
          connectionId: null,
        })
        const send = this.getSend()
        if (send) await this.host.drainInputQueue(send)
        else break
      }
    } finally {
      this.flushing = false
    }
  }

  clear(): void {
    this.buffer = []
  }
}
