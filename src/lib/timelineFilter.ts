import type { TimelineStep, ToolCall } from '@hip/protocol'

/**
 * Whether a timeline step should be hidden from the inline TurnTimeline.
 * The parent's own `task` tool call is represented by the delegation card
 * (delegation-row / agent section), so its generic tool row is suppressed to
 * avoid double-display. The ToolCall itself stays in Message.toolCalls (the
 * ToolMessage still reaches the model and persistence) — only the row is hidden.
 *
 * `task_batch` / `dispatch_agent` suppression when children are present is handled
 * in TurnTimeline (needs agentRuns context).
 */
export function isSuppressedToolStep(step: TimelineStep, byCallId: Map<string, ToolCall>): boolean {
  if (step.kind !== 'tool') return false
  return byCallId.get(step.callId)?.name === 'task'
}
