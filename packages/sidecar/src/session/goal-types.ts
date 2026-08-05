/** Durable goal model for long engineering tasks (plan M1). */

export interface GoalBudget {
  maxTurns: number
  maxTokens: number
  maxWallMs?: number
}

export interface GoalUsage {
  turns: number
  tokens: number
  wallMs: number
}

export type GoalStatus = 'active' | 'paused' | 'blocked' | 'completed' | 'failed'

export type GoalTodoStatus = 'pending' | 'in_progress' | 'done' | 'cancelled'

export interface GoalTodo {
  id: string
  content: string
  status: GoalTodoStatus
}

export type GoalPhaseStatus = 'pending' | 'active' | 'done' | 'skipped'

export interface GoalPhase {
  id: string
  title: string
  status: GoalPhaseStatus
  todos: GoalTodo[]
}

export interface GoalEvidence {
  criterionIndex: number
  kind: 'command' | 'file' | 'manual'
  ref: string
  at: number
}

export interface VerificationCommand {
  id: string
  cmd: string
  cwd?: string
}

export interface VerificationRecipe {
  commands: VerificationCommand[]
}

export interface VerificationResultItem {
  id: string
  cmd: string
  exitCode: number
  durationMs: number
  ok: boolean
  stdoutTail?: string
  stderrTail?: string
}

export interface VerificationRunResult {
  ok: boolean
  at: number
  results: VerificationResultItem[]
}

export interface Goal {
  id: string
  description: string
  status: GoalStatus
  successCriteria: string[]
  phases: GoalPhase[]
  activePhaseId: string | null
  budget: GoalBudget
  usage: GoalUsage
  evidence: GoalEvidence[]
  verification?: VerificationRecipe
  lastVerification?: VerificationRunResult
  blockedReason?: string
  createdAt: number
  updatedAt: number
}

export interface GoalDriveResult {
  prompt: string
  goal: Goal
}

export interface GoalCreateInput {
  description: string
  successCriteria: string[]
  phases?: Array<{ title: string; todos?: Array<{ content: string }> }>
  budget?: Partial<GoalBudget>
  verification?: VerificationRecipe
}

export const DEFAULT_GOAL_BUDGET: GoalBudget = {
  maxTurns: 25,
  maxTokens: 200_000,
}

/** Wire / UI snapshot (protocol goal:updated). */
export function goalToWire(goal: Goal | null) {
  if (!goal) return null
  const phase = goal.phases.find((p) => p.id === goal.activePhaseId) ?? goal.phases[0]
  const openTodos = (phase?.todos ?? []).filter((t) => t.status !== 'done' && t.status !== 'cancelled')
  return {
    id: goal.id,
    description: goal.description,
    status: goal.status as 'active' | 'paused' | 'blocked' | 'completed' | 'failed',
    turns: goal.usage.turns,
    maxTurns: goal.budget.maxTurns,
    tokens: goal.usage.tokens,
    maxTokens: goal.budget.maxTokens,
    successCriteria: goal.successCriteria,
    activePhaseTitle: phase?.title,
    openTodoCount: openTodos.length,
    criteriaDone: goal.evidence.length,
    criteriaTotal: goal.successCriteria.length,
    lastVerifyOk: goal.lastVerification?.ok,
  }
}

/** Text block injected into compaction summary seed. */
export function formatGoalProtectedBlock(goal: Goal | null): string {
  if (!goal) return ''
  const phase = goal.phases.find((p) => p.id === goal.activePhaseId) ?? goal.phases[0]
  const lines: string[] = [
    '## Active goal (do not drop)',
    `id: ${goal.id}`,
    `status: ${goal.status}`,
    `description: ${goal.description}`,
    '### Success criteria',
    ...goal.successCriteria.map((c, i) => {
      const done = goal.evidence.some((e) => e.criterionIndex === i)
      return `- [${done ? 'x' : ' '}] ${c}`
    }),
  ]
  if (phase) {
    lines.push(`### Phase: ${phase.title} (${phase.status})`)
    for (const t of phase.todos) {
      lines.push(`- [${t.status === 'done' ? 'x' : ' '}] (${t.status}) ${t.content}`)
    }
  }
  if (goal.lastVerification) {
    lines.push(
      `### Last verification: ${goal.lastVerification.ok ? 'PASS' : 'FAIL'} @ ${new Date(goal.lastVerification.at).toISOString()}`,
    )
    for (const r of goal.lastVerification.results) {
      lines.push(`- ${r.ok ? 'ok' : 'fail'} ${r.cmd} (exit ${r.exitCode})`)
    }
  }
  if (goal.verification?.commands?.length) {
    lines.push('### Verification recipe')
    for (const c of goal.verification.commands) {
      lines.push(`- ${c.id}: ${c.cmd}`)
    }
  }
  return lines.join('\n')
}

export function mapPlanTodoStatus(s: string): GoalTodoStatus {
  if (s === 'completed' || s === 'done') return 'done'
  if (s === 'in_progress') return 'in_progress'
  if (s === 'cancelled') return 'cancelled'
  return 'pending'
}
