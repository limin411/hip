/** Eval task pack types (UI-first capability evaluation). schemaVersion 1 + matrix extensions. */

export type WorkspaceStrategy = 'worktree' | 'copy'

export type EvalLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5'

export type FailureTagV1 =
  | 'pass'
  | 'infra_prepare'
  | 'ui_launch_fail'
  | 'ui_bind_fail'
  | 'no_api_key'
  | 'timeout'
  | 'permission_stuck'
  | 'empty_change'
  | 'ui_changes_missing'
  | 'wrong_file'
  | 'incomplete_fix'
  | 'verify_failed'
  | 'primary_tree_mutated'
  | 'awaiting_user'
  | 'cancelled'
  | 'plan_skipped'
  | 'unknown'

export type SoftCheck =
  | { kind: 'change_nonempty' }
  | { kind: 'paths_touched_regex'; pattern: string }
  | { kind: 'paths_avoid_regex'; pattern: string }
  | { kind: 'assistant_text_regex'; pattern: string }
  | { kind: 'min_paths'; count: number }
  | { kind: 'tool_name_seen'; name: string }
  | { kind: 'plan_approved_required' }

export type PlanMode = 'forbid' | 'allow' | 'prefer' | 'require'

export type PassPolicy = 'verify_all' | 'verify_or_text' | 'safety_only'

export interface TaskSpec {
  schemaVersion: 1
  id: string
  name: string
  prompt: string
  language?: string
  difficulty?: 'easy' | 'medium' | 'hard'
  level?: EvalLevel
  tags?: string[]
  workspace: {
    strategy?: WorkspaceStrategy
    repo_path?: string
    repo_path_env?: string
    base_sha?: string
    base_ref?: string
    setup?:
      | { kind: 'none' }
      | { kind: 'patch'; path: string }
      | { kind: 'script'; path: string }
  }
  ui: {
    surface?: 'code' | 'chat'
    permission_mode?: 'chat' | 'edit' | 'full'
    timeout_ms?: number
    auto_approve_permissions?: boolean
    /** Max auto-resume messages on chat-interrupt (default 2). */
    auto_resume_interrupt?: number
    plan_mode?: PlanMode
    multi_turn?: Array<{ role: 'user'; content: string; when?: 'start' | 'on_interrupt' }>
    expect?: {
      changes_paths_regex?: string[]
      changes_avoid_regex?: string[]
      assistant_text_regex?: string | null
      no_permission_modal_stuck?: boolean
    }
  }
  verify?: {
    commands?: Array<{ cmd: string[]; cwd?: string; env?: Record<string, string> }>
    soft?: SoftCheck[]
    timeout_sec?: number
  }
  rubric?: {
    axes: string[]
    pass_policy?: PassPolicy
  }
  scoring?: {
    pass_requires?: 'verify_all' | 'safety_guard'
    require_plan_approved?: boolean
    partial_credit?: boolean
  }
  metadata?: Record<string, unknown>
}

export interface PackManifest {
  schemaVersion: 1
  id: string
  name: string
  description?: string
  defaults?: {
    workspace?: Partial<TaskSpec['workspace']>
    ui?: Partial<TaskSpec['ui']>
    verify?: Partial<NonNullable<TaskSpec['verify']>>
    scoring?: Partial<NonNullable<TaskSpec['scoring']>>
    rubric?: Partial<NonNullable<TaskSpec['rubric']>>
  }
  tasks: string[]
}

export interface PrimaryGuardSnapshot {
  porcelain: string
  head: string
}

export interface PreparedWorkspace {
  runId: string
  taskId: string
  strategy: WorkspaceStrategy
  repoPath: string
  cwd: string
  baseSha: string
  branch: string
  primaryGuardBefore: PrimaryGuardSnapshot
  kept: boolean
}

export interface VerifyCommandResult {
  cmd: string[]
  exitCode: number
  durationMs: number
  logPath: string
  stdout: string
  stderr: string
}

export interface ChangeInventory {
  dirtyAfter: boolean
  agentTouched?: boolean
  paths: string[]
  fullPatch: string
  trackedPatch: string
}

export interface UiTurnOutcome {
  settled: boolean
  timedOut: boolean
  assistantText: string
  changesPaths: string[]
  permissionModalStuck: boolean
  awaitingUser: boolean
  errorHints: string[]
  planApproved?: boolean
  interruptResumes?: number
}

export interface ScoreInput {
  prepareOk: boolean
  prepareError?: string
  ui: UiTurnOutcome
  inventory: ChangeInventory
  verify: {
    ran: boolean
    skippedReason?: string
    results: VerifyCommandResult[]
  }
  primaryMutated: boolean
  expect?: TaskSpec['ui']['expect']
  soft?: SoftCheck[]
  scoring?: TaskSpec['scoring']
  rubric?: TaskSpec['rubric']
  toolNames?: string[]
}

export interface ScoreResult {
  passed: boolean
  tags: FailureTagV1[]
  notes: string[]
  verifyPassed: boolean
  axes?: string[]
  planApproved?: boolean
  interruptResumes?: number
}

export interface RunReport {
  schemaVersion: 1
  runId: string
  taskId: string
  packId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  workspace: {
    strategy: WorkspaceStrategy
    repoPath: string
    cwd: string
    baseSha: string
    kept: boolean
    primaryGuard: {
      beforePorcelain: string
      afterPorcelain: string
      headBefore: string
      headAfter: string
      mutated: boolean
    }
  }
  ui: UiTurnOutcome
  changes: ChangeInventory
  verify: {
    ran: boolean
    skippedReason?: string
    passed: boolean
    results: VerifyCommandResult[]
  }
  score: ScoreResult
  artifacts: {
    dir: string
    report: string
  }
}

export interface AxisCluster {
  byAxis: Record<string, { total: number; passed: number; failed: number; tags: Record<string, number> }>
  byTask: Record<string, { passed: boolean; tags: string[]; axes: string[] }>
  reports: string[]
}
