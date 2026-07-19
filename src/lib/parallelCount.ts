/**
 * Local heuristic for parallel slot count (host fan-out + shared clamp).
 * Spec: docs/design/2026-07-18-agent-decided-parallel-count-spec.md
 * Copy: docs/design/2026-07-19-worktree-composer-control-upgrade.md (reasonCode → i18n)
 */

/** Inclusive bounds for parallel worktree slots. */
export const PARALLEL_COUNT_MIN = 1
export const PARALLEL_COUNT_MAX = 4

/**
 * Structured reason for UI i18n (`chat.worktreeControl.reason.<code>`).
 * English `rationale` is a frozen diagnostic for unit tests only — UI must use {@link reasonCode}.
 * Keep wording aligned with product “track” terminology (not “slot”) for consistency with i18n.
 */
export type ParallelSuggestReason =
  | 'empty'
  | 'compare'
  | 'three'
  | 'four'
  | 'single'
  | 'default'

/** Exhaustive list of reason codes — keep in sync with `chat.worktreeControl.reason.*` keys. */
export const PARALLEL_SUGGEST_REASONS: readonly ParallelSuggestReason[] = [
  'empty',
  'compare',
  'three',
  'four',
  'single',
  'default',
] as const

export interface ParallelCountSuggestion {
  n: number
  /**
   * English diagnostic for unit tests only (never render in UI).
   * Intentionally uses “track(s)” to match `chat.worktreeControl.reason.*` product terms.
   */
  rationale: string
  reasonCode: ParallelSuggestReason
}

/** Clamp fan-out size. Invalid → default 2. */
export function clampParallelCount(n: number): number {
  if (!Number.isFinite(n)) return 2
  return Math.min(PARALLEL_COUNT_MAX, Math.max(PARALLEL_COUNT_MIN, Math.floor(n)))
}

/**
 * Local stand-in for “agent picks N” without a paid LLM.
 * Future model output should still pass through {@link clampParallelCount}.
 * Host UI localizes via `reasonCode` — do not render `rationale` to users.
 */
export function suggestParallelCount(goal: string): ParallelCountSuggestion {
  const g = goal.trim()
  if (!g) {
    return {
      n: 2,
      rationale: 'Empty goal — default to 2 comparable approaches',
      reasonCode: 'empty',
    }
  }

  const lower = g.toLowerCase()

  // Higher counts first so “four” wins over “two”.
  if (
    /四种|四条|四个方案|四路/.test(g) ||
    /\bfour\b/.test(lower) ||
    /\b4\s*(ways?|options?|approaches?|variants?)\b/.test(lower) ||
    /exhaustive|matrix|全面|穷举/.test(lower)
  ) {
    return {
      n: clampParallelCount(4),
      rationale: 'Multi-way / exhaustive exploration → 4 tracks',
      reasonCode: 'four',
    }
  }

  if (
    /三种|三条|三个方案|三路/.test(g) ||
    /\bthree\b/.test(lower) ||
    /\b3\s*(ways?|options?|approaches?|variants?)\b/.test(lower)
  ) {
    return {
      n: clampParallelCount(3),
      rationale: 'Three distinct approaches → 3 tracks',
      reasonCode: 'three',
    }
  }

  const wantsCompare =
    /对比|比较|两种|两条|两路|双方案|vs\.?|versus|compare|alternatives?|two approaches?|both options?/.test(
      lower,
    ) || /对比|比较|两种|两条|两路/.test(g)

  const wantsSingle =
    /单个|单路|isolation|single\s+(fix|change|file)|one\s+(fix|change)|\btypo\b|\brename\b|\bbug\b|\bfix\b/.test(
      lower,
    ) || /只改|仅修|修一个|改一个|重命名/.test(g)

  if (wantsCompare) {
    return {
      n: clampParallelCount(2),
      rationale: 'Compare / dual approach language → 2 tracks',
      reasonCode: 'compare',
    }
  }

  if (wantsSingle && !wantsCompare) {
    return {
      n: clampParallelCount(1),
      rationale: 'Single focused change → 1 isolated workspace',
      reasonCode: 'single',
    }
  }

  return {
    n: clampParallelCount(2),
    rationale: 'Default: 2 tracks for a light A/B comparison',
    reasonCode: 'default',
  }
}
