import type { Message, ToolCall, TurnUsage } from '@hip/protocol'

/** Estimated share of last-turn context (provider input), from visible transcript. */
export type ContextBreakdownKey =
  | 'user'
  | 'assistant'
  | 'skills'
  | 'tools'
  | 'other'

export type ContextBreakdownSegment = {
  key: ContextBreakdownKey
  tokens: number
  /** Share of the input budget (0–100, one decimal). */
  percent: number
  /** Flex width for stacked bar (0–100). */
  width: number
}

/** ~chars/4 heuristic used by OpenCode and similar clients (not tiktoken). */
export function estimateTokensFromChars(chars: number): number {
  if (chars <= 0) return 0
  return Math.ceil(chars / 4)
}

export function isSkillToolName(name: string): boolean {
  const n = name.toLowerCase()
  return n === 'use_skill' || n === 'skill' || n.includes('skill')
}

function toolChars(tc: ToolCall): number {
  return (tc.input?.length ?? 0) + (tc.output?.length ?? 0) + (tc.error?.length ?? 0)
}

function accumulateTools(
  tools: ToolCall[] | undefined,
  into: { skills: number; tools: number },
): void {
  for (const tc of tools ?? []) {
    const n = toolChars(tc)
    if (isSkillToolName(tc.name)) into.skills += n
    else into.tools += n
  }
}

/** Char counts from messages we can see (not system prompt / memory inject). */
export function countVisibleContextChars(messages: Message[]): {
  user: number
  assistant: number
  skills: number
  tools: number
} {
  const counts = { user: 0, assistant: 0, skills: 0, tools: 0 }

  for (const m of messages) {
    if (m.role === 'user') {
      counts.user += m.content?.length ?? 0
      for (const a of m.attachments ?? []) {
        counts.user += a.name.length + 32
      }
      continue
    }
    if (m.role !== 'assistant') continue

    counts.assistant += m.content?.length ?? 0
    for (const step of m.timeline ?? []) {
      if (step.kind === 'reasoning' || step.kind === 'text') {
        counts.assistant += step.content?.length ?? 0
      }
    }
    accumulateTools(m.toolCalls, counts)
    for (const run of m.agentRuns ?? []) {
      if (run.taskInput) counts.assistant += run.taskInput.length
      if (run.output) counts.assistant += run.output.length
      accumulateTools(run.toolCalls, counts)
    }
  }

  return counts
}

function buildSegments(
  tokens: Record<ContextBreakdownKey, number>,
  budget: number,
): ContextBreakdownSegment[] {
  const order: ContextBreakdownKey[] = ['user', 'assistant', 'skills', 'tools', 'other']
  return order
    .filter((key) => tokens[key] > 0)
    .map((key) => {
      const t = tokens[key]
      const width = (t / budget) * 100
      const percent = Math.round(width * 10) / 10
      return { key, tokens: t, width, percent }
    })
}

/**
 * Estimate how last-turn **input** context is composed.
 * Aligns with OpenCode: chars/4 estimate, remainder → `other`, scale down if over budget.
 *
 * @param inputBudget Provider-reported last-turn inputTokens (preferred). Must be > 0.
 */
export function estimateContextBreakdown(
  messages: Message[],
  inputBudget: number,
): ContextBreakdownSegment[] {
  if (!inputBudget || inputBudget <= 0) return []

  const chars = countVisibleContextChars(messages)
  const tokens = {
    user: estimateTokensFromChars(chars.user),
    assistant: estimateTokensFromChars(chars.assistant),
    skills: estimateTokensFromChars(chars.skills),
    tools: estimateTokensFromChars(chars.tools),
    other: 0,
  }
  const estimated = tokens.user + tokens.assistant + tokens.skills + tokens.tools

  if (estimated <= inputBudget) {
    return buildSegments({ ...tokens, other: inputBudget - estimated }, inputBudget)
  }

  const scale = inputBudget / estimated
  const scaled = {
    user: Math.floor(tokens.user * scale),
    assistant: Math.floor(tokens.assistant * scale),
    skills: Math.floor(tokens.skills * scale),
    tools: Math.floor(tokens.tools * scale),
  }
  const total = scaled.user + scaled.assistant + scaled.skills + scaled.tools
  return buildSegments(
    { ...scaled, other: Math.max(0, inputBudget - total) },
    inputBudget,
  )
}

/** Last message with usage — for input budget + context fill. */
export function selectLastUsage(messages: Message[]): TurnUsage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const u = messages[i]?.usage
    if (u) return u
  }
  return null
}

/** Prefer inputTokens for context composition; fall back to total / in+out. */
export function inputBudgetFromUsage(u: TurnUsage | null | undefined): number | null {
  if (!u) return null
  const input = u.inputTokens ?? 0
  if (input > 0) return input
  const total = u.totalTokens ?? 0
  if (total > 0) return total
  const sum = (u.inputTokens ?? 0) + (u.outputTokens ?? 0)
  return sum > 0 ? sum : null
}
