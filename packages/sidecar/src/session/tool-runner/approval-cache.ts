import type { ApprovalDecision } from '../tools.js'

const MAX_CACHE_ENTRIES = 1000

/**
 * Per-session cache for HITL approval decisions.
 * Stores allow_always / reject_always so repeated tool calls
 * with the same args (or the same tool) can skip the HITL prompt.
 * Bounded to MAX_CACHE_ENTRIES to avoid unbounded growth in long sessions.
 */
export interface ApprovalCache {
  /**
   * Record a decision. Only `allow_always` and `reject_always` are
   * cached; `allow_once`, `reject_once`, and `cancelled` are no-ops.
   *
   * When `args` is undefined or empty the decision is scoped to the
   * tool name alone (applies to any args). When `args` is non-empty
   * the decision is scoped to the specific argument combination.
   */
  set(
    toolName: string,
    args: Record<string, unknown> | undefined,
    decision: ApprovalDecision,
  ): void

  /**
   * Look up a cached decision. Tries the tool+args key first, then
   * falls back to the tool-only key so a general approval covers
   * all argument combinations unless overridden.
   *
   * Returns `'allow'`, `'reject'`, or `undefined` when nothing is cached.
   */
  lookup(
    toolName: string,
    args: Record<string, unknown> | undefined,
  ): 'allow' | 'reject' | undefined

  /** Drop every cached decision. */
  clear(): void
}

/**
 * Produce a stable canonical key from a tool name and optional arguments.
 *
 * - `tool` scope  (args undefined/empty) → `"tool:<name>"`
 * - `tool+args` scope (args present)     → `"tool+args:<name>:<canonicalJSON>"`
 *
 * Object keys in the JSON output are sorted alphabetically so reordering
 * the same keys produces an identical key.
 */
export function keyFor(
  toolName: string,
  args: Record<string, unknown> | undefined,
): string {
  if (args === undefined || Object.keys(args).length === 0) {
    return `tool:${toolName}`
  }
  return `tool+args:${toolName}:${canonicalJson(args)}`
}

/** Recursively sort object keys for deterministic JSON output. */
function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(sortKeys)
  const obj = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  const keys = Object.keys(obj).sort()
  for (const key of keys) {
    const val = obj[key]
    if (val !== undefined) {
      result[key] = sortKeys(val)
    }
  }
  return result
}

function canonicalJson(obj: Record<string, unknown>): string {
  return JSON.stringify(sortKeys(obj))
}

export class SessionApprovalCache implements ApprovalCache {
  private readonly map = new Map<string, 'allow' | 'reject'>()

  set(
    toolName: string,
    args: Record<string, unknown> | undefined,
    decision: ApprovalDecision,
  ): void {
    if (decision === null || decision === undefined || !('kind' in decision)) return
    const { kind } = decision
    if (kind !== 'allow_always' && kind !== 'reject_always') return
    const key = keyFor(toolName, args)
    // Evict oldest entry if at capacity (simple FIFO bound).
    if (this.map.size >= MAX_CACHE_ENTRIES && !this.map.has(key)) {
      const first = this.map.keys().next().value
      if (first !== undefined) this.map.delete(first)
    }
    this.map.set(key, kind === 'allow_always' ? 'allow' : 'reject')
  }

  lookup(
    toolName: string,
    args: Record<string, unknown> | undefined,
  ): 'allow' | 'reject' | undefined {
    // Try tool+args key first (more specific).
    if (args !== undefined && Object.keys(args).length > 0) {
      const withArgs = keyFor(toolName, args)
      const found = this.map.get(withArgs)
      if (found !== undefined) return found
    }
    // Fall back to tool-only key (general scope).
    return this.map.get(keyFor(toolName, undefined))
  }

  clear(): void {
    this.map.clear()
  }
}
