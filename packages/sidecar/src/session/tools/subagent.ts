import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import type { DispatchSpec } from './helpers.js'
import { SubagentBatch } from '../subagent-batch.js'
import type { RunSubagentFn } from '../orchestrator-adapter.js'

export interface SubagentTools {
  task: StructuredToolInterface | null
  dispatchAgent: StructuredToolInterface | null
}

export function buildSubagentTools(
  spawnSubagent?: (description: string, mode?: 'foreground' | 'background') => Promise<string>,
  dispatch?: DispatchSpec,
  retrySubagent?: (agentId: string) => Promise<string>,
  stopBackgroundTask?: (taskId: string, reason?: string) => string,
  getBackgroundTaskOutput?: (taskId: string) => string,
): { subagentTools: StructuredToolInterface[]; hasTask: boolean } {
  if (!spawnSubagent) {
    return { subagentTools: [], hasTask: false }
  }

  const task = tool(
    async ({ description, mode }) => {
      const result = await spawnSubagent(description, mode)
      if (!result?.trim()) {
        return (
          'Error: sub-agent produced empty output. ' +
          'Do not treat this as success — retry with a clearer task description, or complete the work yourself.'
        )
      }
      return result
    },
    {
      name: 'task',
      description:
        'Delegate a focused, self-contained sub-task to a fresh sub-agent that runs its own loop ' +
        'with the file tools and returns a text result. Use to isolate research or a chunk of work. ' +
        'The sub-agent cannot itself delegate. Set mode to "background" to run the sub-agent ' +
        'without blocking the current turn (max 10 concurrent background tasks). ' +
        'Do not use for simple single-step requests (greetings, list one directory, read one file).',
      schema: z.object({
        description: z.string(),
        mode: z.enum(['foreground', 'background']).optional(),
      }),
    },
  )

  const tools: StructuredToolInterface[] = [task]

  if (retrySubagent) {
    tools.push(
      tool(async ({ agent_id }) => retrySubagent(agent_id), {
        name: 'task_retry',
        description:
          'Retry a previously failed or interrupted subagent. Re-executes the last turn with the ' +
          'same context. Use when a subagent encountered a tool error or was interrupted. ' +
          'Pass the agentId that was returned by the original task invocation.',
        schema: z.object({
          agent_id: z.string().describe('the subagent id to retry (from the original task result)'),
        }),
      }),
    )
  }

  if (stopBackgroundTask) {
    tools.push(
      tool(async ({ task_id, reason }) => stopBackgroundTask(task_id, reason), {
        name: 'task_stop',
        description:
          'Stop a running background task by its ID. The task will be aborted and its status ' +
          'will be set to "killed". Use this when a background sub-agent is taking too long ' +
          'or is no longer needed. Returns the result of the stop operation.',
        schema: z.object({
          task_id: z.string().describe('the ID of the background task to stop'),
          reason: z.string().optional().describe('optional reason for stopping the task'),
        }),
      }),
    )
  }

  if (getBackgroundTaskOutput) {
    tools.push(
      tool(async ({ task_id }) => getBackgroundTaskOutput(task_id), {
        name: 'task_output',
        description:
          'Read the output produced so far by a background task. Use this to check on ' +
          'the progress or result of a background sub-agent. Works on both running and ' +
          'completed tasks. Returns the accumulated output text.',
        schema: z.object({
          task_id: z.string().describe('the ID of the background task to read output from'),
        }),
      }),
    )
  }

  if (!dispatch || dispatch.agents.length === 0) {
    return { subagentTools: tools, hasTask: true }
  }

  const roster = dispatch.agents
    .map((a) => `- ${a.id} (${a.name})${a.description ? `: ${a.description}` : ''}`)
    .join('\n')
  const ids = dispatch.agents.map((a) => a.id) as [string, ...string[]]

  const dispatchAgent = tool(
    async ({ agent, task: t }) => {
      const result = await dispatch.run(agent, t, dispatch.signal)
      if (!result?.trim()) {
        return (
          'Error: dispatched agent produced empty output. ' +
          'Do not treat this as success — retry with a clearer task, pick another agent, or do the work yourself.'
        )
      }
      return result
    },
    {
      name: 'dispatch_agent',
      description:
        'Delegate a focused, self-contained task to a specialized sub-agent and return its result. ' +
        'Pick the agent best matched to the task. Available agents:\n' +
        roster,
      schema: z.object({
        agent: z.enum(ids).describe('id of the sub-agent to delegate to'),
        task: z.string().describe('the complete, self-contained instruction for the sub-agent'),
      }),
    },
  )

  tools.push(dispatchAgent)
  return { subagentTools: tools, hasTask: true }
}

/**
 * Build the task_batch tool that dispatches multiple subagent tasks in parallel.
 * Returns an empty array when spawnSubagent is not provided (same guard as task/dispatchAgent).
 */
export function buildTaskBatchTools(
  spawnSubagent?: (description: string, mode?: 'foreground' | 'background', taskId?: string, signal?: AbortSignal) => Promise<string>,
): StructuredToolInterface[] {
  if (!spawnSubagent) return []

  const taskBatch = tool(
    async ({ tasks: batchTasks }) => {
      const runner: RunSubagentFn = async (input: string, signal: AbortSignal) => spawnSubagent(input, undefined, undefined, signal)
      const batch = new SubagentBatch(runner)
      const results = await batch.run(
        batchTasks.map((t, i) => ({
          id: String(i),
          prompt: t.prompt,
          description: t.description,
        })),
      )
      return results
        .map((r) => {
          if (r.error) return `[${r.id}] Error: ${r.error}`
          return `[${r.id}] ${r.text}`
        })
        .join('\n\n')
    },
    {
      name: 'task_batch',
      description:
        'Dispatch multiple subagent tasks in parallel and collect all results. ' +
        'Each task runs independently — one task failing does not abort the others. ' +
        'Returns results grouped by task index prefixed with [<index>].',
      schema: z.object({
        tasks: z.array(
          z.object({
            description: z.string(),
            prompt: z.string(),
          }),
        ),
      }),
    },
  )

  return [taskBatch]
}
