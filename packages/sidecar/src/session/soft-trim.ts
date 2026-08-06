/**
 * Optional soft trim for large tool-result bodies (request-side / in-memory copy).
 *
 * Unlike micro-compaction hard clear (which rewrites graph state with a stub),
 * soft trim returns a **new** message list for the model request only — originals
 * stay intact for persistence and UI.
 *
 * Default **off**. When enabled and fill > softTrimPercent, ToolMessages older
 * than keepLastNTurns are head+tail truncated.
 */
import { HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'

export const SOFT_TRIM_MARKER = '\n... [soft-trimmed] ...\n'

/** Default fill % above which soft trim activates (when enabled). */
export const DEFAULT_SOFT_TRIM_PERCENT = 50
/** Default number of recent human turns left untouched. */
export const DEFAULT_SOFT_TRIM_KEEP_LAST_N_TURNS = 3
/** Default head/tail char budgets for each trimmed tool body. */
export const DEFAULT_SOFT_TRIM_HEAD_CHARS = 2000
export const DEFAULT_SOFT_TRIM_TAIL_CHARS = 2000

export interface SoftTrimOptions {
  /** Master switch. Default false. */
  enabled?: boolean
  /**
   * Current context fill percent (0–100). When set, soft trim only runs if
   * fillPercent > softTrimPercent. When omitted, the fill gate is skipped
   * (caller already decided to apply).
   */
  fillPercent?: number
  /** Fill threshold (exclusive). Default 50. */
  softTrimPercent?: number
  /** Keep the last N human turns untrimmed. Default 3. */
  keepLastNTurns?: number
  headChars?: number
  tailChars?: number
}

export interface SoftTrimResult {
  /** Possibly new array; never mutates input messages. */
  messages: BaseMessage[]
  /** Number of tool bodies head+tail truncated. */
  trimmed: number
}

export function isSoftTrimEnabled(opts?: { enabled?: boolean } | null): boolean {
  return opts?.enabled === true
}

/** True when content is already a hard-clear stub or prior soft-trim. */
export function isSoftTrimSkipContent(content: string): boolean {
  if (content.startsWith('[Old tool result cleared]')) return true
  if (content === '[Stale tool result cleared]') return true
  if (content.includes('[soft-trimmed]')) return true
  return false
}

/**
 * Head+tail truncate a single string. Returns original when already short enough.
 */
export function softTrimText(
  content: string,
  headChars: number = DEFAULT_SOFT_TRIM_HEAD_CHARS,
  tailChars: number = DEFAULT_SOFT_TRIM_TAIL_CHARS,
): string {
  const h = Math.max(0, Math.floor(headChars))
  const t = Math.max(0, Math.floor(tailChars))
  const minKeep = h + t + SOFT_TRIM_MARKER.length
  if (content.length <= minKeep) return content
  return content.slice(0, h) + SOFT_TRIM_MARKER + content.slice(-t)
}

/**
 * Soft-trim large tool result text on a **copy** of the message list.
 *
 * - Disabled by default (`enabled` must be true).
 * - When `fillPercent` is provided, requires `fillPercent > softTrimPercent`.
 * - Only ToolMessages **before** the start of the last `keepLastNTurns` human
 *   turns are candidates.
 * - Skips already hard-cleared / soft-trimmed bodies.
 */
export function softTrimMessages(
  messages: BaseMessage[],
  opts?: SoftTrimOptions,
): SoftTrimResult {
  if (!isSoftTrimEnabled(opts)) {
    return { messages, trimmed: 0 }
  }

  const threshold = opts?.softTrimPercent ?? DEFAULT_SOFT_TRIM_PERCENT
  if (opts?.fillPercent != null && Number.isFinite(opts.fillPercent)) {
    if (opts.fillPercent <= threshold) {
      return { messages, trimmed: 0 }
    }
  }

  const keepLastN = Math.max(
    0,
    Math.floor(opts?.keepLastNTurns ?? DEFAULT_SOFT_TRIM_KEEP_LAST_N_TURNS),
  )
  const headChars = opts?.headChars ?? DEFAULT_SOFT_TRIM_HEAD_CHARS
  const tailChars = opts?.tailChars ?? DEFAULT_SOFT_TRIM_TAIL_CHARS
  const minLen = Math.max(0, headChars) + Math.max(0, tailChars) + SOFT_TRIM_MARKER.length

  const humanIdxs: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i] instanceof HumanMessage) humanIdxs.push(i)
  }

  // Indices [0, staleEnd) are older than the keep-last-n human turns.
  let staleEnd: number
  if (keepLastN <= 0) {
    staleEnd = messages.length
  } else if (humanIdxs.length <= keepLastN) {
    staleEnd = 0
  } else {
    staleEnd = humanIdxs[humanIdxs.length - keepLastN]!
  }

  if (staleEnd <= 0) {
    return { messages, trimmed: 0 }
  }

  let trimmed = 0
  const out: BaseMessage[] = new Array(messages.length)
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!
    if (i >= staleEnd || !(m instanceof ToolMessage) || typeof m.content !== 'string') {
      out[i] = m
      continue
    }
    if (m.content.length <= minLen || isSoftTrimSkipContent(m.content)) {
      out[i] = m
      continue
    }
    out[i] = new ToolMessage({
      id: m.id,
      content: softTrimText(m.content, headChars, tailChars),
      tool_call_id: m.tool_call_id,
      name: m.name,
    })
    trimmed++
  }

  return { messages: trimmed > 0 ? out : messages, trimmed }
}
