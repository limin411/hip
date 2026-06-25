export interface GoalBudget {
  maxTurns: number
  maxTokens: number
}

export interface GoalUsage {
  turns: number
  tokens: number
}

export type GoalStatus = 'active' | 'paused' | 'completed'

export interface Goal {
  readonly id: string
  readonly description: string
  status: GoalStatus
  readonly budget: GoalBudget
  usage: GoalUsage
  readonly createdAt: number
}

export interface GoalDriveResult {
  prompt: string
  goal: Goal
}

const DEFAULT_BUDGET: GoalBudget = { maxTurns: 25, maxTokens: 200_000 }

export class GoalManager {
  private goal: Goal | null = null

  createGoal(description: string, budget?: Partial<GoalBudget>): Goal {
    const merged: GoalBudget = { ...DEFAULT_BUDGET, ...budget }
    this.goal = {
      id: `goal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      description,
      status: 'active',
      budget: merged,
      usage: { turns: 0, tokens: 0 },
      createdAt: Date.now(),
    }
    return this.goal
  }

  /** Check if an active goal exists and return a continuation prompt.
   *  Returns null when no active goal OR budget is exhausted (auto-paused). */
  drive(): GoalDriveResult | null {
    if (!this.goal || this.goal.status !== 'active') return null

    this.checkBudget()
    if (this.goal.status !== 'active') return null

    const nextTurn = this.goal.usage.turns + 1
    return {
      prompt: `Continue working toward your goal: "${this.goal.description}". ` +
        `Auto-continuing (turn ${nextTurn}/${this.goal.budget.maxTurns}).`,
      goal: this.goal,
    }
  }

  /** Update the status of the current goal. */
  updateGoal(status: GoalStatus): boolean {
    if (!this.goal) return false
    this.goal.status = status
    return true
  }

  /** Resume a paused goal. Returns false if no goal or not paused. */
  resumePausedGoal(): boolean {
    if (!this.goal || this.goal.status !== 'paused') return false
    this.goal.status = 'active'
    return true
  }

  /** Get the current goal (or null). */
  getStatus(): Goal | null {
    return this.goal
  }

  /** Record a completed turn against the active goal budget. */
  recordTurn(): void {
    if (this.goal && this.goal.status === 'active') {
      this.goal.usage.turns++
      this.checkBudget()
    }
  }

  /** Record token usage against the active goal budget. */
  recordTokens(tokens: number): void {
    if (this.goal && this.goal.status === 'active') {
      this.goal.usage.tokens += tokens
      this.checkBudget()
    }
  }

  /** Check budget limits and auto-pause when exhausted. */
  private checkBudget(): void {
    if (!this.goal || this.goal.status !== 'active') return
    if (
      this.goal.usage.turns >= this.goal.budget.maxTurns ||
      this.goal.usage.tokens >= this.goal.budget.maxTokens
    ) {
      this.goal.status = 'paused'
    }
  }
}
