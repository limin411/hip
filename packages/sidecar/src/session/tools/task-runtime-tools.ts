/**
 * wait_tasks, monitor, scheduler_* tools for TaskRuntime.
 */
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import type { BackgroundManager } from '../background-manager.js'
import type { CronManager, CronSchedule } from '../cron.js'
import { isApproved, type ApprovalFn } from './helpers.js'

export function buildWaitTasksTool(runtime: BackgroundManager): StructuredToolInterface {
  return tool(
    async ({ task_ids, mode, timeout_ms }) => {
      const ids = task_ids ?? []
      if (ids.length === 0) return JSON.stringify({ mode: mode ?? 'wait_all', timed_out: false, tasks: [] })
      const result = await runtime.waitMany(
        ids.slice(0, 20),
        mode === 'wait_any' ? 'wait_any' : 'wait_all',
        timeout_ms,
      )
      return JSON.stringify(result)
    },
    {
      name: 'wait_tasks',
      description:
        'Wait for one or more background tasks (shell, agent, monitor) to complete. ' +
        'mode wait_any returns when the first settles; wait_all waits for all (default). ' +
        'timeout_ms optional — on timeout children keep running. Prefer this over sleep-polling.',
      schema: z.object({
        task_ids: z.array(z.string()).describe('task ids from run_script background / task / monitor'),
        mode: z.enum(['wait_any', 'wait_all']).optional(),
        timeout_ms: z.number().optional(),
      }),
    },
  )
}

export function buildMonitorTool(
  runtime: BackgroundManager,
  requestApproval: ApprovalFn,
  cwd: string,
): StructuredToolInterface {
  return tool(
    async ({ command, description, persistent, timeout_ms }) => {
      const decision = await requestApproval({
        title: 'Start monitor',
        toolName: 'monitor',
        kind: 'execute',
        content: `${command}\n\n# ${description}`,
      })
      if (!isApproved(decision)) {
        return '用户拒绝启动 monitor（command was rejected by the user; nothing ran）。'
      }
      const started = runtime.spawnMonitor({
        command,
        cwd,
        description,
        persistent: persistent ?? false,
        timeoutMs: timeout_ms,
      })
      if ('error' in started) return started.error
      return JSON.stringify({
        task_id: started.taskId,
        kind: 'monitor',
        status: 'running',
        message:
          'Monitor started. Lines stream as task:event (UI). Use task_output to read accumulated lines; task_stop to end.',
      })
    },
    {
      name: 'monitor',
      description:
        'Start a background monitor that streams stdout lines as events (not injected into the model). ' +
        'Use tight filters (grep --line-buffered). Set persistent true for session-lifetime watches. ' +
        'Stop with task_stop. Prefer over sleep-poll loops.',
      schema: z.object({
        command: z.string(),
        description: z.string().describe('short label shown in Runtime panel and notifications'),
        persistent: z.boolean().optional(),
        timeout_ms: z.number().optional().describe('default 10h when not persistent'),
      }),
    },
  )
}

