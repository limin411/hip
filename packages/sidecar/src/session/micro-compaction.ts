import { ToolMessage, AIMessage, type BaseMessage } from '@langchain/core/messages'

/** Content stub that replaces stale tool results. */
const STALE_STUB = '[Stale tool result cleared]'

/** Feature gate env var. Micro-compaction only activates when set to '1' or 'true'. */
const ENV_KEY = 'HIP_EXPERIMENTAL_MICRO_COMPACTION'

/** Read the feature gate once (sync is fine — env vars don't change at runtime). */
export function isMicroCompactionEnabled(): boolean {
  const v = process.env[ENV_KEY]
  return v === '1' || v === 'true'
}

export interface MicroCompactionResult {
  /** The (possibly modified) message list — same length, stable ids. */
  messages: BaseMessage[]
  /** Number of tool result messages whose content was replaced. */
  truncated: number
}

/**
 * In-place (id-stable) truncation of stale tool results.
 *
 * Scans messages from oldest to newest. Tool result messages (ToolMessage)
 * whose index falls outside the `keepRecent` window are candidates for
 * truncation. However, micro-compaction preserves messages that belong to an
 * *unresolved* tool exchange — an exchange where a tool call (AIMessage) has
 * at least one result (ToolMessage) inside the recent window, or where a recent
 * AIMessage still references a stale result. Preserving such ranges prevents
 * the LLM from receiving orphaned tool-call context.
 */
export class MicroCompaction {
  private readonly keepRecent: number

  constructor(opts?: { keepRecent?: number }) {
    this.keepRecent = opts?.keepRecent ?? 20
  }

  compact(messages: BaseMessage[]): MicroCompactionResult {
    const staleThreshold = messages.length - this.keepRecent

    // Nothing is stale — early exit.
    if (staleThreshold <= 0) {
      return { messages, truncated: 0 }
    }

    // ── Build tool_call_id → result index map ──────────────────────────
    const resultIndex: Map<string, number> = new Map()
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      if (m instanceof ToolMessage && m.tool_call_id) {
        resultIndex.set(m.tool_call_id, i)
      }
    }

    // ── Phase 1: stale AIMessages whose exchange crosses the boundary ──
    // A stale AIMessage whose tool_call has a result inside the recent
    // window makes the entire range [AIMessage.index, staleThreshold-1]
    // "active" — we preserve all messages there so the LLM still sees the
    // tool-call sequence that produced the recent result.
    const preserved: Set<number> = new Set()

    for (let i = 0; i < staleThreshold; i++) {
      const m = messages[i]
      if (!(m instanceof AIMessage) || !m.tool_calls?.length) continue
      for (const tc of m.tool_calls) {
        if (!tc.id) continue
        const ri = resultIndex.get(tc.id)
        if (ri !== undefined && ri >= staleThreshold) {
          // This stale AIMessage's exchange reaches into the recent window.
          for (let j = i; j < staleThreshold; j++) preserved.add(j)
          break
        }
      }
    }

    // ── Phase 2: recent AIMessages referencing stale results ───────────
    // If a recent AIMessage has a tool_call whose matching ToolMessage is
    // stale, that stale result must be preserved — the LLM still needs it.
    const recentToolCallIds: Set<string> = new Set()
    for (let i = staleThreshold; i < messages.length; i++) {
      const m = messages[i]
      if (!(m instanceof AIMessage) || !m.tool_calls?.length) continue
      for (const tc of m.tool_calls) {
        if (tc.id) recentToolCallIds.add(tc.id)
      }
    }

    // ── Phase 3: truncate stale ToolMessages ───────────────────────────
    const result: BaseMessage[] = [...messages]
    let truncated = 0

    for (let i = 0; i < staleThreshold; i++) {
      const m = messages[i]
      if (!(m instanceof ToolMessage)) continue
      if (preserved.has(i)) continue
      if (m.tool_call_id && recentToolCallIds.has(m.tool_call_id)) continue
      // Avoid re-processing the same index (though structurally impossible
      // with this loop, kept for defensive clarity).
      if (typeof m.content === 'string' && m.content === STALE_STUB) continue

      result[i] = new ToolMessage({
        id: m.id,
        content: STALE_STUB,
        tool_call_id: m.tool_call_id,
        name: m.name,
      })
      truncated++
    }

    return { messages: result, truncated }
  }
}
