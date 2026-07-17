import { SystemMessage, HumanMessage, AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'

/** Compact when the estimated prompt exceeds this (supervisor / default). */
export const COMPACT_BUDGET_TOKENS = 48_000

/** Tighter budget for task / dispatch / explore child graphs (best practice: subagents bloat faster). */
export const SUBAGENT_COMPACT_BUDGET_TOKENS = 32_000

/** Turns kept verbatim at the tail (user-turn mode). A turn = a user message and everything up to the next one. */
export const KEEP_RECENT_TURNS = 3

/** Tool-rounds kept verbatim at the tail when compacting single-Human ReAct loops. */
export const KEEP_RECENT_TOOL_ROUNDS = 6

/** Min steps between LLM summary compactions (prune may run every step). */
export const MIN_STEPS_BETWEEN_LLM_COMPACT = 4

/** Token budget for the summarizer model output. */
export const SUMMARY_OUTPUT_TOKENS = 4096

/** Industry-standard heuristic for context-budget checks (Codex/OpenCode both use ≈4 chars/byte per token). */
const CHARS_PER_TOKEN = 4

/** Summarizes a span of messages into a short note. Injected so compaction is unit-testable. */
export interface Summarizer {
  summarize(messages: BaseMessage[], opts?: { focus?: string; sessionId?: string }): Promise<string>
}

/** Options for compactMessages. */
export interface CompactOptions {
  /** Turns kept verbatim at the tail (see KEEP_RECENT_TURNS). User-turn mode. */
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
   */
  keepRecentToolRounds?: number
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
    text.includes('token limit')
  )
}

function textOf(m: BaseMessage): string {
  if (typeof m.content === 'string') return m.content
  if (Array.isArray(m.content)) return m.content.map((b) => (typeof b === 'string' ? b : ((b as { text?: string }).text ?? ''))).join('')
  return ''
}

/** Synchronous chars/4 estimate. This is the only token estimate used for context-window checks. */
export function estimateTokens(messages: readonly BaseMessage[]): number {
  let chars = 0
  for (const m of messages) chars += textOf(m).length
  return Math.ceil(chars / CHARS_PER_TOKEN)
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

async function summarizeMiddle(
  middle: BaseMessage[],
  opts: CompactOptions,
  mode: 'user-turn' | 'tool-round',
): Promise<CompactResult | null> {
  if (middle.length === 0) return null
  const headId = middle[0].id
  if (!headId) return null
  const text = await opts.summarizer.summarize(middle, {
    ...(opts.focus ? { focus: opts.focus } : {}),
    ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
  })
  const removeIds = middle.slice(1).map((m) => m.id).filter((id): id is string => !!id)
  return {
    summary: new SystemMessage({ id: headId, content: `[对话摘要] ${text}` }),
    removeIds,
    replacedIds: [headId, ...removeIds],
    mode,
  }
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

  const keepRounds = opts.overflowRecovery
    ? Math.max(2, Math.floor((opts.keepRecentToolRounds ?? KEEP_RECENT_TOOL_ROUNDS) / 2))
    : (opts.keepRecentToolRounds ?? KEEP_RECENT_TOOL_ROUNDS)

  const afterHuman = firstHumanIdx + 1
  if (afterHuman >= messages.length) return null

  const rounds = splitToolRounds(messages, afterHuman)
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
  const keepRecentTurns = opts.overflowRecovery
    ? Math.max(1, Math.floor(opts.keepRecentTurns / 2))
    : opts.keepRecentTurns

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
