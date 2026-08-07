// src/domain/messageWaiter.ts
// One-shot waiting primitives over the inbound ServerMessage stream.
// Extracted from SessionService (P0, spec 2026-08-07): the session facade owns
// a single instance, fulfills it from receive(), and injects it into the action
// modules (memoryWire / fsActions / sessionActions) so async request/result RPCs
// (testProvider, memory:*, …) stay coordinated without sharing state.
import type { ServerMessage } from '@hip/protocol'

/** A pending one-shot ServerMessage subscription. */
export type ServerMessageWaiter = {
  type: ServerMessage['type']
  /** When set, only messages matching both type and predicate fulfill this waiter. */
  predicate?: (msg: ServerMessage) => boolean
  resolve: (msg: ServerMessage) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class MessageWaiter {
  private waiters: ServerMessageWaiter[] = []

  /** One-shot wait for the next inbound ServerMessage of a given type. */
  wait<T extends ServerMessage['type']>(
    type: T,
    timeoutMs = 5000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return this.waitWhere(type, undefined, timeoutMs)
  }

  /**
   * One-shot wait for the next inbound ServerMessage of `type` that also matches
   * `predicate` (if provided). Non-matching messages of the same type leave this
   * waiter intact so concurrent requestId RPCs do not cross-resolve.
   */
  waitWhere<T extends ServerMessage['type']>(
    type: T,
    predicate: ((msg: Extract<ServerMessage, { type: T }>) => boolean) | undefined,
    timeoutMs = 5000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return new Promise((resolve, reject) => {
      const entry: ServerMessageWaiter = {
        type,
        predicate: predicate
          ? (msg) => msg.type === type && predicate(msg as Extract<ServerMessage, { type: T }>)
          : undefined,
        resolve: (msg) => resolve(msg as Extract<ServerMessage, { type: T }>),
        reject,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((w) => w !== entry)
          reject(new Error(`Timeout waiting for ${type}`))
        }, timeoutMs),
      }
      this.waiters.push(entry)
    })
  }

  /**
   * Wait for the first message whose type is in `types`. Cancels sibling waiters
   * so a validation error does not leave a hung waiter.
   */
  waitFirst<T extends ServerMessage['type']>(
    types: T[],
    timeoutMs = 5000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return new Promise((resolve, reject) => {
      const entries: ServerMessageWaiter[] = []
      const cleanup = () => {
        for (const e of entries) {
          clearTimeout(e.timer)
          this.waiters = this.waiters.filter((w) => w !== e)
        }
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`Timeout waiting for ${types.join('|')}`))
      }, timeoutMs)
      for (const type of types) {
        const entry: ServerMessageWaiter = {
          type,
          resolve: (msg) => {
            cleanup()
            clearTimeout(timer)
            resolve(msg as Extract<ServerMessage, { type: T }>)
          },
          reject: (err) => {
            cleanup()
            clearTimeout(timer)
            reject(err)
          },
          // Individual timers unused; outer timer owns the deadline.
          timer: setTimeout(() => {}, timeoutMs),
        }
        clearTimeout(entry.timer)
        entries.push(entry)
        this.waiters.push(entry)
      }
    })
  }

  /** Resolve the first waiter matching this message (if any). */
  fulfill(msg: ServerMessage): void {
    const idx = this.waiters.findIndex(
      (w) => w.type === msg.type && (!w.predicate || w.predicate(msg)),
    )
    if (idx < 0) return
    const [w] = this.waiters.splice(idx, 1)
    clearTimeout(w.timer)
    w.resolve(msg)
  }

  /** Reject all pending waiters (owner disposal). */
  dispose(): void {
    for (const w of this.waiters) {
      clearTimeout(w.timer)
      w.reject(new Error('MessageWaiter disposed'))
    }
    this.waiters = []
  }
}
