import type { DatabaseSync } from './sqlite.js'
import type { SessionEvent } from './event-store.js'
import {
  SessionMessageUpdater,
  SESSION_EVENT_TYPES,
  type SessionEventType,
  type SessionMessageRow,
} from './message-updater.js'

/**
 * Public projection surface: `projectEvent` runs synchronously inside the
 * caller's event-publish transaction, mutating `session_message` to reflect
 * one event. `projectEvents` replays an event stream — used by crash-recovery
 * to rebuild a projection from the log.
 *
 * Unknown event types (anything outside SESSION_EVENT_TYPES) are logged and
 * skipped: a forward-compatible projector must not crash when it sees a
 * newly-added event type it has no rule for yet.
 */

export {
  SessionMessageUpdater,
  SESSION_EVENT_TYPES,
  type SessionEventType,
  type SessionMessageRow,
  type SessionMessageData,
  type AssistantStepData,
  type ProjectedToolCall,
  type ProjectedUsage,
  stepRowId,
  compactionRowId,
} from './message-updater.js'

/** True if `t` is one of the projection's known event types. */
function isKnownType(t: string): t is SessionEventType {
  return (SESSION_EVENT_TYPES as readonly string[]).includes(t)
}

/**
 * Project a single event into the session_message table.
 * Synchronous — designed to run inside the event-publish SQLite transaction.
 * Unknown event types warn and no-op (forward compatibility).
 */
export function projectEvent(db: DatabaseSync, event: SessionEvent): void {
  if (!isKnownType(event.type)) {
    console.warn(`[message-projector] unknown event type '${event.type}' (seq=${event.seq}); skipping`)
    return
  }
  const updater = new SessionMessageUpdater(db)
  updater.apply(event)
}

/**
 * Replay an event stream into the session_message table, in order.
 * Used by crash recovery: load events from the event log, replay them, and
 * the projection converges to the same state as if each event had been
 * projected live.
 */
export function projectEvents(db: DatabaseSync, events: readonly SessionEvent[]): void {
  const updater = new SessionMessageUpdater(db)
  for (const event of events) {
    if (!isKnownType(event.type)) {
      console.warn(`[message-projector] unknown event type '${event.type}' (seq=${event.seq}); skipping`)
      continue
    }
    updater.apply(event)
  }
}

/** Read helper: all session_message rows for a session, in projection (seq) order. */
export function loadProjection(db: DatabaseSync, sessionId: string): readonly SessionMessageRow[] {
  return new SessionMessageUpdater(db).loadSessionMessages(sessionId)
}
