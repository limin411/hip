import type { Message } from '@hip/protocol'

/** Default Phase1 transcript character cap (design phase1_input_max_chars). */
export const PHASE1_INPUT_MAX_CHARS = 80_000

/**
 * Whether an assistant message should appear in Phase1 input (design B.7).
 * Include when agentId is null/undefined/'supervisor', OR every agent_run has
 * parentAgentId == null. Exclude content attributable only to child runs.
 */
export function shouldIncludeAssistantInPhase1(msg: Message): boolean {
  if (msg.role !== 'assistant') return false
  if (msg.agentId == null || msg.agentId === 'supervisor') return true
  const runs = msg.agentRuns
  if (runs && runs.length > 0) {
    return runs.every((r) => r.parentAgentId == null)
  }
  // Non-supervisor agent without runs → treat as child / non-final; exclude.
  return false
}

/**
 * Build Phase1 transcript from protocol messages (prefer loadMessagesWithRuns).
 * Rules (design B.7):
 * 1) Always include role=user
 * 2) Assistant only when supervisor/null parent (see shouldIncludeAssistantInPhase1)
 * 3) No tool_calls.output as first-class paragraphs (message.content only)
 * 4) Cap total chars — drop oldest first; keep latest content
 */
export function buildPhase1Transcript(
  messages: Message[],
  maxChars: number = PHASE1_INPUT_MAX_CHARS,
): string {
  const lines: string[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      const text = (m.content ?? '').trim()
      if (text) lines.push(`User: ${text}`)
      continue
    }
    if (m.role === 'assistant' && shouldIncludeAssistantInPhase1(m)) {
      const text = (m.content ?? '').trim()
      if (text) lines.push(`Assistant: ${text}`)
    }
  }

  if (lines.length === 0) return ''

  let joined = lines.join('\n\n')
  if (joined.length <= maxChars) return joined

  // Drop oldest lines until under cap (keep the latest turn(s)).
  const kept = [...lines]
  while (kept.length > 1) {
    kept.shift()
    joined = kept.join('\n\n')
    if (joined.length <= maxChars) return joined
  }

  // Single remaining line still too long — keep the tail (latest content).
  joined = kept[0] ?? ''
  if (joined.length > maxChars) return joined.slice(-maxChars)
  return joined
}

/** Count user turns and total user character length. */
export function countUserContent(messages: Message[]): { turns: number; chars: number } {
  let turns = 0
  let chars = 0
  for (const m of messages) {
    if (m.role !== 'user') continue
    turns += 1
    chars += (m.content ?? '').length
  }
  return { turns, chars }
}

/**
 * Design gate: enough content when userTurnCount >= minTurns OR userCharCount >= minChars.
 * Accepts messages, or a prebuilt transcript string (chars only; turns inferred as 0 unless messages given).
 */
export function transcriptMeetsMinContent(
  textOrMessages: string | Message[],
  minTurns: number,
  minChars: number,
): boolean {
  if (typeof textOrMessages === 'string') {
    const chars = textOrMessages.length
    // String-only: cannot count user turns reliably — OR with chars only.
    return chars >= minChars
  }
  const { turns, chars } = countUserContent(textOrMessages)
  return turns >= minTurns || chars >= minChars
}
