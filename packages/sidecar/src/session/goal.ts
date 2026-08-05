import {
  DEFAULT_GOAL_BUDGET,
  formatGoalProtectedBlock,
  mapPlanTodoStatus,
  type Goal,
  type GoalBudget,
  type GoalCreateInput,
  type GoalDriveResult,
  type GoalPhase,
  type GoalStatus,
  type GoalTodo,
  type VerificationRecipe,
  type VerificationRunResult,
  goalToWire,
} from './goal-types.js'

export type {
  Goal,
  GoalBudget,
  GoalCreateInput,
  GoalDriveResult,
  GoalPhase,
  GoalStatus,
  GoalTodo,
  VerificationRecipe,
  VerificationRunResult,
} from './goal-types.js'
export { formatGoalProtectedBlock, goalToWire, DEFAULT_GOAL_BUDGET } from './goal-types.js'

export type GoalPersistFn = (goal: Goal | null) => void

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function buildPhases(input: GoalCreateInput): GoalPhase[] {
  if (input.phases && input.phases.length > 0) {
    return input.phases.map((p, i) => ({
      id: newId('phase'),
      title: p.title,
      status: i === 0 ? ('active' as const) : ('pending' as const),
      todos: (p.todos ?? []).map((t) => ({
        id: newId('todo'),
        content: t.content,
        status: 'pending' as const,
      })),
    }))
  }
  return [
    {
      id: newId('phase'),
      title: 'Execute',
      status: 'active',
      todos: [],
    },
  ]
}

export class GoalManager {
  private goal: Goal | null = null
  private onPersist?: GoalPersistFn
  private failureFingerprints: string[] = []
  private static readonly MAX_FAILURES = 12

  setPersist(fn: GoalPersistFn | undefined): void {
    this.onPersist = fn
  }

  private touch(): void {
    if (this.goal) this.goal.updatedAt = Date.now()
    this.onPersist?.(this.goal)
  }

  hydrate(goal: Goal | null): void {
    this.goal = goal
  }

  createGoal(description: string, budget?: Partial<GoalBudget>): Goal {
    return this.create({
      description,
      successCriteria: [description],
      budget,
    })
  }

  create(input: GoalCreateInput): Goal {
    const criteria = input.successCriteria.map((c) => c.trim()).filter(Boolean)
    if (criteria.length === 0) {
      throw new Error('successCriteria required (at least one non-empty item)')
    }
    const description = input.description.trim()
    if (!description) throw new Error('description required')

    const phases = buildPhases(input)
    const now = Date.now()
    this.goal = {
      id: newId('goal'),
      description,
      status: 'active',
      successCriteria: criteria,
      phases,
      activePhaseId: phases[0]?.id ?? null,
      budget: { ...DEFAULT_GOAL_BUDGET, ...input.budget },
      usage: { turns: 0, tokens: 0, wallMs: 0 },
      evidence: [],
      verification: input.verification,
      createdAt: now,
      updatedAt: now,
    }
    this.failureFingerprints = []
    this.touch()
    return this.goal
  }

  drive(): GoalDriveResult | null {
    if (!this.goal || this.goal.status !== 'active') return null
    this.checkBudget()
    if (!this.goal || this.goal.status !== 'active') return null

    const nextTurn = this.goal.usage.turns + 1
    const phase = this.goal.phases.find((p) => p.id === this.goal!.activePhaseId) ?? this.goal.phases[0]
    const criteriaLines = this.goal.successCriteria.map((c, i) => {
      const done = this.goal!.evidence.some((e) => e.criterionIndex === i)
      return `- [${done ? 'x' : ' '}] ${c}`
    })
    const todoLines =
      phase?.todos.map((t) => `- (${t.status}) ${t.content}`).join('\n') || '- (none — call write_todos)'
    const failLines =
      this.failureFingerprints.length > 0
        ? this.failureFingerprints
            .slice(-5)
            .map((f) => `- ${f}`)
            .join('\n')
        : '- (none)'
    const verifyHint = this.goal.verification?.commands?.length
      ? this.goal.verification.commands.map((c) => `- ${c.cmd}`).join('\n')
      : '- (run project tests before claiming done)'

    const prompt = [
      '## Active goal — continue until criteria are met',
      `Goal: ${this.goal.description}`,
      `Auto-continuing (turn ${nextTurn}/${this.goal.budget.maxTurns}).`,
      '',
      '### Success criteria',
      ...criteriaLines,
      '',
      `### Current phase: ${phase?.title ?? '—'}`,
      todoLines,
      '',
      '### Recent failed commands (do not repeat unchanged)',
      failLines,
      '',
      '### Verification before goal_complete',
      verifyHint,
      '',
      'Update write_todos when status changes. Prefer verification_run before goal_complete.',
    ].join('\n')

    return { prompt, goal: this.goal }
  }

