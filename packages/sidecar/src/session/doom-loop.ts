/** Doom-loop detection: an identical batch of tool calls repeated N times in a row. */

import type { DoomLoopStrategy } from '@hip/protocol'
import { isSubagentPausedText } from './subagent-result.js'

export type { DoomLoopStrategy }

/** Canonical allowlist — single source for config parse + runtime resolve. */
export const DOOM_LOOP_STRATEGIES: readonly DoomLoopStrategy[] = [
  'nudge_then_pause',
  'pause_immediately',
  'auto_continue',
] as const

/** Default matches historical graph behavior (nudge once, then pause). */
export const DEFAULT_DOOM_LOOP_STRATEGY: DoomLoopStrategy = 'nudge_then_pause'

/**
 * Parse a raw config string into a strategy, or `undefined` if invalid/absent.
 * Used by hip-config normalize (omit field) and by {@link resolveDoomLoopStrategy}.
 */
export function parseDoomLoopStrategy(
  strategy?: string | null,
): DoomLoopStrategy | undefined {
  if (typeof strategy !== 'string') return undefined
  return (DOOM_LOOP_STRATEGIES as readonly string[]).includes(strategy)
    ? (strategy as DoomLoopStrategy)
    : undefined
}

/**
 * Normalize an optional config / GraphCtx value to a valid strategy.
 * Unknown / empty values fall back to {@link DEFAULT_DOOM_LOOP_STRATEGY}.
 */
export function resolveDoomLoopStrategy(
  strategy?: DoomLoopStrategy | string | null,
): DoomLoopStrategy {
  return parseDoomLoopStrategy(strategy ?? undefined) ?? DEFAULT_DOOM_LOOP_STRATEGY
}

export const DOOM_LOOP_N = 3

/** How many recent EXECUTED batch signatures to retain for the consecutive-repeat check. */
export const SIG_WINDOW = 6

/** Same path+tool may be hit this many times before further calls are blocked (Sprint A LoopGuard v2). */
export const PATH_HIT_LIMIT = 3

/** Consecutive tool results starting with "Error:" before forcing a text-only wrap-up. */
export const ERROR_STREAK_LIMIT = 3

/** Corrective note injected after the Nth identical batch, before the next model turn. */
export const DOOM_LOOP_NUDGE =
  '你已经用完全相同的参数重复调用了同一个工具多次，但没有取得进展。' +
  '请停止重复——换一种完全不同的方法，或者如果确实无法继续，就直接用文字说明情况并结束。'

/** Question shown to the user when the loop is still stuck after the nudge. */
export const PAUSE_QUESTION =
  '我反复在做同一个操作但没有进展。需要你指个方向：换个思路、跳过这一步，还是先停下？'

export const PATH_REPEAT_MESSAGE =
  'Error: you already inspected this path multiple times with the same tool. ' +
  'Stop re-reading it — use a different approach or summarize what you know.'

export const ERROR_STREAK_NUDGE =
  'Multiple tools failed in a row. Do not keep calling tools. ' +
  'Reply in plain text with what you learned, what failed, and what the user should do next.'

interface ToolCallLike {
  name: string
  args: unknown
}

/** Stable signature for one batch of tool calls: each `name:JSON(args)`, sorted then joined.
 *  Identical repeated calls serialize identically, so equality detects a repeat regardless of how
 *  many calls the batch holds or their order. */
export function sigOf(calls: readonly ToolCallLike[]): string {
  return calls.map((c) => `${c.name}:${JSON.stringify(c.args)}`).sort().join('|')
}

/** How many of the most recent signatures (counting back from the tail) equal `sig`. */
export function trailingRepeatCount(sigs: readonly string[], sig: string): number {
  let n = 0
  for (let i = sigs.length - 1; i >= 0 && sigs[i] === sig; i--) n++
  return n
}

/** Normalize path-like tool args for path-hit counting. */
export function normalizeToolPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '') || '/'
}

/**
 * Key for path-based thrash detection (`tool:normalizedPath`), or null if the call has no path.
 * Covers read_file / ls / glob (pattern treated as path-like).
 */
export function pathHitKey(name: string, args: unknown): string | null {
  if (name !== 'read_file' && name !== 'ls' && name !== 'glob') return null
  const a = args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
  const raw =
    typeof a.path === 'string' ? a.path
    : typeof a.pattern === 'string' ? a.pattern
    : null
  if (!raw) return null
  return `${name}:${normalizeToolPath(raw)}`
}

export function countPathHits(pathHits: readonly string[], key: string): number {
  let n = 0
  for (const h of pathHits) if (h === key) n++
  return n
}

/**
 * True when a tool result is a loop-guard "tool error".
 * Sub-agent pause markers are never errors (A↔B contract).
 */
export function isLoopToolError(content: string): boolean {
  if (isSubagentPausedText(content)) return false
  return content.startsWith('Error')
}

/** How many trailing tool results (from the end) look like errors. */
export function trailingErrorStreak(contents: readonly string[]): number {
  let n = 0
  for (let i = contents.length - 1; i >= 0; i--) {
    const c = contents[i] ?? ''
    if (typeof c === 'string' && isLoopToolError(c)) n++
    else break
  }
  return n
}

/**
 * Harvest trailing consecutive tool-error strings (for replan prompts).
 * Stops at the first non-error (including sub-agent pause).
 */
export function harvestTrailingToolErrors(contents: readonly string[]): string[] {
  const errors: string[] = []
  for (let i = contents.length - 1; i >= 0; i--) {
    const c = contents[i] ?? ''
    if (typeof c === 'string' && isLoopToolError(c)) errors.unshift(c)
    else break
  }
  return errors
}
