import { SystemMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'

/** Compact when the estimated prompt exceeds this. Conservative: the sidecar cannot read the active
 *  model's real context window (config/providers.ts carries none), so assume a ~64k floor and keep
 *  ~16k headroom for the reply. `buildGraph` can override it (tests pass a tiny value). */
export const COMPACT_BUDGET_TOKENS = 48_000

/** Turns kept verbatim at the tail. A turn = a user message and everything up to the next one. */
export const KEEP_RECENT_TURNS = 3

/** No tokenizer in-stack → char heuristic. /3 over-estimates English (≈4 ch/tok) but fits dense
 *  CJK/code, so it triggers a little early rather than too late. */
const CHARS_PER_TOKEN = 3

/** Summarizes a span of messages into a short note. Injected so compaction is unit-testable. */
export interface Summarizer {
  summarize(messages: BaseMessage[]): Promise<string>
}

function textOf(m: BaseMessage): string {
  if (typeof m.content === 'string') return m.content
  if (Array.isArray(m.content)) return m.content.map((b) => (typeof b === 'string' ? b : ((b as { text?: string }).text ?? ''))).join('')
  return ''
}

export function estimateTokens(messages: readonly BaseMessage[]): number {
  let chars = 0
  for (const m of messages) chars += textOf(m).length
  return Math.ceil(chars / CHARS_PER_TOKEN)
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
  opts: { keepRecentTurns: number; summarizer: Summarizer },
): Promise<CompactResult | null> {
  const firstHumanIdx = messages.findIndex((m) => m instanceof HumanMessage)
  if (firstHumanIdx === -1) return null
  const humanIdxs: number[] = []
  messages.forEach((m, i) => { if (m instanceof HumanMessage) humanIdxs.push(i) })
  if (humanIdxs.length <= opts.keepRecentTurns) return null
  const recentStart = humanIdxs[humanIdxs.length - opts.keepRecentTurns]
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
