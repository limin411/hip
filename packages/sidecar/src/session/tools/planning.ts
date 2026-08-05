import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'

export type WriteTodosHook = (todos: Array<{ content: string; status: string }>) => void

export function buildPlanningTools(onWriteTodos?: WriteTodosHook): StructuredToolInterface[] {
  const writeTodos = tool(
    async ({ todos }) => {
      onWriteTodos?.(todos)
      const done = todos.filter((t) => t.status === 'completed').length
      return `Updated todo list (${todos.length} item${todos.length === 1 ? '' : 's'}, ${done} done).`
    },
    {
      name: 'write_todos',
      description:
        'Publish or replace your plan for THIS turn as a checklist. Call it once at the start of a ' +
        'multi-step task and again whenever the plan changes — each call REPLACES the whole list. ' +
        '`todos` is an ordered array of { content, status } where status is "pending", "in_progress", ' +
        'or "completed". Keep at most one item "in_progress". When a durable goal is active, todos ' +
        'are bound to the current goal phase. Skip this for simple, single-step requests.',
      schema: z.object({
        todos: z.array(
          z.object({
            content: z.string(),
            status: z.enum(['pending', 'in_progress', 'completed']),
          }),
        ),
      }),
    },
  )

  return [writeTodos]
}
