import { SystemMessage, HumanMessage, AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import {
  AUTO_COMPACT_THRESHOLD_PERCENT,
  CHARS_PER_TOKEN,
  DEFAULT_COMPACT_TRIGGER_TOKENS,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_SUBAGENT_COMPACT_TRIGGER_TOKENS,
  MIN_SUMMARY_SEED_CHARS,
  compactTriggerTokens,
  estimateMessagesTokens,
  estimatePromptTokens,
  estimateTextTokens,
  extractiveSummaryFallback,
  isDegenerateSummary,
  remainingBudgetPercent,
  selectKeepUnitsByTokenBudget,
  type PromptEstimateInput,
} from './context-budget.js'

/** @deprecated Prefer `compactTriggerTokens(contextWindow)`. Absolute default for 128k × 85%. */
export const COMPACT_BUDGET_TOKENS = DEFAULT_COMPACT_TRIGGER_TOKENS

/** @deprecated Prefer `compactTriggerTokens(window, SUBAGENT_COMPACT_THRESHOLD_PERCENT)`. */
export const SUBAGENT_COMPACT_BUDGET_TOKENS = DEFAULT_SUBAGENT_COMPACT_TRIGGER_TOKENS

export {
  AUTO_COMPACT_THRESHOLD_PERCENT,
  DEFAULT_CONTEXT_WINDOW,
  compactTriggerTokens,
  estimatePromptTokens,
  estimateTextTokens,
  remainingBudgetPercent,
  selectKeepUnitsByTokenBudget,
  type PromptEstimateInput,
}

/** Turns kept verbatim at the tail (user-turn mode). A turn = a user message and everything up to the next one. */
export const KEEP_RECENT_TURNS = 3

/** Tool-rounds kept verbatim at the tail when compacting single-Human ReAct loops. */
export const KEEP_RECENT_TOOL_ROUNDS = 6

/** Min steps between LLM summary compactions (prune may run every step). */
export const MIN_STEPS_BETWEEN_LLM_COMPACT = 4

/** Token budget for the summarizer model output. */
export const SUMMARY_OUTPUT_TOKENS = 4096

/** Structured summary carrier prefix (stable for post-compact re-assembly). */
export const COMPACT_SUMMARY_PREFIX = '[对话摘要]'

/** Summarizes a span of messages into a short note. Injected so compaction is unit-testable. */
export interface Summarizer {
  summarize(messages: BaseMessage[], opts?: { focus?: string; sessionId?: string }): Promise<string>
}

/** Options for compactMessages. */
export interface CompactOptions {
  /**
   * Fallback turn count when `targetKeepTokens` is not set.
   * Still used as a soft max when token budget would keep *everything*.
   */
  keepRecentTurns: number
  /** Summarizer that produces the summary text from the middle span. */
  summarizer: Summarizer
  /** When true, keep fewer recent turns so the summary covers more history — used after a
   *  provider context-overflow error to aggressively shrink the prompt. */
  overflowRecovery?: boolean
  /** Optional focus instruction for the summarizer (manual `/compact focus…`). */
  focus?: string
  /** Session id for LangSmith thread attachment on the summarizer LLM call. */
  sessionId?: string
  /**
   * Tool-rounds kept at the tail when falling back to tool-round mode
   * (single-Human ReAct / explore). Defaults to KEEP_RECENT_TOOL_ROUNDS.
   * Soft max when `targetKeepTokens` is set.
   */
  keepRecentToolRounds?: number
  /**
   * Token budget for the verbatim keep-tail (TARGET_THRESHOLD_PERCENT of the
   * context window, minus system/tools overhead). When set, turn/round keep
   * counts are chosen so the tail fits this budget (grok-build style).
   */
  targetKeepTokens?: number
}

/** Detect provider context-length / maximum-token errors so the graph can compact and retry. */
export function isOverflowError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const text = `${err.message} ${(err as { code?: string; status?: number; statusCode?: number }).code ?? ''} ${(err as { response?: { status?: number } }).response?.status ?? ''}`.toLowerCase()
  return (
    text.includes('context length') ||
    text.includes('context_length_exceeded') ||
    text.includes('maximum context length') ||
    text.includes('string above max length') ||
    text.includes('too many tokens') ||
    text.includes('input length') ||
    text.includes('token limit') ||
    text.includes('prompt is too long') ||
    text.includes('model_context_window_exceeded')
  )
}

function textOf(m: BaseMessage): string {
  if (typeof m.content === 'string') return m.content
  if (Array.isArray(m.content)) return m.content.map((b) => (typeof b === 'string' ? b : ((b as { text?: string }).text ?? ''))).join('')
  return ''
}

/** Synchronous chars/4 estimate over message bodies only. Prefer `estimatePromptTokens` for gates. */
export function estimateTokens(messages: readonly BaseMessage[]): number {
  return estimateMessagesTokens(messages)
}

