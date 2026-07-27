/** Product automation — NOT session CronManager / Workflow DAG. */

export type AutomationTriggerKind = 'manual' | 'daily' | 'weekly'

/**
 * Trigger config. `weekday`: 0=Sunday … 6=Saturday (`Date.getDay()`).
 * UI uses i18n weekday names; does not assume week-start day.
 */
export type AutomationTrigger =
  | { kind: 'manual' }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; weekday: number; hour: number; minute: number }

export type AutomationRunStatus =
  | 'pending'
  | 'running'
  | 'waiting_user' // HITL; NOT terminal for claim release
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled'

export type AutomationRunTrigger = 'manual' | 'schedule' | 'catchup'

/**
 * Known skip / fail error codes (string open for future codes).
 * Cold-start lag≥6h → `app_was_quit`; mid-session lag≥6h → `missed_over_6h`.
 */
export type AutomationErrorCode =
  | 'skip_previous_running'
  | 'skip_global_cap'
  | 'missed_over_6h'
  | 'app_was_quit'
  | 'project_missing'
  | 'project_required'
  | 'no_model_configured'
  | 'model_unresolvable'
  | 'process_interrupted'
  | 'run_threw'
  | 'session_error'
  | (string & {})

export type AutomationPermissionMode = 'chat' | 'edit' | 'full'

export type Automation = {
  id: string
  name: string
  prompt: string
  enabled: boolean
  trigger: AutomationTrigger
  projectPath?: string | null
  /** Optional pin; empty → resolve via activeModelKey at run time */
  llmProvider?: string
  model?: string
  agentId?: string
  effort?: string
  permissionMode?: AutomationPermissionMode
  /** UI metadata only — runtime does not enforce (skill seed honesty) */
  skillIds?: string[]
  templateId?: string | null
  createdAt: number
  updatedAt: number
  lastRunAt?: number | null
  lastStatus?: AutomationRunStatus | null
  lastError?: string | null
  lastSessionId?: string | null
  nextRunAt?: number | null
}

export type AutomationRun = {
  id: string
  automationId: string
  status: AutomationRunStatus
  trigger: AutomationRunTrigger
  sessionId?: string | null
  startedAt: number
  finishedAt?: number | null
  error?: string | null
}

export type AutomationsCatalogV1 = {
  version: 1
  automations: Automation[]
}

export type AutomationRunsLogV1 = {
  version: 1
  runs: AutomationRun[]
}

/** Outcome of schedule evaluation for one automation at `now`. */
export type ScheduleAction = 'noop' | 'fire_due' | 'fire_catchup' | 'skip_miss'

export type ScheduleDecision = {
  action: ScheduleAction
  /** Present when action === 'skip_miss' */
  reason?: 'missed_over_6h' | 'app_was_quit'
}

/**
 * Minimal session fields for completion classification.
 * Matches SessionVM HITL / status surface without importing the store.
 */
export type AutomationSessionSnapshot = {
  status: 'idle' | 'running' | 'error'
  pendingPermission?: unknown | null
  interrupt?: unknown | null
  planApprovalPending?: boolean | null
  error?: { message?: string; code?: string } | null
}

/** classifySessionForAutomation result (waiting_user is non-terminal for claim). */
export type AutomationSessionKind = 'succeeded' | 'failed' | 'waiting_user' | 'in_flight'
