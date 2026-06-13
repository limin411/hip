import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import type { DiffFile, DiffHunk, DiffFileStatus, DiffState, DiffSummary, DiffBase } from '@hip/protocol'
import { readHead } from './workspace-fs.js'

const execFileP = promisify(execFile)

export const MAX_DIFF_LINES_PER_FILE = 2000
export const MAX_DIFF_FILES = 200
export const UNTRACKED_READ_CAP = 1024 * 1024 // 1 MB, mirrors workspace-fs TEXT_CAP
const GIT_TIMEOUT_MS = 10_000
const GIT_INIT_TIMEOUT_MS = 60_000 // user-triggered baseline commit may walk a big tree
const GIT_MAX_BUFFER = 32 * 1024 * 1024

export interface WorkspaceDiff {
  state: DiffState
  files?: DiffFile[]
  totalFiles?: number
  error?: string
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/
const HEADER_PATH_RE = /^a\/(.+) b\/\1$/                       // 仅当 ---/+++ 缺失时兜底（mode-only）
const BINARY_RE = /^Binary files a\/(.+) and b\/(.+) differ$/

function stripPrefix(p: string): string { return p.replace(/^[ab]\//, '') }

/**
 * 把 `git diff` 统一输出解析为 hunk-first 的 DiffFile[]。路径按 git 原样（repo-root 相对），
 * 调用方负责转 cwd 相对。`additions`/`deletions` 为 pre-truncation；每文件行数共享一个预算
 * MAX_DIFF_LINES_PER_FILE，超出则丢行并置 truncated。
 */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  for (const chunk of text.split(/^diff --git /m).slice(1)) {
    const rawLines = chunk.split('\n')
    let filePath = ''
    let oldPath: string | undefined
    let status: DiffFileStatus = 'modified'
    let binary = false
    const hunks: DiffHunk[] = []
    let cur: DiffHunk | null = null
    let oldNo = 0, newNo = 0
    let additions = 0, deletions = 0
    let budget = MAX_DIFF_LINES_PER_FILE
    let truncated = false
    for (const line of rawLines) {
      if (!cur) {
        if (line.startsWith('rename from ')) { oldPath = line.slice('rename from '.length); status = 'renamed'; continue }
        if (line.startsWith('rename to ')) { filePath = line.slice('rename to '.length); status = 'renamed'; continue }
        if (line.startsWith('new file mode')) { status = 'added'; continue }
        if (line.startsWith('deleted file mode')) { status = 'deleted'; continue }
        if (line.startsWith('--- ')) {
          const p = line.slice(4).trim()
          if (p === '/dev/null') status = 'added'
          else if (!filePath) filePath = stripPrefix(p)
          continue
        }
        if (line.startsWith('+++ ')) {
          const p = line.slice(4).trim()
          if (p === '/dev/null') status = 'deleted'
          else filePath = stripPrefix(p)        // b/ 侧胜出
          continue
        }
        const bm = BINARY_RE.exec(line)
        if (bm) { binary = true; if (!filePath) filePath = bm[2]; continue }
      }
      const h = HUNK_RE.exec(line)
      if (h) {
        cur = {
          oldStart: parseInt(h[1], 10), oldLines: h[2] === undefined ? 1 : parseInt(h[2], 10),
          newStart: parseInt(h[3], 10), newLines: h[4] === undefined ? 1 : parseInt(h[4], 10),
          ...(h[5].trim() ? { header: h[5].trim() } : {}),
          lines: [],
        }
        hunks.push(cur)
        oldNo = cur.oldStart; newNo = cur.newStart
        continue
      }
      if (!cur) continue
      if (line.startsWith('\\')) {                 // "\ No newline at end of file"
        const prev = cur.lines[cur.lines.length - 1]
        if (prev) prev.noNewline = true
        continue
      }
      if (line.startsWith('+')) {
        additions++
        if (budget > 0) { cur.lines.push({ type: 'add', content: line.slice(1), oldNo: null, newNo }); budget-- } else { truncated = true; cur.truncated = true }
        newNo++
      } else if (line.startsWith('-')) {
        deletions++
        if (budget > 0) { cur.lines.push({ type: 'del', content: line.slice(1), oldNo, newNo: null }); budget-- } else { truncated = true; cur.truncated = true }
        oldNo++
      } else if (line.startsWith(' ')) {
        if (budget > 0) { cur.lines.push({ type: 'ctx', content: line.slice(1), oldNo, newNo }); budget-- } else { truncated = true; cur.truncated = true }
        oldNo++; newNo++
      }
    }
    if (!filePath) { const hm = HEADER_PATH_RE.exec(rawLines[0] ?? ''); if (hm) filePath = hm[1] }
    if (!filePath && oldPath) filePath = oldPath
    if (!filePath) continue
    files.push({
      path: filePath,
      ...(oldPath && oldPath !== filePath ? { oldPath } : {}),
      status,
      additions, deletions, hunks,
      ...(truncated ? { truncated: true } : {}),
      ...(binary ? { binary: true } : {}),
    })
  }
  return files
}

function runGit(cwd: string, args: string[], gitBin: string, timeout = GIT_TIMEOUT_MS): Promise<{ stdout: string }> {
  return execFileP(gitBin, args, { cwd, timeout, maxBuffer: GIT_MAX_BUFFER })
}

/** One `git status --porcelain=v1 -z` record. `path` is repo-root-relative. */
interface StatusEntry { xy: string; path: string }

function parseStatusZ(out: string): StatusEntry[] {
  const fields = out.split('\0').filter((f) => f.length > 0)
  const entries: StatusEntry[] = []
  for (let i = 0; i < fields.length; i++) {
    const xy = fields[i].slice(0, 2)
    entries.push({ xy, path: fields[i].slice(3) })
    if (xy[0] === 'R' || xy[0] === 'C') i++ // rename/copy carries a second "from" field — consume it
  }
  return entries
}

/** Render an on-disk file (untracked, or any file in a no-HEAD repo) as an all-add DiffFile. */
async function untrackedDiffFile(absPath: string, relPath: string): Promise<DiffFile> {
  const stat = await fs.lstat(absPath)
  // Symlinks would leak target content from outside the workspace (cf. workspace-fs
  // resolveRealWithin) and FIFOs would block the read forever — regular files only.
  // Git itself never shows a symlink's target content (mode 120000 = the link path).
  if (!stat.isFile()) throw new Error('not a regular file')
  const readCapped = stat.size > UNTRACKED_READ_CAP
  const buf = readCapped ? await readHead(absPath, UNTRACKED_READ_CAP) : await fs.readFile(absPath)
  if (buf.subarray(0, 8000).includes(0)) {
    return { path: relPath, additions: 0, deletions: 0, lines: [], binary: true }
  }
  const textLines = buf.toString('utf8').split('\n')
  if (textLines.at(-1) === '') textLines.pop() // trailing newline → no phantom empty line
  const capped = textLines.slice(0, MAX_DIFF_LINES_PER_FILE)
  return {
    path: relPath,
    additions: textLines.length,
    deletions: 0,
    lines: capped.map((content, i): DiffLine => ({ type: 'add', content, oldNo: null, newNo: i + 1 })),
    ...(readCapped || textLines.length > capped.length ? { truncated: true } : {}),
  }
}

/**
 * Collect the worktree-vs-HEAD diff of the cwd subtree. Never throws — every failure
 * folds into a DiffState. Tracked changes come from one `git diff HEAD -- .` call;
 * untracked files are read from disk; a no-HEAD repo renders everything as new.
 */
export async function collectWorkspaceDiff(cwd: string, gitBin = 'git'): Promise<WorkspaceDiff> {
  try {
    // Detect a missing/inaccessible cwd before any git call so it doesn't masquerade as git_missing.
    try { await fs.stat(cwd) } catch { return { state: 'error', error: 'cwd not accessible: ' + cwd } }

    try {
      await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], gitBin)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'git_missing' }
      return { state: 'not_a_repo' }
    }

