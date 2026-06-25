import type { StructuredToolInterface } from '@langchain/core/tools'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { SessionStore } from '../persistence/store.js'

export interface CronSchedule {
  type: 'once' | 'recurring'
  at?: number
  intervalMs?: number
}

export interface CronTask {
  id: string
  prompt: string
  schedule: CronSchedule
  nextFireAt: number
  createdAt: number
}

function jitter(intervalMs: number): number {
  const pct = (Math.random() - 0.5) * 0.1
  return Math.round(intervalMs * (1 + pct))
}

export class CronManager {
  private tasks: Map<string, CronTask> = new Map()
  private loaded = false

  constructor(
    private readonly sessionId: string,
    private readonly store?: SessionStore,
  ) {}

  private ensureLoaded(): void {
    if (this.loaded || !this.store) return
    const rows = this.store.loadCronTasks(this.sessionId)
    for (const r of rows) {
      this.tasks.set(r.id, {
        id: r.id,
        prompt: r.prompt,
        schedule: {
          type: r.scheduleType as 'once' | 'recurring',
          at: r.scheduleAt ?? undefined,
          intervalMs: r.scheduleIntervalMs ?? undefined,
        },
        nextFireAt: r.nextFireAt,
        createdAt: r.createdAt,
      })
    }
    this.loaded = true
  }

  create(prompt: string, schedule: CronSchedule): string {
    this.ensureLoaded()
    const id = `cron-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()
    const nextFireAt = schedule.type === 'once'
      ? (schedule.at ?? now)
      : (schedule.at ?? now + (schedule.intervalMs ?? 60000))

    const task: CronTask = { id, prompt, schedule, nextFireAt, createdAt: now }
    this.tasks.set(id, task)

    if (this.store) {
      this.store.insertCronTask({
        id,
        sessionId: this.sessionId,
        prompt,
        scheduleType: schedule.type,
        scheduleAt: schedule.at ?? null,
        scheduleIntervalMs: schedule.intervalMs ?? null,
        nextFireAt,
        createdAt: now,
      })
    }
    return id
  }

  list(): CronTask[] {
    this.ensureLoaded()
    return [...this.tasks.values()].sort((a, b) => a.createdAt - b.createdAt)
  }

  delete(id: string): boolean {
    this.ensureLoaded()
    const existed = this.tasks.delete(id)
    if (existed && this.store) {
      this.store.deleteCronTask(id)
    }
    return existed
  }

  tick(): string[] {
    this.ensureLoaded()
    const now = Date.now()
    const due: string[] = []

    for (const task of this.tasks.values()) {
      if (now < task.nextFireAt) continue

      due.push(task.prompt)

      if (task.schedule.type === 'recurring' && task.schedule.intervalMs) {
        const nextInterval = jitter(task.schedule.intervalMs)
        task.nextFireAt = now + nextInterval
        if (this.store) {
          this.store.updateCronTaskNextFire(task.id, task.nextFireAt)
        }
      } else {
        this.tasks.delete(task.id)
        if (this.store) {
          this.store.deleteCronTask(task.id)
        }
      }
    }

    return due
  }
}

export function buildCronTools(cronManager: CronManager): StructuredToolInterface[] {
  const createTool = tool(
    async ({ prompt, type, at, interval_ms }) => {
      const schedule: CronSchedule = { type }
      if (type === 'once' && at !== undefined) {
        schedule.at = at
      }
      if (type === 'recurring') {
        if (interval_ms !== undefined) schedule.intervalMs = interval_ms
        if (at !== undefined) schedule.at = at
      }
      const id = cronManager.create(prompt, schedule)
      return `Created cron task ${id} (${type}, next fire at ${new Date(schedule.at ?? Date.now()).toISOString()})`
    },
    {
      name: 'cron_create',
      description:
        'Schedule a self-reminder that will be injected at the start of a future turn. ' +
        'For "once" tasks, set `at` to a Unix-ms timestamp. ' +
        'For "recurring" tasks, set `interval_ms` (e.g. 300000 for 5 min) and optionally `at` for the first fire time.',
      schema: z.object({
        prompt: z.string().describe('The reminder text to inject'),
        type: z.enum(['once', 'recurring']).describe('Schedule type'),
        at: z.number().optional().describe('Absolute fire timestamp in Unix ms (for first fire if recurring)'),
        interval_ms: z.number().optional().describe('Interval in ms between fires (for recurring)'),
      }),
    },
  )

  const listTool = tool(
    async () => {
      const tasks = cronManager.list()
      if (tasks.length === 0) return 'No scheduled cron tasks.'
      return tasks
        .map(
          (t) =>
            `${t.id}: type=${t.schedule.type}, prompt="${t.prompt.slice(0, 80)}${t.prompt.length > 80 ? '...' : ''}", nextFire=${new Date(t.nextFireAt).toISOString()}${t.schedule.type === 'recurring' && t.schedule.intervalMs ? `, every=${t.schedule.intervalMs}ms` : ''}`,
        )
        .join('\n')
    },
    {
      name: 'cron_list',
      description: 'List all scheduled cron tasks (self-reminders) for this session.',
      schema: z.object({}),
    },
  )

  const deleteTool = tool(
    async ({ id }) => {
      const removed = cronManager.delete(id)
      return removed ? `Deleted cron task ${id}.` : `Cron task ${id} not found.`
    },
    {
      name: 'cron_delete',
      description: 'Delete a scheduled cron task by ID. Returns whether the task was found and removed.',
      schema: z.object({
        id: z.string().describe('The cron task ID to delete'),
      }),
    },
  )

  return [createTool, listTool, deleteTool]
}
