import { ToolMessage, AIMessage, type BaseMessage } from '@langchain/core/messages'

/** Content stub that replaces stale tool results (model-visible only). */
export const STALE_TOOL_STUB = '[Old tool result cleared]'

/**
 * Env to **disable** prune (default is on).
 * Set `HIP_COMPACTION_PRUNE=0` or `false` to turn off.
 */
const PRUNE_OFF_ENV = 'HIP_COMPACTION_PRUNE'

/**
 * Whether tool-result prune (micro-compaction) is enabled.
 * Default **true**. Disable with HIP_COMPACTION_PRUNE=0|false|off.
 * (Legacy HIP_EXPERIMENTAL_MICRO_COMPACTION is obsolete — prune is on by default.)
 */
export function isMicroCompactionEnabled(): boolean {
  const off = process.env[PRUNE_OFF_ENV]
  if (off === '0' || off === 'false' || off === 'off') return false
  return true
}

/** @deprecated alias — same as isMicroCompactionEnabled */
export function isPruneEnabled(): boolean {
  return isMicroCompactionEnabled()
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
 *
 * Default keepRecent ≈ 8 tool-rounds of traffic (~24 messages) per compaction spec.
 */
export class MicroCompaction {
  private readonly keepRecent: number

  constructor(opts?: { keepRecent?: number }) {
    // ~3 msgs/round × 8 rounds = 24; use 24 as default protect window in message indices.
    this.keepRecent = opts?.keepRecent ?? 24
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
    const preserved: Set<number> = new Set()

    for (let i = 0; i < staleThreshold; i++) {
      const m = messages[i]
      if (!(m instanceof AIMessage) || !m.tool_calls?.length) continue
      for (const tc of m.tool_calls) {
        if (!tc.id) continue
        const ri = resultIndex.get(tc.id)
        if (ri !== undefined && ri >= staleThreshold) {
          for (let j = i; j < staleThreshold; j++) preserved.add(j)
          break
        }
      }
    }

    // ── Phase 2: recent AIMessages referencing stale results ───────────
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
      if (typeof m.content === 'string' && m.content.startsWith('[Old tool result cleared]')) continue
      if (typeof m.content === 'string' && m.content === '[Stale tool result cleared]') continue

      const name = m.name ?? 'tool'
      const n = typeof m.content === 'string' ? m.content.length : 0
      result[i] = new ToolMessage({
        id: m.id,
        content: `${STALE_TOOL_STUB} | name=${name} | chars=${n}`,
        tool_call_id: m.tool_call_id,
        name: m.name,
      })
      truncated++
    }

    return { messages: result, truncated }
  }
}

// Re-export legacy stub string used in older tests
export const STALE_STUB = STALE_TOOL_STUB
