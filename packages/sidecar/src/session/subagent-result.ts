/**
 * When a sub-agent finishes without usable prose (empty, DSML-only, or placeholder),
 * rebuild a short result from its tool trajectory so the supervisor can continue.
 */

import { isDsmlOnlyOrEmpty } from './dsml.js'

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

export function isUselessSubagentText(text: string | null | undefined): boolean {
  if (text == null) return true
  const t = text.trim()
  if (!t) return true
  if (t === '(sub-agent produced no output)') return true
  if (t.startsWith('Error: sub-agent produced empty output')) return true
  if (isDsmlOnlyOrEmpty(t)) return true
  return false
}

export function synthesizeSubagentResult(
  text: string | null | undefined,
  tools: ToolSummary[],
  opts?: { maxTools?: number; maxChars?: number },
): string {
  if (!isUselessSubagentText(text)) return (text ?? '').trim()

  if (!tools.length) return EMPTY_ERROR

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
