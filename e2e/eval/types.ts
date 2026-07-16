/** Eval task pack types (UI-first capability evaluation). schemaVersion 1. */

export type WorkspaceStrategy = 'worktree' | 'copy'

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
  | 'unknown'

export type SoftCheck =
  | { kind: 'change_nonempty' }
  | { kind: 'paths_touched_regex'; pattern: string }
  | { kind: 'paths_avoid_regex'; pattern: string }
  | { kind: 'assistant_text_regex'; pattern: string }

export interface TaskSpec {
  schemaVersion: 1
  id: string
  name: string
  prompt: string
  language?: string
  difficulty?: 'easy' | 'medium' | 'hard'
  tags?: string[]
  workspace: {
    strategy?: WorkspaceStrategy
    /** Absolute path override (tests). */
    repo_path?: string
    /** Env var holding absolute path to primary repo. */
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
    /** Overall UI turn timeout (ms). */
    timeout_ms?: number
    auto_approve_permissions?: boolean
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
  scoring?: { pass_requires?: 'verify_all'; partial_credit?: boolean }
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
  }
  /** Relative paths to task JSON files from pack root. */
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
  /** Absolute: worktree still has uncommitted changes. */
  dirtyAfter: boolean
  /**
   * Relative to post-setup baseline: agent changed something
   * (including restoring fixture dirt back to clean HEAD).
   */
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
}

export interface ScoreResult {
  passed: boolean
  tags: FailureTagV1[]
  notes: string[]
  verifyPassed: boolean
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