export function buildSchedulerTools(
  cron: CronManager,
  runtime: BackgroundManager,
): StructuredToolInterface[] {
  const create = tool(
    async ({ prompt, interval, fire_immediately, foreground }) => {
      const intervalMs = parseIntervalMs(interval)
      if (intervalMs == null) {
        return 'Error: invalid interval (use e.g. 5m, 2h, 60s, 1d; min 60s)'
      }
      const schedule: CronSchedule = {
        type: 'recurring',
        intervalMs,
        at: fire_immediately ? Date.now() : Date.now() + intervalMs,
      }
      const id = cron.create(prompt, schedule, {
        foreground: foreground ?? false,
        durable: false,
      })
      const task = cron.list().find((t) => t.id === id)
      runtime.upsertSchedule({
        id,
        prompt,
        nextFireAt: task?.nextFireAt,
        description: prompt.slice(0, 80),
      })
      // stash foreground on mirror metrics via detail
      const m = runtime.meta.get(id)
      if (m) m.detail = foreground ? 'foreground' : 'background'
      return JSON.stringify({
        task_id: id,
        kind: 'schedule',
        status: 'scheduled',
        interval_ms: intervalMs,
        next_fire_at: task?.nextFireAt,
        message: 'Schedule created. Fires wake the agent when due (schedulerWake).',
      })
    },
    {
      name: 'scheduler_create',
      description:
        'Create a recurring scheduled prompt (min interval 60s). ' +
        'interval: 60s|5m|2h|1d. fire_immediately runs soon. ' +
        'foreground true enqueues a main-turn wake; default false runs a background subagent.',
      schema: z.object({
        prompt: z.string(),
        interval: z.string(),
        fire_immediately: z.boolean().optional(),
        foreground: z.boolean().optional(),
      }),
    },
  )

  const list = tool(
    async () => {
      const rows = cron.list().map((t) => ({
        id: t.id,
        prompt: t.prompt.slice(0, 200),
        nextFireAt: t.nextFireAt,
        type: t.schedule.type,
        foreground: t.foreground ?? false,
      }))
      return JSON.stringify({ schedules: rows })
    },
    {
      name: 'scheduler_list',
      description: 'List active scheduled tasks with next fire times.',
      schema: z.object({}),
    },
  )

  const del = tool(
    async ({ id }) => {
      const ok = cron.delete(id)
      runtime.deleteSchedule(id)
      return ok ? `Deleted schedule ${id}` : `Error: schedule ${id} not found`
    },
    {
      name: 'scheduler_delete',
      description: 'Cancel a scheduled task by id.',
      schema: z.object({ id: z.string() }),
    },
  )

  // Aliases for grok/cron compatibility
  const cronCreate = tool(
    async ({ prompt, type, at, interval_ms }) => {
      const schedule: CronSchedule = { type }
      if (type === 'once' && at !== undefined) schedule.at = at
      if (type === 'recurring') {
        if (interval_ms !== undefined) schedule.intervalMs = interval_ms
        if (at !== undefined) schedule.at = at
      }
      const id = cron.create(prompt, schedule)
      const task = cron.list().find((t) => t.id === id)
      runtime.upsertSchedule({ id, prompt, nextFireAt: task?.nextFireAt })
      return `Created cron task ${id} (${type})`
    },
    {
      name: 'cron_create',
      description:
        'Schedule a reminder. Prefer scheduler_create for recurring interval strings. ' +
        'For once: set at Unix-ms. For recurring: interval_ms.',
      schema: z.object({
        prompt: z.string(),
        type: z.enum(['once', 'recurring']),
        at: z.number().optional(),
        interval_ms: z.number().optional(),
      }),
    },
  )

  const cronList = tool(
    async () => JSON.stringify(cron.list()),
    {
      name: 'cron_list',
      description: 'List cron tasks (alias of scheduler_list).',
      schema: z.object({}),
    },
  )

  const cronDelete = tool(
    async ({ id }) => {
      const ok = cron.delete(id)
      runtime.deleteSchedule(id)
      return ok ? `Deleted ${id}` : `Error: ${id} not found`
    },
    {
      name: 'cron_delete',
      description: 'Delete a cron task by id.',
      schema: z.object({ id: z.string() }),
    },
  )

  return [create, list, del, cronCreate, cronList, cronDelete]
}

function parseIntervalMs(raw: string): number | null {
  const m = raw.trim().match(/^(\d+)\s*([smhd])$/i)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = m[2]!.toLowerCase()
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000
  const ms = n * mult
  if (ms < 60_000) return null
  return ms
}

export function buildTaskRuntimeExtraTools(opts: {
  runtime: BackgroundManager
  cron: CronManager
  requestApproval?: ApprovalFn
  cwd: string
  mode: string
  monitorEnabled?: boolean
  schedulerEnabled?: boolean
}): StructuredToolInterface[] {
  const tools: StructuredToolInterface[] = [buildWaitTasksTool(opts.runtime)]
  if (opts.monitorEnabled !== false && opts.requestApproval && opts.mode !== 'chat') {
    tools.push(buildMonitorTool(opts.runtime, opts.requestApproval, opts.cwd))
  }
  if (opts.schedulerEnabled !== false && opts.mode !== 'chat') {
    tools.push(...buildSchedulerTools(opts.cron, opts.runtime))
  }
  return tools
}