export interface CompactResult {
  /** SystemMessage carrying the summary, id = the middle head's id (replace-in-place keeps order). */
  summary: BaseMessage
  /** ids of the rest of the middle to delete (not including the head). */
  removeIds: string[]
  /** All middle message ids replaced (head + removeIds) — for persistence / rebuild. */
  replacedIds: string[]
  /** Which split strategy produced this plan. */
  mode?: 'user-turn' | 'tool-round'
}

/** Apply a compact plan to an in-memory message list.
 *  Replaces the middle head with `summary` (same id) and drops `removeIds`. Order preserved. */
export function applyCompactResult(messages: readonly BaseMessage[], result: CompactResult): BaseMessage[] {
  const removeSet = new Set(result.removeIds)
  const headId = result.summary.id
  return messages.flatMap((m) => {
    if (m.id && removeSet.has(m.id)) return []
    if (headId && m.id === headId) return [result.summary]
    return [m]
  })
}

/**
 * Split messages after `fromIdx` into tool-rounds.
 * A tool-round starts at an AIMessage with tool_calls and includes following ToolMessages
 * until the next AIMessage (or non-tool message that starts a new segment).
 * Plain AI text without tools is a single-message "round".
 */
export function splitToolRounds(messages: BaseMessage[], fromIdx: number): BaseMessage[][] {
  const rounds: BaseMessage[][] = []
  let i = fromIdx
  while (i < messages.length) {
    const m = messages[i]
    if (m instanceof AIMessage && m.tool_calls && m.tool_calls.length > 0) {
      const round: BaseMessage[] = [m]
      i++
      while (i < messages.length && messages[i] instanceof ToolMessage) {
        round.push(messages[i])
        i++
      }
      rounds.push(round)
      continue
    }
    // Non-tool AI or other — single-message round (skip pure system mid-stream rarely)
    rounds.push([m])
    i++
  }
  return rounds
}

/** Build the stable summary carrier SystemMessage. */
export function formatCompactSummaryMessage(headId: string, body: string): SystemMessage {
  const text = body.trim().startsWith(COMPACT_SUMMARY_PREFIX)
    ? body.trim()
    : `${COMPACT_SUMMARY_PREFIX} ${body.trim()}`
  return new SystemMessage({ id: headId, content: text })
}

/**
 * Run summarizer with quality gate: retry once on degenerate output, then extractive fallback.
 */
export async function summarizeWithQualityGate(
  middle: BaseMessage[],
  opts: Pick<CompactOptions, 'summarizer' | 'focus' | 'sessionId'>,
): Promise<string> {
  const run = (focus?: string) =>
    opts.summarizer.summarize(middle, {
      ...(focus ? { focus } : opts.focus ? { focus: opts.focus } : {}),
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
    })

  let text = ''
  try {
    text = await run(opts.focus)
  } catch {
    text = ''
  }

  if (!isDegenerateSummary(text, MIN_SUMMARY_SEED_CHARS)) return text.trim()

  try {
    const retryFocus = [opts.focus?.trim(), 'Provide a detailed structured summary with all critical paths, errors, and decisions.']
      .filter(Boolean)
      .join('\n')
    text = await run(retryFocus)
  } catch {
    text = ''
  }

  if (!isDegenerateSummary(text, MIN_SUMMARY_SEED_CHARS)) return text.trim()

  return extractiveSummaryFallback(middle)
}

async function summarizeMiddle(
  middle: BaseMessage[],
  opts: CompactOptions,
  mode: 'user-turn' | 'tool-round',
): Promise<CompactResult | null> {
  if (middle.length === 0) return null
  const headId = middle[0].id
  if (!headId) return null
  const text = await summarizeWithQualityGate(middle, opts)
  const removeIds = middle.slice(1).map((m) => m.id).filter((id): id is string => !!id)
  return {
    summary: formatCompactSummaryMessage(headId, text),
    removeIds,
    replacedIds: [headId, ...removeIds],
    mode,
  }
}

/** Token estimate for each human-turn span (oldest → newest). */
export function humanTurnTokenCounts(messages: BaseMessage[], humanIdxs: number[]): number[] {
  return humanIdxs.map((start, i) => {
    const end = i + 1 < humanIdxs.length ? humanIdxs[i + 1] : messages.length
    return estimateMessagesTokens(messages.slice(start, end))
  })
}

