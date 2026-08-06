import type { Message, ToolCall, TurnUsage } from '@hip/protocol'
import { isSkillToolName as protocolIsSkillToolName } from '@hip/protocol'

/**
 * Fine-grained share of last-turn context (provider input), from visible transcript
 * (+ optional system prompt estimate).
 *
 * PR-10: added `system` (when systemPrompt/systemTokens provided). User + assistant
 * compose the Grok-aligned coarse `messages` bucket via `toCoarseContextBreakdown`.
 */
export type ContextBreakdownKey =
  | 'system'
  | 'user'
  | 'assistant'
  | 'skills'
  | 'tools'
  | 'other'

/** Grok-aligned coarse categories (system / messages / skills / tools / other). */
export type CoarseContextBreakdownKey =
  | 'system'
  | 'messages'
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

export type CoarseContextBreakdownSegment = {
  key: CoarseContextBreakdownKey
  tokens: number
  percent: number
  width: number
}

export type EstimateContextBreakdownOpts = {
  /** System / epoch prompt text — estimated via chars/4 when systemTokens omitted. */
  systemPrompt?: string
  /** Pre-computed system tokens (preferred when available from sidecar). */
  systemTokens?: number
}

/** ~chars/4 heuristic used by OpenCode and similar clients (not tiktoken). */
export function estimateTokensFromChars(chars: number): number {
  if (chars <= 0) return 0
  return Math.ceil(chars / 4)
}

/** Re-export shared helper (protocol) so UI + sidecar stay aligned (KD-17). */
export function isSkillToolName(name: string): boolean {
  return protocolIsSkillToolName(name)
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

function resolveSystemTokens(opts?: EstimateContextBreakdownOpts): number {
  if (!opts) return 0
  if (opts.systemTokens != null && opts.systemTokens > 0) {
    return Math.floor(opts.systemTokens)
  }
  if (opts.systemPrompt) {
    return estimateTokensFromChars(opts.systemPrompt.length)
  }
  return 0
}

function buildSegments(
  tokens: Record<ContextBreakdownKey, number>,
  budget: number,
): ContextBreakdownSegment[] {
  const order: ContextBreakdownKey[] = [
    'system',
    'user',
    'assistant',
    'skills',
    'tools',
    'other',
  ]
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
 * @param opts Optional system prompt estimate so `system` is not folded into `other`.
 */
export function estimateContextBreakdown(
  messages: Message[],
  inputBudget: number,
  opts?: EstimateContextBreakdownOpts,
): ContextBreakdownSegment[] {
  if (!inputBudget || inputBudget <= 0) return []

  const chars = countVisibleContextChars(messages)
  const tokens = {
    system: resolveSystemTokens(opts),
    user: estimateTokensFromChars(chars.user),
    assistant: estimateTokensFromChars(chars.assistant),
    skills: estimateTokensFromChars(chars.skills),
    tools: estimateTokensFromChars(chars.tools),
    other: 0,
  }
  const estimated =
    tokens.system + tokens.user + tokens.assistant + tokens.skills + tokens.tools

  if (estimated <= inputBudget) {
    return buildSegments({ ...tokens, other: inputBudget - estimated }, inputBudget)
  }

  const scale = inputBudget / estimated
  const scaled = {
    system: Math.floor(tokens.system * scale),
    user: Math.floor(tokens.user * scale),
    assistant: Math.floor(tokens.assistant * scale),
    skills: Math.floor(tokens.skills * scale),
    tools: Math.floor(tokens.tools * scale),
  }
  const total =
    scaled.system + scaled.user + scaled.assistant + scaled.skills + scaled.tools
  return buildSegments(
    { ...scaled, other: Math.max(0, inputBudget - total) },
    inputBudget,
  )
}

/**
 * Collapse fine segments toward Grok-aligned categories:
 * system / messages (user+assistant) / skills / tools / other.
 */
export function toCoarseContextBreakdown(
  segments: ReadonlyArray<ContextBreakdownSegment>,
): CoarseContextBreakdownSegment[] {
  if (segments.length === 0) return []
  const budget = segments.reduce((a, s) => a + s.tokens, 0)
  if (budget <= 0) return []

  const buckets: Record<CoarseContextBreakdownKey, number> = {
    system: 0,
    messages: 0,
    skills: 0,
    tools: 0,
    other: 0,
  }
  for (const s of segments) {
    if (s.key === 'user' || s.key === 'assistant') buckets.messages += s.tokens
    else if (s.key === 'system') buckets.system += s.tokens
    else if (s.key === 'skills') buckets.skills += s.tokens
    else if (s.key === 'tools') buckets.tools += s.tokens
    else buckets.other += s.tokens
  }

  const order: CoarseContextBreakdownKey[] = [
    'system',
    'messages',
    'skills',
    'tools',
    'other',
  ]
  return order
    .filter((key) => buckets[key] > 0)
    .map((key) => {
      const t = buckets[key]
      const width = (t / budget) * 100
      const percent = Math.round(width * 10) / 10
      return { key, tokens: t, width, percent }
    })
}

/** Last message with usage — for input budget + context fill. */
export function selectLastUsage(messages: Message[]): TurnUsage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const u = messages[i]?.usage
    if (u) return u
  }
  return null
}

/** Visible transcript ≈ chars/4 (system prompt / tool schemas not included). */
export function estimateVisibleContextTokens(messages: Message[]): number {
  const chars = countVisibleContextChars(messages)
  return estimateTokensFromChars(chars.user + chars.assistant + chars.skills + chars.tools)
}

/**
 * Provider-reported single-request context size for fill %.
 * Never uses billing `totalTokens` alone — multi-step sums and MiniMax-style
 * output-only stream usage both misrepresent context occupancy.
 */
export function reportedContextTokens(u: TurnUsage | null | undefined): number {
  if (!u) return 0
  if (u.contextTokens != null && u.contextTokens > 0) return u.contextTokens
  if ((u.inputTokens ?? 0) > 0) return u.inputTokens
  return 0
}

/**
 * Context-fill numerator for the session meter.
 * - Honest provider input/contextTokens → trust it (includes system/tools).
 * - input_tokens=0 (MiniMax stream usage, etc.) → chars/4 over visible transcript.
 * Returns null when neither source has tokens.
 */
export function contextFillTokens(
  messages: Message[],
  usage: TurnUsage | null | undefined = selectLastUsage(messages),
): number | null {
  const reported = reportedContextTokens(usage)
  const estimated = estimateVisibleContextTokens(messages)
  // Real prompt tokens from the provider beat a visible-only estimate.
  if (reported > 0 && (usage?.inputTokens ?? 0) > 0) return reported
  if (estimated > 0) return estimated
  if (reported > 0) return reported
  return null
}

/**
 * Prefer single-request context size for composition budget.
 * Falls back to visible estimate when provider omits input tokens.
 */
export function inputBudgetFromUsage(
  u: TurnUsage | null | undefined,
  messages?: Message[],
): number | null {
  const reported = reportedContextTokens(u)
  if (reported > 0) return reported
  if (messages) {
    const estimated = estimateVisibleContextTokens(messages)
    if (estimated > 0) return estimated
  }
  return null
}
