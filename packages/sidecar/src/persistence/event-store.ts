import type { DatabaseSync } from './sqlite.js'
import type { SessionConfig, TurnUsage } from '@hip/protocol'
import { HumanMessage, AIMessage, SystemMessage, type BaseMessage, type MessageContent } from '@langchain/core/messages'

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

/** JSON shape of a single tool call inside an AI message snapshot. */
interface ToolCallJson {
  readonly name: string
  readonly args: Record<string, unknown>
  readonly id: string
  readonly type: 'tool_call'
}

/** JSON shape of a single message inside a session snapshot. */
interface MessageJson {
  readonly type: 'human' | 'ai' | 'system'
  readonly content: string
  readonly tool_calls?: readonly ToolCallJson[]
}

/** A high-level session snapshot: the data needed to warm-start a Session. */
export interface SessionSnapshot {
  readonly seq: number
  readonly messages: readonly BaseMessage[]
  readonly config: SessionConfig
  readonly usageByAgent?: Record<string, TurnUsage>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isToolCallJson(value: unknown): value is ToolCallJson {
  if (!isRecord(value)) return false
  return (
    typeof value.name === 'string' &&
    isRecord(value.args) &&
    typeof value.id === 'string' &&
    (value.type === 'tool_call' || value.type === undefined)
  )
}

function isMessageJson(value: unknown): value is MessageJson {
  if (!isRecord(value)) return false
  const type = value.type
  if (type !== 'human' && type !== 'ai' && type !== 'system') return false
  if (typeof value.content !== 'string') return false
  if (value.tool_calls !== undefined) {
    if (!Array.isArray(value.tool_calls) || !value.tool_calls.every(isToolCallJson)) return false
  }
  return true
}

/** Parse a snapshot content string. Arrays are stored as JSON strings by
 *  serializeMessages; restore them so HumanMessage content parts survive. */
function parseSnapshotContent(content: string): MessageContent {
  try {
    const parsed: unknown = JSON.parse(content)
    if (Array.isArray(parsed)) return parsed as MessageContent
  } catch {
    // intentionally fall through
  }
  return content
}

/** Convert a BaseMessage array into a snapshot-serializable JSON string. */
export function serializeMessages(messages: readonly BaseMessage[]): string {
  const payload: MessageJson[] = messages.map((m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    const type = m.getType()
    if (type === 'human') return { type: 'human', content }
    if (type === 'system') return { type: 'system', content }
    const ai = m as AIMessage
    return {
      type: 'ai',
      content,
      tool_calls: ai.tool_calls?.map(
        (tc): ToolCallJson => ({
          name: tc.name,
          args: tc.args as Record<string, unknown>,
          id: tc.id ?? '',
          type: tc.type ?? 'tool_call',
        }),
      ),
    }
  })
  return JSON.stringify(payload)
}

/** Reconstruct a BaseMessage array from a snapshot JSON string. */
export function deserializeMessages(json: string): BaseMessage[] {
  const parsed: unknown = JSON.parse(json)
  if (!Array.isArray(parsed)) return []
  return parsed.map((item): BaseMessage => {
    if (!isMessageJson(item)) return new AIMessage(String(item))
    switch (item.type) {
      case 'human':
        return new HumanMessage(parseSnapshotContent(item.content))
      case 'system':
        return new SystemMessage(parseSnapshotContent(item.content))
      case 'ai':
        return new AIMessage({
          content: parseSnapshotContent(item.content),
          tool_calls: item.tool_calls?.map((tc) => ({ ...tc, type: tc.type ?? 'tool_call' })),
        })
    }
  })
}

/** Persist a typed session snapshot, replacing any previous snapshot for the session. */
export function saveSessionSnapshot(
  store: SnapshotStore,
  sessionId: string,
  seq: number,
  snapshot: Omit<SessionSnapshot, 'seq'>,
): void {
  store.saveSnapshot(
    sessionId,
    seq,
    JSON.stringify({
      messages: serializeMessages(snapshot.messages),
      config: snapshot.config,
      usageByAgent: snapshot.usageByAgent,
    }),
  )
}

/** Load the latest typed session snapshot, or null if none exists. */
export function loadSessionSnapshot(store: SnapshotStore, sessionId: string): SessionSnapshot | null {
  const row = store.loadSnapshot(sessionId)
  if (row == null) return null
  const parsed: unknown = JSON.parse(row.state)
  if (!isRecord(parsed)) return null
  const config = isRecord(parsed.config)
    ? (parsed.config as unknown as SessionConfig)
    : { llmProvider: '', model: '', tools: [] }
  const messages = typeof parsed.messages === 'string' ? deserializeMessages(parsed.messages) : []
  const usageByAgent =
    isRecord(parsed.usageByAgent) ? (parsed.usageByAgent as unknown as Record<string, TurnUsage>) : undefined
  return { seq: row.seq, messages, config, usageByAgent }
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
