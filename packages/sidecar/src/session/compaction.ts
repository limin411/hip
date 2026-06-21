import { SystemMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import { getActiveModel } from '../config/providers.js'
import { TokenCounter } from './token-counter.js'

/** Compact when the estimated prompt exceeds this. Conservative: the sidecar cannot read the active
 *  model's real context window (config/providers.ts carries none), so assume a ~64k floor and keep
 *  ~16k headroom for the reply. `buildGraph` can override it (tests pass a tiny value). */
export const COMPACT_BUDGET_TOKENS = 48_000

/** Turns kept verbatim at the tail. A turn = a user message and everything up to the next one. */
export const KEEP_RECENT_TURNS = 3

/** Token budget for the summarizer model output. Kept generous so the 8-section structured
 *  summary has room for full context preservation. */
export const SUMMARY_OUTPUT_TOKENS = 4096

/** No tokenizer in-stack → char heuristic. /3 over-estimates English (≈4 ch/tok) but fits dense
 *  CJK/code, so it triggers a little early rather than too late. Kept as a synchronous fallback
 *  for tests and for paths where loading a tokenizer is undesirable. */
const CHARS_PER_TOKEN = 3

/** Summarizes a span of messages into a short note. Injected so compaction is unit-testable. */
export interface Summarizer {
  summarize(messages: BaseMessage[]): Promise<string>
}

/** Options for compactMessages. */
export interface CompactOptions {
  /** Turns kept verbatim at the tail (see KEEP_RECENT_TURNS). */
  keepRecentTurns: number
  /** Summarizer that produces the summary text from the middle span. */
  summarizer: Summarizer
  /** When true, keep fewer recent turns so the summary covers more history — used after a
   *  provider context-overflow error to aggressively shrink the prompt. */
  overflowRecovery?: boolean
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

/** Synchronous chars/3 estimate. Retained as the backward-compatible fallback; the existing test
 *  `expect(estimateTokens([new HumanMessage('123456')])).toBe(2)` pins this exact behavior. */
export function estimateTokens(messages: readonly BaseMessage[]): number {
  let chars = 0
  for (const m of messages) chars += textOf(m).length
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

/** Process-wide singleton. Provider-aware: OpenAI → gpt-tokenizer BPE, DeepSeek → HF transformers
 *  with lazy tokenizer download, others → chars/4 + per-message overhead. */
export const tokenCounter = new TokenCounter(() => getActiveModel())

/** Provider-aware token estimate (async). Falls back to the chars/3 sync estimate above if the
 *  underlying counter throws. Callers on the hot path may use estimateTokens() instead. */
export async function estimateTokensAsync(messages: readonly BaseMessage[]): Promise<number> {
  try {
    return await tokenCounter.countMessages(messages)
  } catch {
    return estimateTokens(messages)
  }
}

export interface CompactResult {
  /** SystemMessage carrying the summary, id = the middle head's id (replace-in-place keeps order). */
  summary: BaseMessage
  /** ids of the rest of the middle to delete via RemoveMessage. */
  removeIds: string[]
}

/** Plan a compaction: pin system + first user message (the goal) + the recent K turns; summarize the
 *  span between. Cuts only at user-message (turn) boundaries, so an assistant↔tool pair is never
 *  split (no orphan tool messages). Returns null when there is no middle worth compacting. `messages`
 *  must have ids (LangGraph assigns them in state). */
export async function compactMessages(
  messages: BaseMessage[],
  opts: CompactOptions,
): Promise<CompactResult | null> {
  const firstHumanIdx = messages.findIndex((m) => m instanceof HumanMessage)
  if (firstHumanIdx === -1) return null
  const humanIdxs: number[] = []
  messages.forEach((m, i) => { if (m instanceof HumanMessage) humanIdxs.push(i) })
  const keepRecentTurns = opts.overflowRecovery ? Math.max(1, Math.floor(opts.keepRecentTurns / 2)) : opts.keepRecentTurns
  if (humanIdxs.length <= keepRecentTurns) return null
  const recentStart = humanIdxs[humanIdxs.length - keepRecentTurns]
  const middle = messages.slice(firstHumanIdx + 1, recentStart)
  if (middle.length === 0) return null
  const headId = middle[0].id
  if (!headId) return null
  const text = await opts.summarizer.summarize(middle)
  return {
    summary: new SystemMessage({ id: headId, content: `[对话摘要] ${text}` }),
    removeIds: middle.slice(1).map((m) => m.id).filter((id): id is string => !!id),
  }
}
