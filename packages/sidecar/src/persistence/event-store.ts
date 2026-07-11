import type { DatabaseSync } from './sqlite.js'
import type { SessionConfig, TurnUsage } from '@hip/protocol'
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
  type MessageContent,
} from '@langchain/core/messages'

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
  readonly type: 'human' | 'ai' | 'system' | 'tool'
  readonly content: string
  readonly tool_calls?: readonly ToolCallJson[]
  /** Present when type === 'tool' (LangChain ToolMessage.tool_call_id). */
  readonly tool_call_id?: string
  /** Optional tool name on tool result messages. */
  readonly name?: string
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
  if (type !== 'human' && type !== 'ai' && type !== 'system' && type !== 'tool') return false
  if (typeof value.content !== 'string') return false
  if (type === 'tool') {
    return typeof value.tool_call_id === 'string' && value.tool_call_id.length > 0
  }
  if (value.tool_calls !== undefined) {
    if (!Array.isArray(value.tool_calls) || !value.tool_calls.every(isToolCallJson)) return false
  }
  return true
}

interface LcArrayTag {
  __lcArray: true
  value: unknown
}

function isLcArrayTag(value: unknown): value is LcArrayTag {
  return isRecord(value) && value.__lcArray === true && 'value' in value
}

/** Parse a snapshot content string. Non-string content arrays are stored as tagged
 *  JSON strings by serializeMessages; restore them so HumanMessage content parts survive.
 *  Plain string content is kept as a string, even when it looks like JSON. */
function parseSnapshotContent(content: string): MessageContent {
  try {
    const parsed: unknown = JSON.parse(content)
    if (isLcArrayTag(parsed)) return parsed.value as MessageContent
  } catch {
    // intentionally fall through
  }
  return content
}

/** Convert a BaseMessage array into a snapshot-serializable JSON string. */
export function serializeMessages(messages: readonly BaseMessage[]): string {
  const payload: MessageJson[] = messages.map((m) => {
    const content = typeof m.content === 'string'
      ? m.content
      : JSON.stringify({ __lcArray: true, value: m.content })
    const type = m.getType()
    if (type === 'human') return { type: 'human', content }
    if (type === 'system') return { type: 'system', content }
    if (type === 'tool') {
      const tool = m as ToolMessage
      return {
        type: 'tool',
        content,
        tool_call_id: tool.tool_call_id,
        ...(tool.name ? { name: tool.name } : {}),
      }
    }
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
      case 'tool':
        return new ToolMessage({
          content: parseSnapshotContent(item.content),
          tool_call_id: item.tool_call_id!,
          ...(item.name ? { name: item.name } : {}),
        })
      case 'ai':
        return new AIMessage({
          content: parseSnapshotContent(item.content),
          tool_calls: item.tool_calls?.map((tc) => ({ ...tc, type: tc.type ?? 'tool_call' })),
        })
    }
  })
}

/**
 * True when every AIMessage.tool_calls entry has a following ToolMessage with
 * the matching tool_call_id before the next non-tool turn boundary.
 * Used to reject snapshots corrupted by older serializers that dropped ToolMessages.
 */
export function hasValidToolCallPairing(messages: readonly BaseMessage[]): boolean {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (!(m instanceof AIMessage) || !m.tool_calls?.length) continue
    const needed = m.tool_calls
      .map((tc) => tc.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    if (needed.length === 0) continue
    const found = new Set<string>()
    for (let j = i + 1; j < messages.length; j++) {
      const next = messages[j]
      if (next instanceof ToolMessage) {
        found.add(next.tool_call_id)
        continue
      }
      break
    }
    for (const id of needed) {
      if (!found.has(id)) return false
    }
  }
  return true
}

/**
 * Ensure each AIMessage.tool_calls id has a following ToolMessage.
 * Inserts synthetic error results for missing ids so providers accept the history.
 * Does not rewrite already-valid sequences.
 */
export function ensureToolCallResults(messages: readonly BaseMessage[]): BaseMessage[] {
  if (hasValidToolCallPairing(messages)) return messages as BaseMessage[]
  const out: BaseMessage[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    out.push(m)
    if (!(m instanceof AIMessage) || !m.tool_calls?.length) continue
    const needed = m.tool_calls.map((tc) => ({
      id: (typeof tc.id === 'string' && tc.id.length > 0 ? tc.id : tc.name) as string,
      name: tc.name,
    }))
    const found = new Set<string>()
    let j = i + 1
    while (j < messages.length && messages[j] instanceof ToolMessage) {
      found.add((messages[j] as ToolMessage).tool_call_id)
      j++
    }
    for (const tc of needed) {
      if (found.has(tc.id)) continue
      out.push(
        new ToolMessage({
          content: 'Error: tool result missing from session history (recovered)',
          tool_call_id: tc.id,
          name: tc.name,
        }),
      )
    }
  }
  return out
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
