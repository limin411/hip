import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import type { DiffFile, DiffLine, DiffState } from '@hip/protocol'

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

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * Parse `git diff` unified output into per-file DiffFiles. Paths come out exactly as git
 * prints them (repo-root-relative); the caller converts to cwd-relative. Line counts
 * (`additions`/`deletions`) are pre-truncation; `lines` is capped at MAX_DIFF_LINES_PER_FILE.
 */
const GIT_HEADER_RE = /^a\/(.+) b\/\1$/

export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  for (const chunk of text.split(/^diff --git /m).slice(1)) {
    const rawLines = chunk.split('\n')
    // Extract fallback path from `a/<path> b/<path>` header (first line of chunk).
    const headerMatch = GIT_HEADER_RE.exec(rawLines[0] ?? '')
    let filePath = ''
    let binary = false
    let inHunk = false
    let oldNo = 0
    let newNo = 0
    let additions = 0
    let deletions = 0
    let truncated = false
    const out: DiffLine[] = []
    for (const line of rawLines) {
      if (!inHunk) {
        // Header zone. `---` precedes `+++`; the b/ side wins unless it's /dev/null (deletion).
        if (line.startsWith('--- ')) {
          const p = line.slice(4).trim()
          if (!filePath && p !== '/dev/null') filePath = p.replace(/^a\//, '')
          continue
        }
        if (line.startsWith('+++ ')) {
          const p = line.slice(4).trim()
          // Caller passes --no-renames, so a/ and b/ paths are always the same;
          // unconditionally overwriting filePath with the b/ side is safe.
          if (p !== '/dev/null') filePath = p.replace(/^b\//, '')
          continue
        }
        if (/^Binary files .* differ$/.test(line)) { binary = true; continue }
      }
      const hunk = HUNK_RE.exec(line)
      if (hunk) {
        inHunk = true
        oldNo = parseInt(hunk[1], 10)
        newNo = parseInt(hunk[2], 10)
        continue
      }
      if (!inHunk) continue
      if (line.startsWith('+')) {
        additions++
        if (out.length < MAX_DIFF_LINES_PER_FILE) out.push({ type: 'add', content: line.slice(1), oldNo: null, newNo })
        else truncated = true
        newNo++
      } else if (line.startsWith('-')) {
        deletions++
        if (out.length < MAX_DIFF_LINES_PER_FILE) out.push({ type: 'del', content: line.slice(1), oldNo, newNo: null })
        else truncated = true
        oldNo++
      } else if (line.startsWith(' ')) {
        if (out.length < MAX_DIFF_LINES_PER_FILE) out.push({ type: 'ctx', content: line.slice(1), oldNo, newNo })
        else truncated = true
        oldNo++
        newNo++
      }
      // '\ No newline at end of file' and any other marker lines: skipped.
    }
    // Fall back to b/ path extracted from the `diff --git` header line.
    if (!filePath && headerMatch) filePath = headerMatch[1]
    if (!filePath) continue
    files.push({
      path: filePath,
      additions,
      deletions,
      lines: out,
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
  const stat = await fs.stat(absPath)
  const readCapped = stat.size > UNTRACKED_READ_CAP
  const buf = readCapped
    ? (await fs.readFile(absPath)).subarray(0, UNTRACKED_READ_CAP)
    : await fs.readFile(absPath)
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
    try {
      await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], gitBin)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'git_missing' }
      return { state: 'not_a_repo' }
    }
    const repoRoot = (await runGit(cwd, ['rev-parse', '--show-toplevel'], gitBin)).stdout.trim()
    let hasHead = true
    try { await runGit(cwd, ['rev-parse', '--verify', 'HEAD'], gitBin) } catch { hasHead = false }

    const rel = (repoRelative: string) => path.relative(cwd, path.join(repoRoot, repoRelative))
    const files: DiffFile[] = []

    if (hasHead) {
      const diffOut = (await runGit(cwd, ['-c', 'core.quotepath=false', 'diff', '--no-color', '--no-renames', 'HEAD', '--', '.'], gitBin)).stdout
      for (const f of parseUnifiedDiff(diffOut)) files.push({ ...f, path: rel(f.path) })
    }

    const statusOut = (await runGit(cwd, ['status', '--porcelain=v1', '-z', '-uall', '--', '.'], gitBin)).stdout
    // `git diff` never shows untracked files; with no HEAD it can't run at all, so every entry renders as new.
    const fromDisk = parseStatusZ(statusOut).filter((s) => (hasHead ? s.xy === '??' : true))
    for (const s of fromDisk) {
      try {
        files.push(await untrackedDiffFile(path.join(repoRoot, s.path), rel(s.path)))
      } catch {
        // File vanished between status and read — skip it rather than failing the whole diff.
      }
    }

    files.sort((a, b) => a.path.localeCompare(b.path))
    return { state: 'ok', files: files.slice(0, MAX_DIFF_FILES), totalFiles: files.length }
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
    await runGit(cwd, ['-c', 'user.name=hip', '-c', 'user.email=hip@local', 'commit', '-m', 'hip baseline', '--allow-empty'], gitBin, GIT_INIT_TIMEOUT_MS)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }
  }
}
