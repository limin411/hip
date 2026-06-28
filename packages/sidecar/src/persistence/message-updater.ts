import type { DatabaseSync } from './sqlite.js'
import type { Attachment } from '@hip/protocol'
import type { SessionEvent } from './event-store.js'
import {
  stepRowId,
  compactionRowId,
  isAssistantStep,
  type SessionMessageData,
  type SessionMessageRow,
  type AssistantStepData,
  type ProjectedToolCall,
} from './message-types.js'
import { reqString, optString, optNumber, optStringArray, optObjectArray, parseUsage } from './message-parsers.js'

export {
  stepRowId,
  compactionRowId,
  isAssistantStep,
  SESSION_EVENT_TYPES,
  type SessionEventType,
  type SessionMessageData,
  type SessionMessageRow,
  type AssistantStepData,
  type ProjectedToolCall,
  type ProjectedUsage,
} from './message-types.js'
export { EventPayloadError } from './message-parsers.js'

/**
 * session_message projection mutator.
 *
 * Each event type maps to one of:
 *   - INSERT a new session_message row (user_message, step_started, compaction_ended)
 *   - UPDATE an existing row's data blob (text_ended, tool_*, step_ended, step_failed)
 *   - no-op (text_started, agent_switched, model_switched)
 *
 * Stateless across calls — every mutation looks up its target row by a
 * deterministic id derived from the event payload, so a single updater
 * instance can serve any session and is safe under replay.
 *
 * allow: SIZE_OK — indivisible state machine. The 12 event handlers share
 *   `this.db` / `this.upsertRow` / `this.patchStep` / `this.findStepForCall`
 *   and cannot be split across files without breaking the class. Pure LOC
 *   is dominated by exhaustive per-event-type handlers (one method per type
 *   is the whole point — collapsing them into a data-driven table would
 *   hide the projection's per-event semantics from the reader).
 */
export class SessionMessageUpdater {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Dispatch one event to its handler.
   *
   * The switch lists every type in SESSION_EVENT_TYPES explicitly. Unknown
   * types warn and no-op — SessionEvent.type is a plain string at the type
   * level, so we cannot narrow to `never` in the default branch; forward
   * compatibility is the spec.
   */
  apply(event: SessionEvent): void {
    switch (event.type) {
      case 'user_message':
        this.onUserMessage(event)
        return
      case 'step_started':
        this.onStepStarted(event)
        return
      case 'step_ended':
        this.onStepEnded(event)
        return
      case 'step_failed':
        this.onStepFailed(event)
        return
      case 'text_started':
        // Streaming marker only — the assistant row already exists from step_started.
        return
      case 'text_ended':
        this.onTextEnded(event)
        return
      case 'tool_called':
        this.onToolCalled(event)
        return
      case 'tool_success':
        this.onToolSettled(event, 'finished')
        return
      case 'tool_failed':
        this.onToolSettled(event, 'error')
        return
      case 'compaction_ended':
        this.onCompactionEnded(event)
        return
      case 'agent_switched':
        // Context-level event — does not produce or mutate message rows.
        return
      case 'model_switched':
        // Context-level event — does not produce or mutate message rows.
        return
      default:
        console.warn(`[message-updater] unhandled event type '${event.type}' (seq=${event.seq}); no-op`)
    }
  }

  /** Read the in-progress assistant step row, or null if absent / not an assistant step. */
  loadAssistantStep(sessionId: string, stepId: string): AssistantStepData | null {
    const row = this.db
      .prepare('SELECT data FROM session_message WHERE id = ?')
      .get(stepRowId(sessionId, stepId)) as { data: string } | undefined
    if (row == null) return null
    const parsed = JSON.parse(row.data) as SessionMessageData
    return isAssistantStep(parsed) ? parsed : null
  }