  updateGoal(status: GoalStatus): boolean {
    if (!this.goal) return false
    if (status === 'completed') {
      return this.tryComplete()
    }
    this.goal.status = status
    this.touch()
    return true
  }

  /** Complete only when verification last passed (or no recipe). */
  tryComplete(opts?: { force?: boolean }): boolean {
    if (!this.goal) return false
    if (!opts?.force && this.goal.verification?.commands?.length) {
      if (!this.goal.lastVerification?.ok) {
        this.goal.status = 'blocked'
        this.goal.blockedReason = 'verification_required'
        this.touch()
        return false
      }
    }
    this.goal.status = 'completed'
    this.goal = null
    this.touch()
    return true
  }

  completeAndClear(): boolean {
    return this.tryComplete({ force: true })
  }

  resumePausedGoal(): boolean {
    if (!this.goal || (this.goal.status !== 'paused' && this.goal.status !== 'blocked')) return false
    this.goal.status = 'active'
    this.goal.blockedReason = undefined
    this.touch()
    return true
  }

  getStatus(): Goal | null {
    return this.goal
  }

  recordTurn(): void {
    if (this.goal && this.goal.status === 'active') {
      this.goal.usage.turns++
      this.checkBudget()
      this.touch()
    }
  }

  recordTokens(tokens: number): void {
    if (this.goal && this.goal.status === 'active') {
      this.goal.usage.tokens += tokens
      this.checkBudget()
      this.touch()
    }
  }

  setTodosFromPlan(todos: Array<{ content: string; status: string }>): void {
    if (!this.goal) return
    let phase = this.goal.phases.find((p) => p.id === this.goal!.activePhaseId)
    if (!phase) {
      phase = {
        id: newId('phase'),
        title: 'Execute',
        status: 'active',
        todos: [],
      }
      this.goal.phases = [phase]
      this.goal.activePhaseId = phase.id
    }
    phase.todos = todos.map((t) => ({
      id: newId('todo'),
      content: t.content,
      status: mapPlanTodoStatus(t.status),
    }))
    this.touch()
  }

  setVerification(recipe: VerificationRecipe | undefined): void {
    if (!this.goal) return
    this.goal.verification = recipe
    this.touch()
  }

  recordVerification(result: VerificationRunResult): void {
    if (!this.goal) return
    this.goal.lastVerification = result
    if (result.ok) {
      // Mark all criteria evidenced by successful verify when none yet
      if (this.goal.evidence.length === 0) {
        this.goal.evidence = this.goal.successCriteria.map((_, i) => ({
          criterionIndex: i,
          kind: 'command' as const,
          ref: 'verification_run',
          at: result.at,
        }))
      }
    }
    this.touch()
  }

  addEvidence(criterionIndex: number, kind: Goal['evidence'][0]['kind'], ref: string): void {
    if (!this.goal) return
    if (criterionIndex < 0 || criterionIndex >= this.goal.successCriteria.length) return
    this.goal.evidence = this.goal.evidence.filter((e) => e.criterionIndex !== criterionIndex)
    this.goal.evidence.push({ criterionIndex, kind, ref, at: Date.now() })
    this.touch()
  }

  recordFailureFingerprint(fp: string): void {
    const t = fp.trim().slice(0, 200)
    if (!t) return
    this.failureFingerprints.push(t)
    if (this.failureFingerprints.length > GoalManager.MAX_FAILURES) {
      this.failureFingerprints.shift()
    }
  }

  recentFailures(): string[] {
    return [...this.failureFingerprints]
  }

  protectedBlock(): string {
    return formatGoalProtectedBlock(this.goal)
  }

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