/** Resolve how many recent human-turns to keep. */
export function resolveKeepRecentTurns(
  messages: BaseMessage[],
  humanIdxs: number[],
  opts: CompactOptions,
): number {
  const fallback = opts.overflowRecovery
    ? Math.max(1, Math.floor(opts.keepRecentTurns / 2))
    : opts.keepRecentTurns
  if (humanIdxs.length === 0) return 0
  // Classic fixed keep (no token budget): preserve prior semantics, including
  // "keep == human count ⇒ no user-turn compact" (caller checks length > keep).
  if (opts.targetKeepTokens == null || opts.targetKeepTokens <= 0) {
    return fallback
  }
  // Leave the first human out of the "recent" budget so middle can be non-empty.
  const maxKeep = Math.max(1, humanIdxs.length - 1)
  const counts = humanTurnTokenCounts(messages, humanIdxs)
  // Do not spend budget on the first human (always pinned separately).
  const recentCounts = counts.length > 1 ? counts.slice(1) : counts
  if (recentCounts.length === 0) return fallback
  const softMax = Math.min(Math.max(fallback, fallback * 2), maxKeep, recentCounts.length)
  const keep = selectKeepUnitsByTokenBudget(recentCounts, opts.targetKeepTokens, {
    minKeep: 1,
    maxKeep: softMax,
  })
  // Prefer at least the classic fallback when the budget easily fits it.
  if (keep < fallback && recentCounts.length >= fallback) {
    const fallbackTokens = recentCounts
      .slice(recentCounts.length - fallback)
      .reduce((a, b) => a + b, 0)
    if (fallbackTokens <= opts.targetKeepTokens) return Math.min(fallback, maxKeep)
  }
  return Math.max(1, Math.min(keep, maxKeep, recentCounts.length))
}

/** Resolve how many recent tool-rounds to keep. */
export function resolveKeepRecentToolRounds(
  rounds: BaseMessage[][],
  opts: CompactOptions,
): number {
  const fallback = opts.overflowRecovery
    ? Math.max(2, Math.floor((opts.keepRecentToolRounds ?? KEEP_RECENT_TOOL_ROUNDS) / 2))
    : (opts.keepRecentToolRounds ?? KEEP_RECENT_TOOL_ROUNDS)
  if (rounds.length === 0) return 0
  // Classic fixed keep when no token budget.
  if (opts.targetKeepTokens == null || opts.targetKeepTokens <= 0) {
    return fallback
  }
  const maxKeep = Math.max(1, rounds.length - 1)
  const counts = rounds.map((r) => estimateMessagesTokens(r))
  const softMax = Math.min(Math.max(fallback, fallback * 2), maxKeep)
  const keep = selectKeepUnitsByTokenBudget(counts, opts.targetKeepTokens, {
    minKeep: opts.overflowRecovery ? 1 : Math.min(fallback, 2),
    maxKeep: softMax,
  })
  if (keep < fallback && counts.length >= fallback) {
    const fallbackTokens = counts.slice(counts.length - fallback).reduce((a, b) => a + b, 0)
    if (fallbackTokens <= opts.targetKeepTokens) return Math.min(fallback, maxKeep)
  }
  return Math.max(1, Math.min(keep, maxKeep))
}

/**
 * Tool-round compaction for single-Human ReAct loops (explore / task / dispatch).
 * Pins system + first human; summarizes middle tool-rounds; keeps recent rounds intact.
 */
export async function compactToolRounds(
  messages: BaseMessage[],
  opts: CompactOptions,
): Promise<CompactResult | null> {
  const firstHumanIdx = messages.findIndex((m) => m instanceof HumanMessage)
  if (firstHumanIdx === -1) return null

  const afterHuman = firstHumanIdx + 1
  if (afterHuman >= messages.length) return null

  const rounds = splitToolRounds(messages, afterHuman)
  const keepRounds = resolveKeepRecentToolRounds(rounds, opts)
  if (rounds.length <= keepRounds) return null

  const middleRounds = rounds.slice(0, rounds.length - keepRounds)
  const middle = middleRounds.flat()
  if (middle.length === 0) return null

  return summarizeMiddle(middle, opts, 'tool-round')
}

/**
 * Plan a compaction:
 * 1. Prefer user-turn boundaries when there are enough HumanMessages (multi-turn chat).
 * 2. Else fall back to tool-round boundaries so explore/subagent loops can shrink.
 *
 * Keep-tail size uses `targetKeepTokens` when provided (≈50% of context window);
 * otherwise falls back to KEEP_RECENT_TURNS / KEEP_RECENT_TOOL_ROUNDS.
 *
 * Never splits an AIMessage from its ToolMessages in tool-round mode.
 * `messages` must have ids (LangGraph assigns them in state).
 */
export async function compactMessages(
  messages: BaseMessage[],
  opts: CompactOptions,
): Promise<CompactResult | null> {
  const firstHumanIdx = messages.findIndex((m) => m instanceof HumanMessage)
  if (firstHumanIdx === -1) return null

  const humanIdxs: number[] = []
  messages.forEach((m, i) => { if (m instanceof HumanMessage) humanIdxs.push(i) })
  const keepRecentTurns = resolveKeepRecentTurns(messages, humanIdxs, opts)

  // User-turn path when enough human turns for a non-empty middle.
  if (humanIdxs.length > keepRecentTurns) {
    const recentStart = humanIdxs[humanIdxs.length - keepRecentTurns]
    const middle = messages.slice(firstHumanIdx + 1, recentStart)
    if (middle.length > 0) {
      const result = await summarizeMiddle(middle, opts, 'user-turn')
      if (result) return result
    }
  }

  // Tool-round fallback: single-Human (or too few humans) ReAct / explore.
  return compactToolRounds(messages, opts)
}

// Re-export for callers that previously imported CHARS_PER_TOKEN indirectly.
export { CHARS_PER_TOKEN }
