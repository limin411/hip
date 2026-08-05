import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import type { Goal, GoalManager, GoalStatus } from '../goal.js'
import { goalToWire } from '../goal-types.js'

const goalStatusSchema = z.enum(['active', 'paused', 'blocked', 'completed', 'failed'])

export type GoalUpdatedEmit = (goal: Goal | null) => void

function snapshot(goal: Goal | null) {
  return goalToWire(goal)
}

export function buildGoalTools(
  goalManager: GoalManager,
  onGoalUpdated?: GoalUpdatedEmit,
  runVerification?: () => Promise<{ ok: boolean; detail: string }>,
): StructuredToolInterface[] {
  const emit = () => onGoalUpdated?.(goalManager.getStatus())

  const goalCreate = tool(
    async ({ description, success_criteria, max_turns, max_tokens, phase_titles }) => {
      const criteria =
        success_criteria && success_criteria.length > 0
          ? success_criteria
          : [description]
      try {
        const goal = goalManager.create({
          description,
          successCriteria: criteria,
          budget: {
            ...(max_turns !== undefined ? { maxTurns: max_turns } : {}),
            ...(max_tokens !== undefined ? { maxTokens: max_tokens } : {}),
          },
          phases: phase_titles?.map((title) => ({ title })),
        })
        emit()
        return (
          `Goal created: "${goal.description}" (id: ${goal.id})\n` +
          `Criteria (${goal.successCriteria.length}):\n` +
          goal.successCriteria.map((c, i) => `  ${i + 1}. ${c}`).join('\n') +
          `\nBudget: ${goal.budget.maxTurns} turns, ${goal.budget.maxTokens.toLocaleString()} tokens\n` +
          `Status: ${goal.status}`
        )
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
    {
      name: 'goal_create',
      description:
        'Create a durable multi-turn goal with success criteria. While active, the agent auto-continues ' +
        'after each turn until complete or budget exhausted. Prefer explicit success_criteria for long tasks. ' +
        'Only one goal per session.',
      schema: z.object({
        description: z.string().describe('What the agent should accomplish'),
        success_criteria: z
          .array(z.string())
          .min(1)
          .optional()
          .describe('Checklist of done-when items (default: [description])'),
        phase_titles: z.array(z.string()).optional().describe('Optional ordered phase titles'),
        max_turns: z.number().int().min(1).max(100).optional(),
        max_tokens: z.number().int().min(1000).optional(),
      }),
    },
  )

  const goalStatus = tool(
    async () => {
      const goal = goalManager.getStatus()
      if (!goal) return 'No goal is currently set. Use goal_create to start a new goal.'
      const wire = goalToWire(goal)!
      const phase = goal.phases.find((p) => p.id === goal.activePhaseId)
      return [
        `Goal: "${goal.description}" (${goal.id})`,
        `Status: ${goal.status}${goal.blockedReason ? ` (${goal.blockedReason})` : ''}`,
        `Budget: ${goal.usage.turns}/${goal.budget.maxTurns} turns, ${goal.usage.tokens.toLocaleString()}/${goal.budget.maxTokens.toLocaleString()} tokens`,
        `Criteria done: ${wire.criteriaDone}/${wire.criteriaTotal}`,
        ...goal.successCriteria.map((c, i) => {
          const done = goal.evidence.some((e) => e.criterionIndex === i)
          return `  [${done ? 'x' : ' '}] ${c}`
        }),
        phase ? `Phase: ${phase.title}` : '',
        phase?.todos?.length
          ? phase.todos.map((t) => `  - (${t.status}) ${t.content}`).join('\n')
          : '',
        goal.lastVerification
          ? `Last verify: ${goal.lastVerification.ok ? 'PASS' : 'FAIL'}`
          : 'Last verify: (none)',
      ]
        .filter(Boolean)
        .join('\n')
    },
    {
      name: 'goal_status',
      description: 'Check goal status, criteria, phase todos, and last verification.',
      schema: z.object({}),
    },
  )

  const goalUpdate = tool(
    async ({ status }) => {
      if (status === 'active') {
        const resumed = goalManager.resumePausedGoal()
        if (!resumed) return 'No paused/blocked goal to resume. Use goal_create to start a new goal.'
        emit()
        return `Goal resumed: "${goalManager.getStatus()!.description}"`
      }
      if (status === 'completed') {
        const g = goalManager.getStatus()
        if (!g) return 'No goal currently exists.'
        const desc = g.description
        const ok = goalManager.tryComplete()
        if (!ok) {
          emit()
          return (
            `Cannot complete goal "${desc}": verification required and last run did not pass. ` +
            `Call verification_run first, or goal_update status=paused.`
          )
        }
        onGoalUpdated?.(null)
        return `Goal status updated to "completed": "${desc}"`
      }
      const ok = goalManager.updateGoal(status as GoalStatus)
      if (!ok) return 'No goal currently exists.'
      emit()
      return `Goal status updated to "${status}": "${goalManager.getStatus()!.description}"`
    },
    {
      name: 'goal_update',
      description:
        'Update goal status: active (resume), paused/blocked (stop auto-continue), completed (finish; requires verification when recipe set).',
      schema: z.object({
        status: goalStatusSchema,
      }),
    },
  )

  const tools: StructuredToolInterface[] = [goalCreate, goalStatus, goalUpdate]

  if (runVerification) {
    tools.push(
      tool(
        async () => {
          const goal = goalManager.getStatus()
          if (!goal) return 'No active goal — create one first or run tests directly via run_script.'
          const result = await runVerification()
          emit()
          return result.detail
        },
        {
          name: 'verification_run',
          description:
            'Run the goal verification recipe (or auto-detected project tests). Required before goal_complete when a recipe exists. Updates goal evidence on success.',
          schema: z.object({}),
        },
      ),
    )
  }

  return tools
}

export { snapshot as goalSnapshotForWire }
