// packages/sidecar/src/session/rollout-budget.ts
// Cross-agent-tree token budget (G6): a weighted spend cap covering the
// supervisor loop plus every sub-agent tree (task / task_batch / dispatch /
// background). Recording happens at the single-writer session usage fold, so
// this module stays a dumb counter with threshold logic. total=0 disables.

/** Reminder thresholds, as fractions of the budget. */
export const ROLLOUT_BUDGET_THRESHOLDS = [0.5, 0.8, 0.9]

export interface RolloutBudgetReminder {
  threshold: number
  spent: number
  total: number
}

export class RolloutBudget {
  private spentTokens = 0
  private readonly injectedThresholds = new Set<number>()

  constructor(private readonly totalTokens: number) {}

  /** True when a budget is configured (total > 0). */
  get enabled(): boolean {
    return this.totalTokens > 0
  }

  get total(): number {
    return this.totalTokens
  }

  get spent(): number {
    return this.spentTokens
  }

  remaining(): number {
    return Math.max(0, this.totalTokens - this.spentTokens)
  }

  /** Exhausted when spent >= total. Only meaningful when enabled. */
  exhausted(): boolean {
    return this.enabled && this.spentTokens >= this.totalTokens
  }

  /** Accumulate spend. Ignores non-positive tokens and disabled budgets. */
  record(tokens: number): void {
    if (!this.enabled || !Number.isFinite(tokens) || tokens <= 0) return
    this.spentTokens += tokens
  }

  /**
   * Returns a reminder when a new threshold was just crossed (each threshold
   * fires once), else null. Thresholds: 50% / 80% / 90%.
   */
  pollReminder(): RolloutBudgetReminder | null {
    if (!this.enabled || this.spentTokens <= 0) return null
    for (let i = 0; i < ROLLOUT_BUDGET_THRESHOLDS.length; i++) {
      const t = ROLLOUT_BUDGET_THRESHOLDS[i]
      if (this.spentTokens >= this.totalTokens * t && !this.injectedThresholds.has(i)) {
        this.injectedThresholds.add(i)
        return { threshold: t, spent: this.spentTokens, total: this.totalTokens }
      }
    }
    return null
  }
}

/** Human-readable reminder text for a threshold crossing. */
export function formatRolloutReminder(r: RolloutBudgetReminder): string {
  return (
    `[budget] You have used ${r.spent} of ${r.total} tokens (${Math.round((r.spent / r.total) * 100)}%) ` +
    `across this task tree. Converge: stop fanning out new sub-tasks, prefer summaries, ` +
    `and finish the remaining work directly.`
  )
}
