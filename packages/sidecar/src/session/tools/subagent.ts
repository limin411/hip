import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import type { DispatchSpec } from './helpers.js'
import { SubagentBatch, type BatchRunSubagentFn } from '../subagent-batch.js'
import { isSubagentPausedText, isUselessSubagentText } from '../subagent-result.js'

export interface SubagentTools {
  task: StructuredToolInterface | null
  dispatchAgent: StructuredToolInterface | null
}

export function buildSubagentTools(
  spawnSubagent?: (
    description: string,
    mode?: 'foreground' | 'background',
    taskId?: string,
    signal?: AbortSignal,
    isolate?: boolean,
  ) => Promise<string>,
  dispatch?: DispatchSpec,
  retrySubagent?: (agentId: string) => Promise<string>,
  stopBackgroundTask?: (taskId: string, reason?: string) => string,
  getBackgroundTaskOutput?: (taskId: string, timeoutMs?: number) => string | Promise<string>,
): { subagentTools: StructuredToolInterface[]; hasTask: boolean } {
  if (!spawnSubagent) {
    return { subagentTools: [], hasTask: false }
  }

  const task = tool(
    async ({ description, mode, isolate }) => {
      const result = await spawnSubagent(description, mode, undefined, undefined, isolate)
      // Pause is a distinct outcome — pass through; do not rewrite as empty-success error.
      if (isSubagentPausedText(result)) return result
      if (isUselessSubagentText(result)) {
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
        'Delegate ONE focused sub-task to a generic sub-agent (blocking unless mode is background). ' +
        'Foreground mode waits for the full result. Prefer task_batch when you have 2+ independent sub-tasks. ' +
        'Set mode to "background" only for fire-and-forget (max 10 concurrent); use task_output/task_stop to follow up. ' +
        'Set isolate=true to run in a git worktree under ~/.hip/isolation (parallel-safe). ' +
        'Do not use for simple single-step requests (greetings, list one directory, read one file).',
      schema: z.object({
        description: z.string(),
        mode: z.enum(['foreground', 'background']).optional(),
        isolate: z.boolean().optional().describe('Run in an isolated git worktree'),
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
      tool(
        async ({ task_id, timeout_ms }) => {
          // When timeout_ms is set, wait for completion first (via wait_tasks semantics in host).
          if (typeof timeout_ms === 'number' && timeout_ms > 0) {
            const waited = await (getBackgroundTaskOutput as (
              id: string,
              timeoutMs?: number,
            ) => string | Promise<string>)(task_id, timeout_ms)
            return waited
          }
          return getBackgroundTaskOutput(task_id)
        },
        {
          name: 'task_output',
          description:
            'Read the output produced so far by a background task (shell, agent, monitor). ' +
            'Works on running and completed tasks. Optional timeout_ms waits for completion ' +
            '(task keeps running on timeout). Prefer wait_tasks for multiple ids.',
          schema: z.object({
            task_id: z.string().describe('the ID of the background task to read output from'),
            timeout_ms: z
              .number()
              .optional()
              .describe('wait up to this many ms for the task to finish before returning output'),
          }),
        },
      ),
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
      // Pause is a distinct outcome — pass through; do not rewrite as empty-success error.
      if (isSubagentPausedText(result)) return result
      if (isUselessSubagentText(result)) {
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
        'Delegate ONE focused task to a specialized sub-agent and wait for its result (blocking). ' +
        'For 2+ independent specialized tasks, prefer task_batch with per-task agent instead of multiple ' +
        'dispatch_agent calls. Emitting several dispatch_agent calls in the same tool-call batch may run ' +
        'them in parallel; sequential turns are always serial. Available agents:\n' +
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
 *
 * When `dispatch` is provided, each task may set optional `agent` to a roster id (e.g. explore);
 * those run via dispatch.run. Tasks without agent use generic spawnSubagent workers.
 *
 * Each task line is `[id] ${text}`. Pause detection accepts that prefix on the first line
 * (`isSubagentPausedText`), so a single-task (or first-task) pause remains detectable on the
 * aggregate ToolMessage. Multi-task pause on a non-first segment still needs per-segment scan (B4).
 */
export function buildTaskBatchTools(
  spawnSubagent?: (
    description: string,
    mode?: 'foreground' | 'background',
    taskId?: string,
    signal?: AbortSignal,
    isolate?: boolean,
  ) => Promise<string>,
  dispatch?: DispatchSpec,
): StructuredToolInterface[] {
  if (!spawnSubagent) return []

  const rosterIds = new Set((dispatch?.agents ?? []).map((a) => a.id))
  const rosterHint =
    rosterIds.size > 0
      ? ` Optional per-task agent (one of: ${[...rosterIds].join(', ')}) routes to that specialized agent; ` +
        'omit agent for a generic worker. Prefer explore for parallel read-only research.'
      : ' Tasks use generic workers (no specialized roster).'

  const taskBatch = tool(
    async ({ tasks: batchTasks, isolate }) => {
      const runner: BatchRunSubagentFn = async (task, signal) => {
        const agent = task.agent?.trim()
        if (agent && dispatch) {
          if (!rosterIds.has(agent)) {
            throw new Error(`unknown or disabled agent "${agent}" for task_batch`)
          }
          return dispatch.run(agent, task.prompt, signal)
        }
        return spawnSubagent(task.prompt, undefined, undefined, signal, isolate === true)
      }
      const batch = new SubagentBatch(runner)
      const results = await batch.run(
        batchTasks.map((t, i) => ({
          id: String(i),
          prompt: t.prompt,
          description: t.description,
          ...(t.agent ? { agent: t.agent } : {}),
        })),
      )
      return results
        .map((r) => {
          if (r.error) return `[${r.id}] Error: ${r.error}`
          // Per-task text may already be a pause marker; keep `[id] ` prefix for grouping.
          // isSubagentPausedText accepts the prefix on the first line.
          return `[${r.id}] ${r.text}`
        })
        .join('\n\n')
    },
    {
      name: 'task_batch',
      description:
        'PREFERRED for 2+ independent sub-tasks: dispatch them in parallel and collect all results. ' +
        'Runs up to HIP_SUBAGENT_MAX_CONCURRENCY concurrent workers (default 4). ' +
        'Each task runs independently — one failing does not abort the others. ' +
        'Returns results grouped by task index prefixed with [<index>].' +
        rosterHint +
        ' Set isolate=true so each generic worker gets its own git worktree. ' +
        ' For concurrent write/edit work on the same tree prefer serial tasks or isolate=true.',
      schema: z.object({
        isolate: z.boolean().optional().describe('Isolate each generic worker in a git worktree'),
        tasks: z.array(
          z.object({
            description: z.string().describe('short label for the sub-task'),
            prompt: z.string().describe('full self-contained instruction for the sub-agent'),
            agent: z
              .string()
              .optional()
              .describe(
                'optional specialized agent id (e.g. explore, plan, coder) when a roster is available',
              ),
          }),
        ),
      }),
    },
  )

  return [taskBatch]
}
