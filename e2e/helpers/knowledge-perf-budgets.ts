/**
 * Knowledge perf budgets — calibrated post Live draft-throttle + render fixes (2026-07-21).
 *
 * Two tiers:
 * - **Hard (unusable)**: always fail CI when exceeded — product is broken.
 * - **Target**: aspirational desktop SSD budgets; logged + soft-assert (warn) unless
 *   `KNOWLEDGE_PERF_STRICT=1` is set.
 *
 * Recalibrate: `yarn test:e2e:knowledge-perf` and update numbers from
 * `[knowledge-perf]` console lines (wallOpenMs / firstEditableMs / serialize p95).
 */

function envMs(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Hard fail: open never becomes editable. */
export const OPEN_UNUSABLE_MS = envMs('KNOWLEDGE_PERF_OPEN_UNUSABLE_MS', 20_000)

/** Hard fail: typed marker never lands on surface. */
export const TYPE_UNUSABLE_MS = envMs('KNOWLEDGE_PERF_TYPE_UNUSABLE_MS', 15_000)

/** Hard fail: single serialize sample (getMarkdown + emit). */
export const SERIALIZE_HARD_MS = envMs('KNOWLEDGE_PERF_SERIALIZE_HARD_MS', 1_500)

/** Soft streak threshold for consecutive slow serializes. */
export const SERIALIZE_SOFT_MS = envMs('KNOWLEDGE_PERF_SERIALIZE_SOFT_MS', 400)

export const SERIALIZE_SOFT_STREAK = 5

/**
 * Target budgets (warm app, local SSD, post-throttle).
 * Not hard-fail unless KNOWLEDGE_PERF_STRICT=1.
 */
export const PERF_TARGETS = {
  /** small-prose wall open → writable */
  smallOpenMs: envMs('KNOWLEDGE_PERF_TARGET_SMALL_OPEN_MS', 2_500),
  /** medium-rich wall open → writable (+ nodeviews start) */
  mediumOpenMs: envMs('KNOWLEDGE_PERF_TARGET_MEDIUM_OPEN_MS', 8_000),
  /** large-source → Source host */
  largeOpenMs: envMs('KNOWLEDGE_PERF_TARGET_LARGE_OPEN_MS', 3_000),
  /** small-prose type marker wall */
  smallTypeMs: envMs('KNOWLEDGE_PERF_TARGET_SMALL_TYPE_MS', 3_000),
  /** medium-rich type marker wall */
  mediumTypeMs: envMs('KNOWLEDGE_PERF_TARGET_MEDIUM_TYPE_MS', 5_000),
  /** Live firstEditableMs (from open start) when present */
  firstEditableSmallMs: envMs('KNOWLEDGE_PERF_TARGET_FE_SMALL_MS', 2_000),
  firstEditableMediumMs: envMs('KNOWLEDGE_PERF_TARGET_FE_MEDIUM_MS', 6_000),
  /** serialize p95 while typing small doc */
  serializeP95SmallMs: envMs('KNOWLEDGE_PERF_TARGET_SER_P95_SMALL_MS', 80),
  /** serialize p95 while typing medium-rich */
  serializeP95MediumMs: envMs('KNOWLEDGE_PERF_TARGET_SER_P95_MEDIUM_MS', 200),
} as const

export function isKnowledgePerfStrict(): boolean {
  return process.env.KNOWLEDGE_PERF_STRICT === '1'
}

/**
 * Assert hard unusable line; optionally soft/strict target.
 * Returns whether target was met (for logging).
 */
export function assertBudget(opts: {
  label: string
  actualMs: number
  hardMs: number
  targetMs?: number
}): boolean {
  const { label, actualMs, hardMs, targetMs } = opts
  if (actualMs >= hardMs) {
    throw new Error(
      `[knowledge-perf] HARD FAIL ${label}: ${actualMs.toFixed(0)}ms >= unusable ${hardMs}ms`,
    )
  }
  if (targetMs == null) return true
  if (actualMs <= targetMs) {
    // eslint-disable-next-line no-console
    console.log(
      `[knowledge-perf] TARGET OK ${label}: ${actualMs.toFixed(0)}ms <= ${targetMs}ms`,
    )
    return true
  }
  const msg = `[knowledge-perf] TARGET MISS ${label}: ${actualMs.toFixed(0)}ms > ${targetMs}ms (hard ${hardMs}ms)`
  if (isKnowledgePerfStrict()) {
    throw new Error(msg)
  }
  // eslint-disable-next-line no-console
  console.warn(msg)
  return false
}
