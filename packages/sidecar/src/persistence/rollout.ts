import { openDatabase } from './open.js'
import type { DatabaseSync } from './sqlite.js'
import { EventStore, SnapshotStore, type SessionEvent } from './event-store.js'
import { projectEvents, loadProjection } from './message-projector.js'
import type {
  SessionMessageRow,
  SessionMessageData,
  ProjectedToolCall,
} from './message-types.js'

export interface ReconstructedState {
  readonly sessionId: string
  readonly snapshotSeq: number
  readonly eventsReplayed: number
  readonly messages: readonly SessionMessageRow[]
}

export interface ValidationResult {
  readonly ok: boolean
  readonly gaps: readonly number[]
}

function isSessionMessageRow(value: unknown): value is SessionMessageRow {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.sessionId === 'string' &&
    typeof row.type === 'string' &&
    typeof row.seq === 'number' &&
    typeof row.timeCreated === 'number' &&
    typeof row.timeUpdated === 'number' &&
    typeof row.data === 'object' &&
    row.data !== null
  )
}

function parseSnapshotState(state: string): readonly SessionMessageRow[] {
  try {
    const parsed = JSON.parse(state) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isSessionMessageRow)
  } catch {
    return []
  }
}

function seedMessages(
  db: DatabaseSync,
  messages: readonly SessionMessageRow[],
): void {
  const insert = db.prepare(
    'INSERT OR REPLACE INTO session_message(id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  for (const m of messages) {
    insert.run(
      m.id,
      m.sessionId,
      m.type,
      m.seq,
      m.timeCreated,
      m.timeUpdated,
      JSON.stringify(m.data),
    )
  }
}

function markInterruptedTools(
  messages: readonly SessionMessageRow[],
): readonly SessionMessageRow[] {
  return messages.map((m): SessionMessageRow => {
    if (m.data.role !== 'assistant' || 'kind' in m.data) return m
    const hasRunning = m.data.toolCalls.some((t) => t.status === 'running')
    if (!hasRunning) return m
    const nextToolCalls: readonly ProjectedToolCall[] = m.data.toolCalls.map(
      (t) =>
        t.status === 'running'
          ? {
              ...t,
              status: 'error' as const,
              error: 'tool interrupted during rollout',
            }
          : t,
    )
    const nextData: SessionMessageData = { ...m.data, toolCalls: nextToolCalls }
    return { ...m, data: nextData }
  })
}

/**
 * Reconstruct a Session's projected state from the event log.
 *
 * Algorithm:
 *   1. Load the latest snapshot for the session (if any).
 *   2. Reverse-scan the event log from the newest event back to the snapshot
 *      boundary, building the changelog of events that must be replayed.
 *   3. Open a fresh in-memory SQLite database and seed it with the snapshot's
 *      projected rows (when present).
 *   4. Forward-replay the changelog with `projectEvents`.
 *   5. Convert any tool calls still in `running` status to `error` — these
 *      represent interrupted operations that never received a success/failure
 *      event.
 *
 * The source database is never written to; all mutation happens on the
 * throwaway in-memory database.
 */
export function reconstructSessionState(
  sourceDb: DatabaseSync,
  sessionId: string,
): ReconstructedState {
  const sourceEvents = new EventStore(sourceDb)
  const sourceSnapshots = new SnapshotStore(sourceDb)

  const snapshot = sourceSnapshots.loadSnapshot(sessionId)
  const snapshotSeq = snapshot?.seq ?? 0

  // Pass 1: reverse scan from latest event back to the snapshot boundary.
  const allEvents = sourceEvents.loadEvents(sessionId)
  const changelog: SessionEvent[] = []
  for (let i = allEvents.length - 1; i >= 0; i--) {
    const event = allEvents[i]
    if (snapshotSeq > 0 && event.seq <= snapshotSeq) break
    changelog.push(event)
  }
  changelog.reverse()

  // Pass 2: forward replay inside a fresh in-memory database.
  const { db: memDb } = openDatabase(':memory:')
  try {
    if (snapshot != null && snapshotSeq > 0) {
      seedMessages(memDb, parseSnapshotState(snapshot.state))
    }
    projectEvents(memDb, changelog)
    const messages = markInterruptedTools(loadProjection(memDb, sessionId))
    return {
      sessionId,
      snapshotSeq,
      eventsReplayed: changelog.length,
      messages,
    }
  } finally {
    memDb.close()
  }
}

/**
 * Rollout engine for session-state reconstruction and event-log validation.
 *
 * All operations are read-only against the source database; reconstruction
 * projects state into a separate in-memory database.
 */
export class RolloutEngine {
  constructor(private readonly sourceDb: DatabaseSync) {}

  reconstruct(sessionId: string): ReconstructedState {
    return reconstructSessionState(this.sourceDb, sessionId)
  }

  /**
   * Check the event log for sequence-number gaps.
   *
   * A contiguous log starts at seq 1 and increments by 1 for every event.
   * Any missing integer is reported in `gaps`. The source database is read
   * but never modified.
   */
  validate(sessionId: string): ValidationResult {
    const events = new EventStore(this.sourceDb).loadEvents(sessionId)
    const gaps: number[] = []
    let expected = 1
    for (const event of events) {
      while (expected < event.seq) {
        gaps.push(expected)
        expected++
      }
      expected++
    }
    return { ok: gaps.length === 0, gaps }
  }
}
