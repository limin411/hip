import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import type { GoalManager, GoalStatus } from '../goal.js'

const goalStatusSchema = z.enum(['active', 'paused', 'completed'])

export function buildGoalTools(goalManager: GoalManager): StructuredToolInterface[] {
  const goalCreate = tool(
    async ({ description, max_turns, max_tokens }) => {
      const budget: { maxTurns?: number; maxTokens?: number } = {}
      if (max_turns !== undefined) budget.maxTurns = max_turns
      if (max_tokens !== undefined) budget.maxTokens = max_tokens
      const goal = goalManager.createGoal(description, budget)
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
        const goal = goalManager.getStatus()!
        return `Goal resumed: "${goal.description}"`
      }
      const ok = goalManager.updateGoal(status)
      if (!ok) {
        return 'No goal currently exists.'
      }
      const goal = goalManager.getStatus()!
      return `Goal status updated to "${status}": "${goal.description}"`
    },
    {
      name: 'goal_update',
      description:
        'Update the status of the current goal. Set to "paused" to temporarily stop ' +
        'auto-continuation, "active" to resume a paused goal, or "completed" to finish the goal.',
      schema: z.object({
        status: goalStatusSchema.describe(
          'New goal status: "active" (resume paused goal), "paused" (stop auto-continue), ' +
          'or "completed" (finish the goal)',
        ),
      }),
    },
  )

  return [goalCreate, goalStatus, goalUpdate]
}
