/** Durable session events (sidecar-internal event sourcing). */
import type { Attachment, ContentPart } from './message-model.js'

export type SessionEvent =
  | { type: 'user_message'; sessionId: string; content: string; messageId: string; timestamp: number; attachments?: Attachment[]; contentParts?: ContentPart[] }
  | { type: 'step_started'; sessionId: string; turnId: string; agentId: string; timestamp: number }
  | { type: 'step_ended'; sessionId: string; turnId: string; agentId: string; timestamp: number }
  | { type: 'step_failed'; sessionId: string; turnId: string; agentId: string; error: string; timestamp: number }
  | { type: 'text_started'; sessionId: string; messageId: string; timestamp: number }
  | { type: 'text_ended'; sessionId: string; messageId: string; content: string; timestamp: number }
  | { type: 'tool_called'; sessionId: string; callId: string; name: string; input: string; timestamp: number }
  | { type: 'tool_success'; sessionId: string; callId: string; output: string; timestamp: number }
  | { type: 'tool_failed'; sessionId: string; callId: string; error: string; timestamp: number }
  | { type: 'compaction_ended'; sessionId: string; summary: string; timestamp: number }
