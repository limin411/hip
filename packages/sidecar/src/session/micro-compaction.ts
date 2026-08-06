import { ToolMessage, AIMessage, type BaseMessage } from '@langchain/core/messages'
import { estimateTextTokens, isSkillToolName } from '@hip/protocol'

/** Content stub that replaces stale tool results (model-visible only). */
export const STALE_TOOL_STUB = '[Old tool result cleared]'

/**
 * Env to **disable** prune (default is on).
 * Set `HIP_COMPACTION_PRUNE=0` or `false` to turn off.
 */
const PRUNE_OFF_ENV = 'HIP_COMPACTION_PRUNE'

/**
 * Newest-tool protect window in tokens (OpenCode-inspired; KD-7).
 * Overridden by ContextConfig.pruneProtectTokens / HIP_CONTEXT_PRUNE_PROTECT_TOKENS.
 */
export const PRUNE_PROTECT_TOKENS = 40_000

/**
 * Minimum candidate volume (tokens) before a prune pass applies (KD-7).
 * Overridden by ContextConfig.pruneMinimumTokens / HIP_CONTEXT_PRUNE_MINIMUM_TOKENS.
 * OpenCode uses `pruned > PRUNE_MINIMUM` (strict greater-than).
 */
export const PRUNE_MINIMUM_TOKENS = 20_000

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

export interface MicroCompactionOpts {
  /**
   * Legacy message-count protect window (overflow recovery / older tests).
   * When set, tools in the last N messages are treated as protected for pair
   * boundary logic; token window still applies unless callers only rely on this.
   */
  keepRecent?: number
  /** Newest-tool protect budget in tokens. Default {@link PRUNE_PROTECT_TOKENS}. */
  pruneProtectTokens?: number
  /**
   * Skip prune when candidate release volume is ≤ this many tokens.
   * Default {@link PRUNE_MINIMUM_TOKENS} in token mode; `0` when only `keepRecent` is set
   * (legacy message-index path must still truncate small fixtures).
   */
  pruneMinimumTokens?: number
}

export interface MicroCompactionResult {
  /** The (possibly modified) message list — same length, stable ids. */
  messages: BaseMessage[]
  /** Number of tool result messages whose content was replaced. */
  truncated: number
}

function toolContentText(m: ToolMessage): string {
  if (typeof m.content === 'string') return m.content
  if (Array.isArray(m.content)) {
    return m.content
      .map((b) => (typeof b === 'string' ? b : ((b as { text?: string }).text ?? '')))
      .join('')
  }
  return ''
}

function toolContentTokens(m: ToolMessage): number {
  return estimateTextTokens(toolContentText(m))
}

function isAlreadyStubbed(m: ToolMessage): boolean {
  const c = typeof m.content === 'string' ? m.content : ''
  return (
    c.startsWith('[Old tool result cleared]') ||
    c === '[Stale tool result cleared]'
  )
}

function stubToolMessage(m: ToolMessage): ToolMessage {
  const name = m.name ?? 'tool'
  const n = typeof m.content === 'string' ? m.content.length : toolContentText(m).length
  return new ToolMessage({
    id: m.id,
    content: `${STALE_TOOL_STUB} | name=${name} | chars=${n}`,
    tool_call_id: m.tool_call_id,
    name: m.name,
  })
}

/**
 * In-place (id-stable) truncation of stale tool results.
 *
 * **Precedence (KD-17)**:
 * 1. Unresolved tool-pair preservation (exchange spans into the protect zone)
 * 2. Skill tools (`isSkillToolName` — shared with UI breakdown)
 * 3. Newest→oldest token protect window (`pruneProtectTokens`, default 40k)
 *
 * Only applies stubs when candidate release volume **exceeds** `pruneMinimumTokens`
 * (default 20k; OpenCode-compatible strict greater-than).
 *
 * Optional `keepRecent` still defines a message-index recent zone for pair logic
 * and protects tools inside that zone (overflow recovery).
 */
export class MicroCompaction {
  private readonly keepRecent: number | undefined
  private readonly pruneProtectTokens: number
  private readonly pruneMinimumTokens: number

  constructor(opts?: MicroCompactionOpts) {
    this.keepRecent = opts?.keepRecent
    // Token protect: explicit value wins; keepRecent-only (legacy/overflow) → 0
    // so message-index window alone defines the protect zone; default → 40k.
    if (
      opts?.pruneProtectTokens != null &&
      Number.isFinite(opts.pruneProtectTokens) &&
      opts.pruneProtectTokens >= 0
    ) {
      this.pruneProtectTokens = Math.floor(opts.pruneProtectTokens)
    } else if (opts?.keepRecent != null) {
      this.pruneProtectTokens = 0
    } else {
      this.pruneProtectTokens = PRUNE_PROTECT_TOKENS
    }
    // Legacy keepRecent-only callers (tests / overflow) default minimum to 0 so
    // small fixtures still prune; pure token mode uses PRUNE_MINIMUM_TOKENS.
    if (
      opts?.pruneMinimumTokens != null &&
      Number.isFinite(opts.pruneMinimumTokens) &&
      opts.pruneMinimumTokens >= 0
    ) {
      this.pruneMinimumTokens = Math.floor(opts.pruneMinimumTokens)
    } else if (opts?.keepRecent != null && opts?.pruneProtectTokens == null) {
      this.pruneMinimumTokens = 0
    } else {
      this.pruneMinimumTokens = PRUNE_MINIMUM_TOKENS
    }
  }

