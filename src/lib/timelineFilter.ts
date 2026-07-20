import type { TimelineStep, ToolCall } from '@hip/protocol'
import { sanitizeDisplayText } from '@/lib/sanitizeDisplayText'
import { normalizeMessageContent } from '@/lib/normalizeMessageContent'

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
  // text / reasoning steps are never "tool" rows — only suppress parent `task` tool shells
  if (step.kind !== 'tool') return false
  return byCallId.get(step.callId)?.name === 'task'
}

/**
 * Supervisor-surface text (KD-17 / contentFromTimeline): only these text steps
 * contribute to Message.content and interleaved TurnBlocks.
 * Matches sidecar `contentFromTimeline` and sessionStore upsert guard.
 */
export function isSupervisorTextStep(
  step: TimelineStep,
): step is Extract<TimelineStep, { kind: 'text' }> {
  return step.kind === 'text' && (step.agentId === 'supervisor' || step.role === 'supervisor')
}

/** Sanitize + normalize text-step body for display (parity with answer MarkdownBody). */
export function prepareTimelineTextContent(raw: string): string {
  return normalizeMessageContent(sanitizeDisplayText(raw))
}

/** True when at least one supervisor text step has non-empty display content. */
export function hasRenderableSupervisorText(steps: TimelineStep[] | undefined): boolean {
  for (const s of steps ?? []) {
    if (!isSupervisorTextStep(s)) continue
    if (prepareTimelineTextContent(s.content).trim().length > 0) return true
  }
  return false
}
