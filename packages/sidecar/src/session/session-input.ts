import type { SessionStore, PendingInputRow } from '../persistence/store.js'
import type { AttachmentPayload } from './attachments.js'

/** In-memory shape of a queued input. */
export interface SessionInput {
  type: 'message' | 'steer'
  content: string
  messageId?: string
  attachments?: AttachmentPayload[]
  /** WS connection that enqueued this input (multi-client ownership). */
  connectionId?: string | null
}

/** Thin facade over `SessionStore` for the durable input queue. */
export class SessionInputQueue {
  constructor(
    private readonly store: SessionStore,
    private readonly sessionId: string,
  ) {}

  admit(input: SessionInput): string {
    const baseId = input.messageId ?? `iq-${Date.now()}-${this.nextSuffix()}`
    const id = this.ensureUniqueId(baseId)
    this.store.admitSessionInput({
      id,
      sessionId: this.sessionId,
      prompt: input.content,
      delivery: input.type === 'steer' ? 'steer' : 'queue',
      timeCreated: Date.now(),
    })
    return id
  }

  private ensureUniqueId(baseId: string): string {
    const pendingIds = new Set(
      this.store.listPendingSessionInputs(this.sessionId).map((r) => r.id),
    )
    if (!pendingIds.has(baseId)) return baseId
    let counter = 1
    let candidate = `${baseId}-${counter}`
    while (pendingIds.has(candidate)) {
      counter++
      candidate = `${baseId}-${counter}`
    }
    return candidate
  }

  restore(): SessionInput[] {
    return this.store.listPendingSessionInputs(this.sessionId).map((r) => rowToInput(r))
  }

  promoteSteer(): PendingInputRow | undefined {
    return this.store.promoteSteerSessionInput(this.sessionId)
  }

  promoteNextQueued(): PendingInputRow | undefined {
    return this.store.promoteNextQueuedSessionInput(this.sessionId)
  }

  promoteById(id: string): void {
    this.store.promoteSessionInputById(this.sessionId, id)
  }

  private nextSuffix(): string {
    return Math.random().toString(36).slice(2, 8)
  }
}

function rowToInput(r: PendingInputRow): SessionInput {
  return { type: r.delivery === 'steer' ? 'steer' : 'message', content: r.prompt, messageId: r.id }
}
