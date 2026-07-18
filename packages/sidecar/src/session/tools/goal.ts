import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import type { Goal, GoalManager, GoalStatus } from '../goal.js'

const goalStatusSchema = z.enum(['active', 'paused', 'blocked', 'completed'])

export type GoalUpdatedEmit = (goal: Goal | null) => void

function snapshot(goal: Goal | null) {
  if (!goal) return null
  return {
    id: goal.id,
    description: goal.description,
    status: goal.status as 'active' | 'paused' | 'blocked' | 'completed',
    turns: goal.usage.turns,
    maxTurns: goal.budget.maxTurns,
    tokens: goal.usage.tokens,
    maxTokens: goal.budget.maxTokens,
  }
}

export function buildGoalTools(
  goalManager: GoalManager,
  onGoalUpdated?: GoalUpdatedEmit,
): StructuredToolInterface[] {
  const emit = () => onGoalUpdated?.(goalManager.getStatus())

  const goalCreate = tool(
    async ({ description, max_turns, max_tokens }) => {
      const budget: { maxTurns?: number; maxTokens?: number } = {}
      if (max_turns !== undefined) budget.maxTurns = max_turns
      if (max_tokens !== undefined) budget.maxTokens = max_tokens
      const goal = goalManager.createGoal(description, budget)
      emit()
      return `Goal created: "${goal.description}" (id: ${goal.id})\n` +
        `Budget: ${goal.budget.maxTurns} turns, ${goal.budget.maxTokens.toLocaleString()} tokens\n` +
        `Status: ${goal.status}`
    },
    {
      name: 'goal_create',
      description:
        'Create a persistent goal with a turn+token budget. While active, the agent will ' +
        'auto-continue after each turn until the goal is complete or the budget is exhausted. ' +
        'Use this for multi-turn tasks that require sustained autonomous execution. ' +
        'Only one goal can be active at a time.',
      schema: z.object({
        description: z.string().describe('What the agent should accomplish across multiple turns'),
        max_turns: z.number().int().min(1).max(100).optional()
          .describe('Maximum auto-continue turns before pausing (default: 25)'),
        max_tokens: z.number().int().min(1000).optional()
          .describe('Maximum total tokens before pausing (default: 200000)'),
      }),
    },
  )

  const goalStatus = tool(
    async () => {
      const goal = goalManager.getStatus()
      if (!goal) {
        return 'No goal is currently set. Use goal_create to start a new goal.'
      }
      return `Goal: "${goal.description}" (id: ${goal.id})\n` +
        `Status: ${goal.status}\n` +
        `Budget: ${goal.budget.maxTurns} turns, ${goal.budget.maxTokens.toLocaleString()} tokens\n` +
        `Usage: ${goal.usage.turns} turns used, ${goal.usage.tokens.toLocaleString()} tokens used\n` +
        `Created: ${new Date(goal.createdAt).toISOString()}`
    },
    {
      name: 'goal_status',
      description:
        'Check the current goal status, budget, and usage. Returns null if no goal is active.',
      schema: z.object({}),
    },
  )

  const goalUpdate = tool(
    async ({ status }) => {
      if (status === 'active') {
        const resumed = goalManager.resumePausedGoal()
        if (!resumed) {
          return 'No paused goal to resume. Use goal_create to start a new goal.'
        }
        emit()
        const goal = goalManager.getStatus()!
        return `Goal resumed: "${goal.description}"`
      }
      if (status === 'completed') {
        const g = goalManager.getStatus()
        if (!g) return 'No goal currently exists.'
        const desc = g.description
        goalManager.completeAndClear()
        onGoalUpdated?.(null)
        return `Goal status updated to "completed": "${desc}"`
      }
      const ok = goalManager.updateGoal(status as GoalStatus)
      if (!ok) {
        return 'No goal currently exists.'
      }
      emit()
      const goal = goalManager.getStatus()!
      return `Goal status updated to "${status}": "${goal.description}"`
    },
    {
      name: 'goal_update',
      description:
        'Update the status of the current goal. Set to "paused" or "blocked" to stop ' +
        'auto-continuation, "active" to resume, or "completed" to finish and clear the goal.',
      schema: z.object({
        status: goalStatusSchema.describe(
          'New goal status: "active" (resume), "paused"/"blocked" (stop auto-continue), ' +
          'or "completed" (finish the goal)',
        ),
      }),
    },
  )

  return [goalCreate, goalStatus, goalUpdate]
}

export { snapshot as goalSnapshotForWire }
