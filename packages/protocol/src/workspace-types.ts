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

/** The three timeline diff modes — each maps to a base→head tree pair. */
export type CheckpointMode = 'this-turn' | 'since-then' | 'since-start'

/** One branch in the repo, with a flag for the checked-out one. */
export interface Branch { name: string; current: boolean }

export interface WorktreeInfo { path: string; branch: string; head: string }
export type SubagentMode = 'foreground' | 'background'
