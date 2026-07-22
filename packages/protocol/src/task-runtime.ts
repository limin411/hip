/**
 * Wire types for the unified TaskRuntime (shell / agent / monitor / schedule).
 * Internal-only fields (AbortController, kill hooks, full outputChunks) never appear here.
 *
 * Spec: docs/design/2026-07-22-async-task-runtime-right-panel.md (PR1)
 */

/** Runtime task kind on the wire and in tool JSON. */
export type TaskKind = 'shell' | 'agent' | 'monitor' | 'schedule'

/**
 * Lifecycle status for a runtime task.
 * - `scheduled` — schedule definition waiting for next fire
 * - `suppressed` — monitor auto-killed for volume
 * - `lost` — reconciled after crash / disconnect without clean terminal status
 */
export type TaskStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'killed'
  | 'lost'
  | 'scheduled'
  | 'suppressed'

/** Optional metrics shared by snapshot and tool output. */
export interface TaskMetrics {
  bytes?: number
  lines?: number
  fires?: number
  nextFireAt?: number
  suppressedLines?: number
  /** Schedule fire skipped due to concurrency caps (cumulative). */
  skipCount?: number
}

/** Session-scoped running counts for still-running chip / Runtime tab badge. */
export interface TaskRunningCounts {
  shell: number
  agent: number
  monitor: number
  schedule: number
}

/**
 * Wire snapshot of a single runtime task (WS `task:snapshot` / `task:delta`).
 * No abortController, kill hooks, or full output buffers.
 */
export interface TaskSnapshot {
  id: string
  kind: TaskKind
  description: string
  status: TaskStatus
  createdAt: number
  updatedAt: number
  detail?: string
  pid?: number | null
  exitCode?: number | null
  metrics?: TaskMetrics
  originTurnId?: string | null
  originToolCallId?: string | null
  /** Last ~2KB only; full log via `task:getOutput`. */
  logTail?: string
}

/**
 * Structured tool-return / `task:getOutput:result` payload.
 * Agent kind may still return plain text for backward compat when JSON parse fails.
 */
export interface TaskOutputPayload {
  task_id: string
  kind: TaskKind
  status: TaskStatus
  exit_code?: number | null
  output?: string
  bytes?: number
  truncated?: boolean
  lines?: number
  suppressed_lines?: number
  message?: string
  error?: string
}

/** `wait_tasks` tool JSON return (also usable by future RPC). */
export interface WaitTasksPayload {
  mode: 'wait_any' | 'wait_all'
  timed_out: boolean
  tasks: TaskOutputPayload[]
}

/** Terminal statuses allowed on `task:notification` (not schedule "fired"). */
export type TaskNotificationStatus =
  | 'completed'
  | 'failed'
  | 'killed'
  | 'suppressed'
  | 'lost'

const TASK_KINDS: readonly TaskKind[] = ['shell', 'agent', 'monitor', 'schedule'] as const
const TASK_STATUSES: readonly TaskStatus[] = [
  'running',
  'completed',
  'failed',
  'killed',
  'lost',
  'scheduled',
  'suppressed',
] as const

export function isTaskKind(v: unknown): v is TaskKind {
  return typeof v === 'string' && (TASK_KINDS as readonly string[]).includes(v)
}

export function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === 'string' && (TASK_STATUSES as readonly string[]).includes(v)
}

export function emptyTaskRunningCounts(): TaskRunningCounts {
  return { shell: 0, agent: 0, monitor: 0, schedule: 0 }
}