  /** Read every session_message row for the session in projection (seq) order. */
  loadSessionMessages(sessionId: string): readonly SessionMessageRow[] {
    const rows = this.db
      .prepare(
        'SELECT id, session_id, type, seq, time_created, time_updated, data FROM session_message WHERE session_id = ? ORDER BY seq',
      )
      .all(sessionId) as ReadonlyArray<{
        id: string
        session_id: string
        type: string
        seq: number
        time_created: number
        time_updated: number
        data: string
      }>
    return rows.map((r): SessionMessageRow => ({
      id: r.id,
      sessionId: r.session_id,
      type: r.type,
      seq: r.seq,
      timeCreated: r.time_created,
      timeUpdated: r.time_updated,
      data: JSON.parse(r.data) as SessionMessageData,
    }))
  }

  // ── INSERT handlers ───────────────────────────────────────────────────────

  private onUserMessage(event: SessionEvent): void {
    const messageId = reqString(event.data, 'user_message', 'messageId')
    const content = reqString(event.data, 'user_message', 'content')
    const timestamp = optNumber(event.data, 'timestamp') ?? event.seq
    const attachments = optObjectArray<Attachment>(event.data, 'attachments')
    const data: SessionMessageData = { role: 'user', content, messageId, ...(attachments?.length ? { attachments } : {}) }
    this.upsertRow({
      id: messageId,
      sessionId: event.aggregateId,
      type: 'user',
      seq: event.seq,
      timeCreated: timestamp,
      timeUpdated: timestamp,
      data,
    })
  }

  private onStepStarted(event: SessionEvent): void {
    const stepId = reqString(event.data, 'step_started', 'stepId')
    const agentId = reqString(event.data, 'step_started', 'agentId')
    const agentRole = optString(event.data, 'agentRole') ?? 'assistant'
    const startedAt = optNumber(event.data, 'startedAt') ?? event.seq
    const data: SessionMessageData = {
      role: 'assistant',
      stepId,
      agentId,
      agentRole,
      content: '',
      toolCalls: [],
      startedAt,
      finishedAt: null,
      error: null,
      usage: null,
    }
    this.upsertRow({
      id: stepRowId(event.aggregateId, stepId),
      sessionId: event.aggregateId,
      type: 'assistant',
      seq: event.seq,
      timeCreated: startedAt,
      timeUpdated: startedAt,
      data,
    })
  }

  private onCompactionEnded(event: SessionEvent): void {
    const summary = reqString(event.data, 'compaction_ended', 'summary')
    const replacedMessageIds = optStringArray(event.data, 'replacedMessageIds')
    const timestamp = optNumber(event.data, 'timestamp') ?? event.seq
    const data: SessionMessageData = {
      role: 'assistant',
      kind: 'compaction',
      summary,
      replacedMessageIds,
    }
    this.upsertRow({
      id: compactionRowId(event.aggregateId, event.seq),
      sessionId: event.aggregateId,
      type: 'compaction',
      seq: event.seq,
      timeCreated: timestamp,
      timeUpdated: timestamp,
      data,
    })
  }

  // ── UPDATE handlers ───────────────────────────────────────────────────────

  private onStepEnded(event: SessionEvent): void {
    const stepId = reqString(event.data, 'step_ended', 'stepId')
    const finishedAt = optNumber(event.data, 'finishedAt') ?? event.seq
    const usage = parseUsage(event.data)
    this.patchStep(event.aggregateId, stepId, event.seq, (d) => ({ ...d, finishedAt, usage }))
  }

  private onStepFailed(event: SessionEvent): void {
    const stepId = reqString(event.data, 'step_failed', 'stepId')
    const error = optString(event.data, 'error') ?? 'step failed'
    const finishedAt = optNumber(event.data, 'finishedAt') ?? event.seq
    this.patchStep(event.aggregateId, stepId, event.seq, (d) => ({ ...d, finishedAt, error }))
  }

  private onTextEnded(event: SessionEvent): void {
    const stepId = reqString(event.data, 'text_ended', 'stepId')
    const content = optString(event.data, 'content') ?? ''
    this.patchStep(event.aggregateId, stepId, event.seq, (d) => ({
      ...d,
      content: d.content.length === 0 ? content : d.content + content,
    }))
  }

