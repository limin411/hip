/**
 * When a sub-agent finishes without usable prose (empty, DSML-only, or placeholder),
 * rebuild a short result from its tool trajectory so the supervisor can continue.
 */

import { hasDsmlToolCalls, isDsmlOnlyOrEmpty, parseDsmlToolCalls } from './dsml.js'

export interface ToolSummary {
  name: string
  status: string
  output?: string
  error?: string
  input?: string
}

const EMPTY_ERROR =
  'Error: sub-agent produced empty output. Do not treat this as success — retry with a clearer task, or complete the work yourself.'

const RECONSTRUCTED_PREFIX =
  '[sub-agent finished without a prose summary; reconstructed from tool results]'

/**
 * First-line marker for sub-agent HITL pause (not an Error prefix).
 * SubagentOutcome is string-encoded via this marker for now (no discriminated-union return type yet).
 */
export const SUBAGENT_PAUSE_MARKER = '[hip:subagent_paused]'

/**
 * Wire format for a paused sub-agent tool result:
 *   [hip:subagent_paused] <question>
 *   <optional partial>
 */
export function formatPausedToolResult(question: string, partial?: string): string {
  const first = `${SUBAGENT_PAUSE_MARKER} ${question.trim()}`
  const body = (partial ?? '').trim()
  return body ? `${first}\n${body}` : first
}

/**
 * True when the first line encodes a sub-agent pause.
 * Accepts bare marker (primary wire format) or task_batch's `[id] ` prefix before the marker.
 * Does not scan later lines — mid-body mentions are not pauses.
 */
export function isSubagentPausedText(text: string | null | undefined): boolean {
  if (text == null) return false
  const firstLine = (text.split('\n', 1)[0] ?? '').trimStart()
  if (firstLine.startsWith(SUBAGENT_PAUSE_MARKER)) return true
  // task_batch joins as `[${id}] ${r.text}` — first line may be `[0] [hip:subagent_paused] …`
  const afterId = firstLine.match(/^\[[^\]]+\]\s+(.*)$/)
  return !!afterId && afterId[1].startsWith(SUBAGENT_PAUSE_MARKER)
}

/**
 * True when the sub-agent's final text is not a usable handoff to the parent:
 * empty, placeholder, DSML-only, or any residual DSML tool_calls block (must never leak to supervisor).
 * Pause marker results are not useless empty output (they are a distinct outcome — use isSubagentPausedText).
 */
export function isUselessSubagentText(text: string | null | undefined): boolean {
  if (text == null) return true
  // Pause is a distinct outcome, not empty/useless success.
  if (isSubagentPausedText(text)) return false
  const t = text.trim()
  if (!t) return true
  if (t === '(sub-agent produced no output)') return true
  if (t.startsWith('Error: sub-agent produced empty output')) return true
  // Any unfinished DSML tool_calls in the final answer is not a valid handoff — even with long prose.
  if (hasDsmlToolCalls(t)) return true
  if (isDsmlOnlyOrEmpty(t)) return true
  return false
}

function reconstructFromTools(
  tools: ToolSummary[],
  opts?: { maxTools?: number; maxChars?: number },
): string {
  const maxTools = opts?.maxTools ?? 12
  const maxChars = opts?.maxChars ?? 4000
  const lines: string[] = [RECONSTRUCTED_PREFIX]
  let used = lines[0].length
  let count = 0

  for (const t of tools) {
    if (count >= maxTools) break
    const body = (t.output ?? t.error ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
    const line = `- ${t.name} (${t.status}): ${body || '(no output)'}`
    if (used + line.length + 1 > maxChars) break
    lines.push(line)
    used += line.length + 1
    count++
  }

  if (tools.length > count) {
    lines.push(`…(${tools.length - count} more tool calls omitted)`)
  }

  return lines.join('\n')
}

/**
 * Produce a supervisor-safe sub-agent result.
 * - Pause marker handoffs → returned intact (never reconstruct over them)
 * - Clean prose → returned as-is
 * - Empty / DSML-only / prose+DSML → strip DSML; reconstruct from tools when available
 * - Never returns raw DSML markup
 */
export function synthesizeSubagentResult(
  text: string | null | undefined,
  tools: ToolSummary[],
  opts?: { maxTools?: number; maxChars?: number },
): string {
  // Pause is a distinct wire outcome — do not strip/reconstruct over the marker body.
  if (isSubagentPausedText(text)) return (text ?? '').trimEnd()

  const raw = (text ?? '').trim()

  // Strip any DSML tool_calls block so markup never leaks upward.
  let prose = raw
  if (raw && hasDsmlToolCalls(raw)) {
    prose = parseDsmlToolCalls(raw).content.trim()
  }

  // Usable prose and no DSML → hand off directly.
  if (prose && !isUselessSubagentText(prose) && !(raw && hasDsmlToolCalls(raw))) {
    return prose
  }

  // Had DSML (or empty/useless): prefer tool trajectory reconstruction.
  if (tools.length > 0) {
    const recon = reconstructFromTools(tools, opts)
    // Keep substantial stripped prose above the reconstruction so the parent still sees findings.
    if (prose.length >= 20 && hasDsmlToolCalls(raw)) {
      return `${prose}\n\n${recon}`
    }
    return recon
  }

  // No tools — return stripped prose if it stands alone, else error.
  if (prose.length >= 20) return prose
  if (prose && !hasDsmlToolCalls(raw) && !isDsmlOnlyOrEmpty(prose)) return prose
  return EMPTY_ERROR
}
