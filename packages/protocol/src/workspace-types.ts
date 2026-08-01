/** Filesystem, git diff, checkpoint, and worktree types. */
/** One immediate child of a directory. `path` is a real absolute host path. */
export interface FsEntry {
  name: string
  path: string
  isDir: boolean
  size?: number
}

export type DiffLineType = 'add' | 'del' | 'ctx'

/** One rendered diff line. `oldNo`/`newNo` are 1-based; null on the side the line doesn't exist. */
export interface DiffLine {
  type: DiffLineType
  content: string
  oldNo: number | null
  newNo: number | null
  noNewline?: boolean            // 该侧文件末尾无换行
}

/** One hunk (@@ block) within a changed file. */
export interface DiffHunk {
  oldStart: number; oldLines: number
  newStart: number; newLines: number
  header?: string                // @@ 第二段后的 section 文本（如所在函数），可空
  lines: DiffLine[]
  truncated?: boolean            // 本文件行预算耗尽后该 hunk 被截断
}

export type DiffFileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

/** One changed file in the workspace diff. `path` is cwd-relative for display. */
export interface DiffFile {
  path: string                   // renamed 时为新路径
  oldPath?: string               // renamed 旧路径（cwd 相对）
  status: DiffFileStatus
  additions: number
  deletions: number
  hunks: DiffHunk[]
  truncated?: boolean            // 文件级截断
  binary?: boolean               // 二进制变更，hunks 为空
}

/** Outcome of a workspace diff request. */
export type DiffState = 'ok' | 'not_a_repo' | 'git_missing' | 'no_cwd' | 'error'
export type DiffBase = 'session-start' | 'head'
export interface DiffSummary { totalFiles: number; totalAdditions: number; totalDeletions: number }

/** One per-turn (or session-start) checkpoint on the private ref chain. */
export interface Checkpoint {
  id: string                                  // "<sessionId>:<turnId>" ("<sessionId>:start" for #0)
  sessionId: string
  turnId: string | null                       // null for checkpoint #0 (session start)
  kind: 'start' | 'turn' | 'pre-revert'
  label: string | null                        // denormalized turn label for the timeline
  treeSha: string                             // drives diffs + restore
  commitSha: string                           // GC-protected ref target
  branch: string | null                       // branch at capture (for cross-branch warnings, A2)
  createdAt: number
}

/** One row of the session-start..HEAD commit log (更改 tab). */
export interface CommitLogEntry {
  sha: string
  shortSha: string
  message: string
  author: string
  timestamp: number                           // committer time, ms
}

/** One branch in the repo, with a flag for the checked-out one. */
export interface Branch { name: string; current: boolean }

/**
 * Stable for a given path across process restarts.
 * NOT stable across path moves/relocations.
 * @see docs/design/2026-07-17-worktree-studio-orca-alignment.md KD15
 */
export type WorktreeId = string

export type WorktreeSource =
  | 'agent_tool' // git_worktree_create
  | 'protocol' // git:worktree:create / CLI / single isolation
  | 'parallel' // parallel_worktrees agent HITL tool
  | 'host_fanout' // sessionService.startParallelRun (host composer parallel)
  | 'background' // durable only when keepWorktree via pre-created root
  | 'import' // external inbox accept (P1)
  | 'discovered' // listed from git, not yet claimed
  | 'primary' // main tree

/** Structured codes on `git:worktree:remove:result` (PR7 additive). */
export type WorktreeRemoveErrorCode =
  | 'WORKTREE_DIRTY'
  | 'NOT_MANAGED'
  | 'NOT_FOUND'
  | 'UNKNOWN'

/** First-class worktree product object (events + meta). */
export interface WorktreeRecord {
  id: WorktreeId
  path: string // absolute, realpath preferred
  branch: string // '' if detached
  head: string
  repoKey: string // stable: hash of primary realpath
  isPrimary: boolean
  managed: boolean // path under current getWorktreesDir() only (v1)
  /** When true, excluded from Studio catalog (disposable bg isolate). */
  ephemeral?: boolean
  source: WorktreeSource
  label?: string // display name; default branch or last path segment
  pathKey?: string // relative key under managed root used at create
  createdAt?: number
  hostSessionId?: string // session whose cwd was used for create
  boundSessionId?: string // session whose cwd === this.path (if any)
  taskId?: string
  parallelRunId?: string
  dirty?: boolean
  lastSeenAt?: number
}

/** On-disk meta file under ~/.hip/worktrees/.meta/<repoKey>.json */
export interface WorktreeMetaFile {
  version: 1
  repoKey: string
  primaryPath: string
  records: Record<WorktreeId, Omit<WorktreeRecord, 'branch' | 'head' | 'dirty'>>
  /** Paths user dismissed from external inbox */
  dismissedExternalPaths?: string[]
  /** Paths user imported */
  importedExternalPaths?: string[]
}

export type WorktreeChangeKind = 'created' | 'updated' | 'removed' | 'discovered' | 'imported'

/**
 * Porcelain worktree row + optional Studio enrichment (KD13).
 * List RPC stays `git:worktree:list`; fields are additive.
 */
export interface WorktreeInfo {
  path: string
  branch: string
  head: string
  id?: WorktreeId
  managed?: boolean
  isPrimary?: boolean
  ephemeral?: boolean
  source?: WorktreeSource
  label?: string
  repoKey?: string
}

export type SubagentMode = 'foreground' | 'background'
