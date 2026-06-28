import type { Attachment, ContentPart } from '@hip/protocol'

/**
 * Public types for the session_message projection.
 *
 * The event table is the source of truth; this projection is a denormalized
 * read model. Row ids are deterministic functions of the event payload so
 * that replaying the same event log always converges to the same state
 * (INSERT OR REPLACE absorbs duplicates).
 */

// ── session_message row shape ────────────────────────────────────────────────

export interface SessionMessageRow {
  readonly id: string
  readonly sessionId: string
  readonly type: string
  readonly seq: number
  readonly timeCreated: number
  readonly timeUpdated: number
  readonly data: SessionMessageData
}

/** JSON blob stored in session_message.data. Discriminated by role/kind for exhaustive reads. */
export type SessionMessageData =
  | { readonly role: 'user'; readonly content: string; readonly messageId: string; readonly attachments?: Attachment[]; readonly contentParts?: ContentPart[] }
  | {
    readonly role: 'assistant'
    readonly stepId: string
    readonly agentId: string
    readonly agentRole: string
    readonly content: string
    readonly toolCalls: readonly ProjectedToolCall[]
    readonly startedAt: number
    readonly finishedAt: number | null
    readonly error: string | null
    readonly usage: ProjectedUsage | null
  }
  | {
    readonly role: 'assistant'
    readonly kind: 'compaction'
    readonly summary: string
    readonly replacedMessageIds: readonly string[]
  }

/** The step variant of an assistant row (excludes the compaction summary variant). */
export type AssistantStepData = Extract<SessionMessageData, { role: 'assistant' }> & { kind?: never }

export interface ProjectedToolCall {
  readonly callId: string
  readonly name: string
  readonly input: string
  readonly status: 'running' | 'finished' | 'error'
  readonly output: string | null
  readonly error: string | null
  readonly seq: number
}

export interface ProjectedUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
}

// ── handled event types ──────────────────────────────────────────────────────

export const SESSION_EVENT_TYPES = [
  'user_message',
  'step_started',
  'step_ended',
  'step_failed',
  'text_started',
  'text_ended',
  'tool_called',
  'tool_success',
  'tool_failed',
  'compaction_ended',
  'agent_switched',
  'model_switched',
] as const

export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number]

// ── row id conventions (deterministic → replay idempotent) ───────────────────

export function stepRowId(sessionId: string, stepId: string): string {
  return `${sessionId}:step:${stepId}`
}

export function compactionRowId(sessionId: string, eventSeq: number): string {
  return `${sessionId}:compaction:${eventSeq}`
}

/** Narrow a parsed SessionMessageData into an in-progress assistant step (not a compaction). */
export function isAssistantStep(
  d: SessionMessageData,
): d is AssistantStepData {
  return d.role === 'assistant' && !('kind' in d)
}
