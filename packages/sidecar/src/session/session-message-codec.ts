/** Message row ↔ LangChain BaseMessage conversion and session event payload mapping. */
import type { AgentRun, Attachment, ContentPart, SessionEvent, TimelineStep, TurnUsage } from '@hip/protocol'
import { HumanMessage, AIMessage, ToolMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { SessionMessageData, ProjectedToolCall } from '../persistence/message-types.js'
import { isContentPart } from '../persistence/message-updater.js'
import { isImageAttachment, parseToolInput, logNonCritical } from './session-helpers.js'

export function isRichContentParts(parts: ContentPart[] | undefined): boolean {
  return !!parts && parts.length > 0 && !(parts.length === 1 && parts[0].type === 'text')
}

export function rowToBaseMessage(d: SessionMessageData): BaseMessage[] {
  if (d.role === 'user') {
    const validParts = d.contentParts?.filter((p): p is ContentPart => isContentPart(p as Record<string, unknown>))
    if (isRichContentParts(validParts)) {
      return [new HumanMessage({ id: d.messageId, content: validParts })]
    }
    return [new HumanMessage({ id: d.messageId, content: d.content })]
  }
  if (d.role === 'assistant' && 'kind' in d) {
    return [new SystemMessage({ content: d.summary })]
  }
  const toolCalls = d.toolCalls.length > 0 ? d.toolCalls.map(projectedToolCallToToolCall) : undefined
  const messages: BaseMessage[] = [
    new AIMessage({
      id: d.stepId,
      content: d.content,
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
    }),
  ]
  if (toolCalls) {
    for (const tc of d.toolCalls) {
      const content = tc.status === 'error' ? `Error: ${tc.error ?? 'tool failed'}` : (tc.output ?? '')
      messages.push(new ToolMessage({ content, tool_call_id: tc.callId, name: tc.name, id: tc.callId }))
    }
  }
  return messages
}

/** Stable ids associated with a projection row (for compaction filter on rebuild). */
export function projectionRowIds(d: SessionMessageData): string[] {
  if (d.role === 'user') return [d.messageId]
  if (d.role === 'assistant' && 'kind' in d) return []
  const ids = [d.stepId]
  for (const tc of d.toolCalls) {
    if (tc.callId) ids.push(tc.callId)
  }
  return ids
}

export function projectedToolCallToToolCall(t: ProjectedToolCall) {
  return { name: t.name, args: parseToolInput(t.input), id: t.callId, type: 'tool_call' as const }
}

/** Map a protocol SessionEvent into the internal event payload that the
 *  message projector expects. */
export function sessionEventToEventData(
  event: SessionEvent,
  context?: {
    stepId?: string
    usage?: TurnUsage
    runs?: AgentRun[]
    assistant?: {
      id: string
      sessionId: string
      agentId: string
      content: string
      timestamp: number
      stopped?: boolean
      timeline?: TimelineStep[]
    } | null
  },
): Record<string, unknown> {
  switch (event.type) {
    case 'user_message':
      return { messageId: event.messageId, content: event.content, timestamp: event.timestamp, ...(event.attachments?.length ? { attachments: event.attachments } : {}), ...(event.contentParts?.length ? { contentParts: event.contentParts } : {}) }
    case 'step_started':
      return { stepId: event.turnId, agentId: event.agentId, startedAt: event.timestamp }
    case 'step_ended':
      return { stepId: event.turnId, agentId: event.agentId, finishedAt: event.timestamp, ...(context?.usage ? { usage: context.usage } : {}) }
    case 'step_failed':
      return { stepId: event.turnId, agentId: event.agentId, error: event.error, finishedAt: event.timestamp }
    case 'text_started':
      return { stepId: event.messageId }
    case 'text_ended':
      return { stepId: event.messageId, content: event.content }
    case 'tool_called':
      return { callId: event.callId, stepId: context?.stepId, name: event.name, input: event.input, seq: event.timestamp }
    case 'tool_success':
      return { callId: event.callId, stepId: context?.stepId, output: event.output }
    case 'tool_failed':
      return { callId: event.callId, stepId: context?.stepId, error: event.error }
    case 'compaction_ended':
      return {
        summary: event.summary,
        timestamp: event.timestamp,
        ...(event.replacedMessageIds?.length ? { replacedMessageIds: event.replacedMessageIds } : {}),
      }
  }
}