  private onToolCalled(event: SessionEvent): void {
    const stepId = reqString(event.data, 'tool_called', 'stepId')
    const callId = reqString(event.data, 'tool_called', 'callId')
    const name = reqString(event.data, 'tool_called', 'name')
    const input = optString(event.data, 'input') ?? '{}'
    const seq = optNumber(event.data, 'seq') ?? event.seq
    this.patchStep(event.aggregateId, stepId, event.seq, (d) => {
      const without = d.toolCalls.filter((t) => t.callId !== callId)
      const next: ProjectedToolCall = {
        callId,
        name,
        input,
        status: 'running',
        output: null,
        error: null,
        seq,
      }
      return { ...d, toolCalls: [...without, next].sort((a, b) => a.seq - b.seq) }
    })
  }

  private onToolSettled(event: SessionEvent, status: 'finished' | 'error'): void {
    const callId = reqString(event.data, event.type, 'callId')
    const stepIdHint = optString(event.data, 'stepId')
    this.patchStepByCallId(event.aggregateId, callId, stepIdHint, event.seq, (tool) => {
      if (status === 'finished') {
        const output = optString(event.data, 'output') ?? ''
        return { ...tool, status: 'finished', output }
      }
      const error = optString(event.data, 'error') ?? 'tool failed'
      return { ...tool, status: 'error', error }
    })
  }

  // ── low-level row helpers ─────────────────────────────────────────────────

  private upsertRow(row: {
    id: string
    sessionId: string
    type: string
    seq: number
    timeCreated: number
    timeUpdated: number
    data: SessionMessageData
  }): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO session_message(id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(row.id, row.sessionId, row.type, row.seq, row.timeCreated, row.timeUpdated, JSON.stringify(row.data))
  }

  private patchStep(
    sessionId: string,
    stepId: string,
    eventSeq: number,
    fn: (d: AssistantStepData) => AssistantStepData,
  ): void {
    const current = this.loadAssistantStep(sessionId, stepId)
    if (current == null) {
      console.warn(
        `[message-updater] patch target not found: session=${sessionId} step=${stepId}; event seq=${eventSeq} dropped`,
      )
      return
    }
    const next = fn(current)
    this.db
      .prepare('UPDATE session_message SET time_updated = ?, data = ? WHERE id = ?')
      .run(eventSeq, JSON.stringify(next), stepRowId(sessionId, stepId))
  }

  private patchStepByCallId(
    sessionId: string,
    callId: string,
    stepIdHint: string | null,
    eventSeq: number,
    fn: (tool: ProjectedToolCall) => ProjectedToolCall,
  ): void {
    const target = this.findStepForCall(sessionId, callId, stepIdHint)
    if (target == null) {
      console.warn(
        `[message-updater] tool call not found: session=${sessionId} callId=${callId}; event seq=${eventSeq} dropped`,
      )
      return
    }
    this.patchStep(sessionId, target.stepId, eventSeq, (d) => ({
      ...d,
      toolCalls: d.toolCalls.map((t) => (t.callId === callId ? fn(t) : t)),
    }))
  }

  /** Locate the assistant step that owns a tool call, by hint or by full scan over the session projection. */
  private findStepForCall(
    sessionId: string,
    callId: string,
    stepIdHint: string | null,
  ): { stepId: string } | null {
    if (stepIdHint != null) {
      const byHint = this.loadAssistantStep(sessionId, stepIdHint)
      if (byHint != null && byHint.toolCalls.some((t) => t.callId === callId)) {
        return { stepId: stepIdHint }
      }
    }
    for (const row of this.loadSessionMessages(sessionId)) {
      if (!isAssistantStep(row.data)) continue
      if (row.data.toolCalls.some((t) => t.callId === callId)) {
        return { stepId: row.data.stepId }
      }
    }
    return null
  }
}
