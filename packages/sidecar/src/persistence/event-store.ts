import type { DatabaseSync } from './sqlite.js'

export interface SessionEvent {
  id: string
  aggregateId: string
  seq: number
  type: string
  data: Record<string, unknown>
}

interface EventSequenceRow {
  seq: number
}

interface EventRow {
  id: string
  aggregate_id: string
  seq: number
  type: string
  data: string
}

interface SnapshotRow {
  session_id: string
  seq: number
  state: string
  timestamp: number
}

export interface LoadedSnapshot {
  seq: number
  state: string
  timestamp: number
}

export class EventStore {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Append an event to the aggregate's log. Reserves and persists the next
   * sequence number, but does NOT open a SQLite transaction — the caller is
   * responsible for transaction boundaries. Used by Session.emit() so that
   * legacy persistence and the event log are committed in a single transaction.
   */
  append(sessionId: string, type: string, data: Record<string, unknown>): SessionEvent {
    const current = this.db
      .prepare('SELECT seq FROM event_sequence WHERE aggregate_id = ?')
      .get(sessionId) as EventSequenceRow | undefined
    const seq = (current?.seq ?? 0) + 1

    if (current == null) {
      this.db
        .prepare('INSERT INTO event_sequence(aggregate_id, seq) VALUES (?, ?)')
        .run(sessionId, seq)
    } else {
      this.db
        .prepare('UPDATE event_sequence SET seq = ? WHERE aggregate_id = ?')
        .run(seq, sessionId)
    }

    const event: SessionEvent = {
      id: `${sessionId}:${seq}`,
      aggregateId: sessionId,
      seq,
      type,
      data,
    }
    this.db
      .prepare('INSERT INTO event(id, aggregate_id, seq, type, data) VALUES (?, ?, ?, ?, ?)')
      .run(event.id, sessionId, seq, type, JSON.stringify(data))
    return event
  }

  /**
   * Append an event to the aggregate's log. Atomically reserves and persists the
   * next sequence number under a single SQLite transaction, so the sequence counter
   * and the event row can never diverge — even on crash mid-write.
   */
  publish(sessionId: string, type: string, data: Record<string, unknown>): { seq: number } {
    this.db.exec('BEGIN')
    try {
      const event = this.append(sessionId, type, data)
      this.db.exec('COMMIT')
      return { seq: event.seq }
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  /** Load the aggregate's full event history in seq order, or from `fromSeq` onwards (inclusive). */
  loadEvents(sessionId: string, fromSeq?: number): SessionEvent[] {
    const sql = fromSeq == null
      ? 'SELECT id, aggregate_id, seq, type, data FROM event WHERE aggregate_id = ? ORDER BY seq'
      : 'SELECT id, aggregate_id, seq, type, data FROM event WHERE aggregate_id = ? AND seq >= ? ORDER BY seq'
    const rows = (fromSeq == null
      ? this.db.prepare(sql).all(sessionId)
      : this.db.prepare(sql).all(sessionId, fromSeq)) as EventRow[]

    return rows.map((r): SessionEvent => ({
      id: r.id,
      aggregateId: r.aggregate_id,
      seq: r.seq,
      type: r.type,
      data: JSON.parse(r.data) as Record<string, unknown>,
    }))
  }

  /** Highest seq published for the aggregate (0 if no events). */
  latestSeq(sessionId: string): number {
    const row = this.db
      .prepare('SELECT seq FROM event_sequence WHERE aggregate_id = ?')
      .get(sessionId) as EventSequenceRow | undefined
    return row?.seq ?? 0
  }
}

export class SnapshotStore {
  constructor(private readonly db: DatabaseSync) {}

  /** Upsert a snapshot for the session. INSERT OR REPLACE: the latest write wins. */
  saveSnapshot(sessionId: string, seq: number, state: string): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO snapshots(session_id, seq, state, timestamp) VALUES (?, ?, ?, ?)',
      )
      .run(sessionId, seq, state, Date.now())
  }

  /** Load the latest snapshot for the session, or null if none exists. */
  loadSnapshot(sessionId: string): LoadedSnapshot | null {
    const row = this.db
      .prepare('SELECT session_id, seq, state, timestamp FROM snapshots WHERE session_id = ?')
      .get(sessionId) as SnapshotRow | undefined
    if (row == null) return null
    return { seq: row.seq, state: row.state, timestamp: row.timestamp }
  }
}