  compact(messages: BaseMessage[]): MicroCompactionResult {
    if (messages.length === 0) {
      return { messages, truncated: 0 }
    }

    // ── Protected tool indices (skill + token window + keepRecent) ─────
    // Track zones separately so an old skill tool does not pull pair recentStart to 0.
    const skillProtected = new Set<number>()
    const tokenProtected = new Set<number>()
    const messageProtected = new Set<number>()

    // Skill tools always protected; do not consume the token protect budget.
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      if (!(m instanceof ToolMessage)) continue
      if (isSkillToolName(m.name ?? '')) skillProtected.add(i)
    }

    // Newest → oldest: protect until pruneProtectTokens of non-skill tool output.
    // Budget 0 = message-count / pair-only mode (no token window).
    if (this.pruneProtectTokens > 0) {
      let protectUsed = 0
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (!(m instanceof ToolMessage)) continue
        if (skillProtected.has(i)) continue
        if (isAlreadyStubbed(m)) continue
        const est = toolContentTokens(m)
        protectUsed += est
        if (protectUsed <= this.pruneProtectTokens) {
          tokenProtected.add(i)
        }
        // Beyond protect budget: leave unprotected (may still be pair-preserved).
      }
    }

    // Optional message-count floor (overflow / legacy).
    let messageRecentStart: number | undefined
    if (this.keepRecent != null && this.keepRecent > 0) {
      messageRecentStart = Math.max(0, messages.length - this.keepRecent)
      for (let i = messageRecentStart; i < messages.length; i++) {
        if (messages[i] instanceof ToolMessage) messageProtected.add(i)
      }
    }

    const protectedTools = new Set<number>([
      ...skillProtected,
      ...tokenProtected,
      ...messageProtected,
    ])

    // Recent zone for pair logic: message window, else earliest token-protected tool.
    let recentStart = messages.length
    if (messageRecentStart != null) {
      recentStart = messageRecentStart
    } else if (tokenProtected.size > 0) {
      recentStart = Math.min(...tokenProtected)
    }

    // ── Build tool_call_id → result index map ──────────────────────────
    const resultIndex: Map<string, number> = new Map()
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      if (m instanceof ToolMessage && m.tool_call_id) {
        resultIndex.set(m.tool_call_id, i)
      }
    }

    // ── Phase 1: AIMessages whose exchange crosses into the protect zone ─
    const pairPreserved: Set<number> = new Set()

    for (let i = 0; i < recentStart; i++) {
      const m = messages[i]
      if (!(m instanceof AIMessage) || !m.tool_calls?.length) continue
      for (const tc of m.tool_calls) {
        if (!tc.id) continue
        const ri = resultIndex.get(tc.id)
        if (ri !== undefined && (ri >= recentStart || protectedTools.has(ri))) {
          for (let j = i; j < recentStart; j++) pairPreserved.add(j)
          break
        }
      }
    }

    // ── Phase 2: AIMessages in/after recent zone referencing older results ─
    const recentToolCallIds: Set<string> = new Set()
    for (let i = recentStart; i < messages.length; i++) {
      const m = messages[i]
      if (!(m instanceof AIMessage) || !m.tool_calls?.length) continue
      for (const tc of m.tool_calls) {
        if (tc.id) recentToolCallIds.add(tc.id)
      }
    }

    // ── Collect prune candidates ───────────────────────────────────────
    type Candidate = { index: number; tokens: number }
    const candidates: Candidate[] = []

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      if (!(m instanceof ToolMessage)) continue
      if (protectedTools.has(i)) continue
      if (pairPreserved.has(i)) continue
      if (m.tool_call_id && recentToolCallIds.has(m.tool_call_id)) continue
      if (isAlreadyStubbed(m)) continue
      // Skill double-check (name may be empty on some ToolMessages)
      if (isSkillToolName(m.name ?? '')) continue

      candidates.push({ index: i, tokens: toolContentTokens(m) })
    }

    if (candidates.length === 0) {
      return { messages, truncated: 0 }
    }

    const prunedVolume = candidates.reduce((s, c) => s + c.tokens, 0)
    // OpenCode: only prune when pruned > PRUNE_MINIMUM (strict).
    if (prunedVolume <= this.pruneMinimumTokens) {
      return { messages, truncated: 0 }
    }

    const result: BaseMessage[] = [...messages]
    let truncated = 0
    for (const c of candidates) {
      const m = messages[c.index] as ToolMessage
      result[c.index] = stubToolMessage(m)
      truncated++
    }

    return { messages: result, truncated }
  }
}

// Re-export legacy stub string used in older tests
export const STALE_STUB = STALE_TOOL_STUB

// Re-export for callers that want the shared helper from this module.
export { isSkillToolName }