    // Resolve symlinks in cwd so path.relative() arithmetic is correct (e.g. macOS /tmp → /private/tmp).
    const realCwd = await fs.realpath(cwd)
    const repoRoot = (await runGit(cwd, ['rev-parse', '--show-toplevel'], gitBin)).stdout.trim()
    let hasHead = true
    try { await runGit(cwd, ['rev-parse', '--verify', 'HEAD'], gitBin) } catch { hasHead = false }

    const rel = (repoRelative: string) => path.relative(realCwd, path.join(repoRoot, repoRelative))

    // Build tracked list and untracked pending list, then materialize disk reads ONLY for entries
    // inside the cap — bounded work even on huge untracked trees.
    type Pending = { path: string; abs: string }
    const tracked: DiffFile[] = []
    if (hasHead) {
      const diffOut = (await runGit(cwd, ['-c', 'core.quotepath=false', 'diff', '--no-color', '--no-renames', 'HEAD', '--', '.'], gitBin)).stdout
      for (const f of parseUnifiedDiff(diffOut)) tracked.push({ ...f, path: rel(f.path) })
    }
    const statusOut = (await runGit(cwd, ['status', '--porcelain=v1', '-z', '-uall', '--', '.'], gitBin)).stdout
    // `git diff` never shows untracked files; with no HEAD it can't run at all, so every entry renders as new.
    // Entries ending in '/' are nested git repos (status doesn't recurse into them) — skipped deliberately.
    const pending: Pending[] = parseStatusZ(statusOut)
      .filter((s) => (hasHead ? s.xy === '??' : true))
      .filter((s) => !s.path.endsWith('/'))
      .map((s) => ({ path: rel(s.path), abs: path.join(repoRoot, s.path) }))

    const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    const merged: Array<DiffFile | Pending> = [...tracked, ...pending].sort(byPath)
    const totalFiles = merged.length
    const files: DiffFile[] = []
    for (const entry of merged.slice(0, MAX_DIFF_FILES)) {
      if ('lines' in entry) { files.push(entry); continue }
      try {
        files.push(await untrackedDiffFile(entry.abs, entry.path))
      } catch {
        // Vanished between status and read, or not a regular file (symlink/FIFO) — skip.
      }
    }
    return { state: 'ok', files, totalFiles }
  } catch (e) {
    return { state: 'error', error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }
  }
}

/**
 * Initialize a repo with a baseline commit so subsequent changes surface as diffs.
 * Inline identity: must not depend on the user's global git config.
 */
export async function gitInit(cwd: string, gitBin = 'git'): Promise<{ ok: boolean; error?: string }> {
  try {
    await runGit(cwd, ['init'], gitBin, GIT_INIT_TIMEOUT_MS)
    await runGit(cwd, ['add', '-A'], gitBin, GIT_INIT_TIMEOUT_MS)
    await runGit(cwd, ['-c', 'user.name=hip', '-c', 'user.email=hip@local', '-c', 'commit.gpgsign=false', 'commit', '-m', 'hip baseline', '--allow-empty', '--no-verify'], gitBin, GIT_INIT_TIMEOUT_MS)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }
  }
}
