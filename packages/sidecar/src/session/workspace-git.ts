import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createHash } from 'node:crypto'
import type { DiffFile, DiffHunk, DiffFileStatus, DiffState, DiffSummary, DiffBase, CommitLogEntry, Branch } from '@hip/protocol'

const execFileP = promisify(execFile)

export const MAX_DIFF_LINES_PER_FILE = 2000
export const MAX_DIFF_FILES = 200
const GIT_TIMEOUT_MS = 10_000
const GIT_INIT_TIMEOUT_MS = 60_000 // user-triggered baseline commit may walk a big tree
const GIT_MAX_BUFFER = 32 * 1024 * 1024

export interface WorkspaceDiff { state: DiffState; files?: DiffFile[]; summary?: DiffSummary; error?: string }
export interface WorkspaceDiffOptions { gitBin?: string; base?: DiffBase; baseSha?: string | null; indexFile?: string; headSha?: string }
export interface CaptureCheckpointOptions { sessionId: string; turnId: string; label: string | null; prevCommit: string | null; gitBin?: string }
export interface CaptureResult { ok: boolean; skipped?: boolean; treeSha?: string; commitSha?: string; branch?: string | null; error?: string }
export interface RevertOptions { sessionId: string; targetTree: string; prevCommit: string | null; gitBin?: string }
export interface RevertResult { ok: boolean; safetyCheckpointId?: string; error?: string }

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/
const HEADER_PATH_RE = /^a\/(.+) b\/\1$/                       // 仅当 ---/+++ 缺失时兜底（mode-only）
const BINARY_RE = /^Binary files a\/(.+) and b\/(.+) differ$/

function stripPrefix(p: string): string { return p.replace(/^[ab]\//, '') }

/** Make a turnId / id safe to embed in a git ref path. Keep alnum/-/_ verbatim; if anything else
 *  appears (slash, dot, space, ~, CJK, …) fall back to a short deterministic sha1 so the ref is
 *  always valid (`git check-ref-format`-safe) and collision-resistant. */
export function sanitizeRefComponent(s: string): string {
  if (s.length > 0 && /^[A-Za-z0-9_-]+$/.test(s)) return s
  return 'h' + createHash('sha1').update(s).digest('hex').slice(0, 16)
}

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

/** 把工作区（含 untracked，遵守 .gitignore）写成一棵树，复用传入的 indexFile（不污染真实 index）。 */
async function writeWorkingTree(cwd: string, gitBin: string, hasHead: boolean, indexFile: string): Promise<string> {
  const env = { ...process.env, GIT_INDEX_FILE: indexFile }
  const run = (args: string[]) => execFileP(gitBin, args, { cwd, env, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER })
  await run(hasHead ? ['read-tree', 'HEAD'] : ['read-tree', '--empty'])
  await run(['add', '-A', '--', '.'])
  return (await run(['write-tree'])).stdout.trim()
}

/** 空树对象（无 HEAD 仓库的 base）。 */
async function emptyTreeSha(cwd: string, gitBin: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-idx-')); const idx = path.join(dir, 'index')
  try {
    const env = { ...process.env, GIT_INDEX_FILE: idx }
    await execFileP(gitBin, ['read-tree', '--empty'], { cwd, env, timeout: GIT_TIMEOUT_MS })
    return (await execFileP(gitBin, ['write-tree'], { cwd, env, timeout: GIT_TIMEOUT_MS })).stdout.trim()
  } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}) }
}

interface Prepared { realCwd: string; repoRoot: string; nowTree: string; baseTree: string; base: DiffBase; hasSessionStart: boolean }

/** 公共前置：校验仓库、建 now 树、解析 base 树。失败折叠成 WorkspaceDiff。 */
async function prepareTrees(cwd: string, opts: WorkspaceDiffOptions): Promise<{ ok: true; v: Prepared } | { ok: false; r: WorkspaceDiff }> {
  const gitBin = opts.gitBin ?? 'git'
  try { await fs.stat(cwd) } catch { return { ok: false, r: { state: 'error', error: 'cwd not accessible: ' + cwd } } }
  try { await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], gitBin) }
  catch (e) { return { ok: false, r: { state: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'git_missing' : 'not_a_repo' } } }
  const realCwd = await fs.realpath(cwd)
  const repoRoot = (await runGit(cwd, ['rev-parse', '--show-toplevel'], gitBin)).stdout.trim()
  let hasHead = true
  try { await runGit(cwd, ['rev-parse', '--verify', 'HEAD'], gitBin) } catch { hasHead = false }

  // Head side: an explicit pinned tree (tree↔tree mode), else the live working tree (default).
  let nowTree: string
  if (opts.headSha) {
    nowTree = opts.headSha
  } else {
    const ownIndex = !opts.indexFile
    const indexDir = ownIndex ? await fs.mkdtemp(path.join(os.tmpdir(), 'hip-idx-')) : ''
    const indexFile = opts.indexFile ?? path.join(indexDir, 'index')
    try { nowTree = await writeWorkingTree(cwd, gitBin, hasHead, indexFile) }
    finally { if (ownIndex) await fs.rm(indexDir, { recursive: true, force: true }).catch(() => {}) }
  }

  const useSnapshot = opts.base === 'session-start' && !!opts.baseSha
  const baseTree = useSnapshot ? (opts.baseSha as string) : (hasHead ? 'HEAD' : await emptyTreeSha(cwd, gitBin))
  return { ok: true, v: { realCwd, repoRoot, nowTree, baseTree, base: useSnapshot ? 'session-start' : 'head', hasSessionStart: !!opts.baseSha } }
}

/** 工作区 diff（base 默认 HEAD）。Never throws —— 一切失败折叠为 DiffState。 */
export async function collectWorkspaceDiff(cwd: string, opts: WorkspaceDiffOptions = {}): Promise<WorkspaceDiff> {
  const gitBin = opts.gitBin ?? 'git'
  try {
    const p = await prepareTrees(cwd, opts)
    if (!p.ok) return p.r
    const { realCwd, repoRoot, nowTree, baseTree } = p.v
    const out = (await runGit(cwd, ['-c', 'core.quotepath=false', 'diff', '--no-color', '--find-renames', baseTree, nowTree, '--', '.'], gitBin)).stdout
    const rel = (q: string) => path.relative(realCwd, path.join(repoRoot, q))
    const files = parseUnifiedDiff(out)
      .map((f) => ({ ...f, path: rel(f.path), ...(f.oldPath ? { oldPath: rel(f.oldPath) } : {}) }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    const summary: DiffSummary = {
      totalFiles: files.length,
      totalAdditions: files.reduce((s, f) => s + f.additions, 0),
      totalDeletions: files.reduce((s, f) => s + f.deletions, 0),
    }
    return { state: 'ok', files: files.slice(0, MAX_DIFF_FILES), summary }
  } catch (e) { return { state: 'error', error: (e instanceof Error ? e.message : String(e)).slice(0, 500) } }
}

/** 仅返回 +/- 总计与文件数（numstat），不生成 patch body。喂 Diff 角标。 */
export async function collectWorkspaceDiffSummary(cwd: string, opts: WorkspaceDiffOptions = {}): Promise<WorkspaceDiff> {
  const gitBin = opts.gitBin ?? 'git'
  try {
    const p = await prepareTrees(cwd, opts)
    if (!p.ok) return p.r
    const { nowTree, baseTree } = p.v
    const out = (await runGit(cwd, ['diff', '--numstat', '--find-renames', baseTree, nowTree, '--', '.'], gitBin)).stdout
    let totalFiles = 0, totalAdditions = 0, totalDeletions = 0
    for (const ln of out.split('\n')) {
      const m = /^(\d+|-)\t(\d+|-)\t/.exec(ln)
      if (!m) continue
      totalFiles++
      if (m[1] !== '-') totalAdditions += parseInt(m[1], 10)
      if (m[2] !== '-') totalDeletions += parseInt(m[2], 10)
    }
    return { state: 'ok', summary: { totalFiles, totalAdditions, totalDeletions } }
  } catch (e) { return { state: 'error', error: (e instanceof Error ? e.message : String(e)).slice(0, 500) } }
}

/** 抓工作区快照树（含 untracked，遵守 .gitignore），用于「自会话起点」base。
 *  非 git 工作区 / 失败返回 null。用一次性临时 index，不碰真实 index。 */
export async function captureSessionSnapshot(cwd: string, gitBin = 'git'): Promise<string | null> {
  try {
    await fs.stat(cwd)
    await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], gitBin)
  } catch { return null }
  let hasHead = true
  try { await runGit(cwd, ['rev-parse', '--verify', 'HEAD'], gitBin) } catch { hasHead = false }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-snap-')); const idx = path.join(dir, 'index')
  try { return await writeWorkingTree(cwd, gitBin, hasHead, idx) }
  catch { return null }
  finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}) }
}

/** Current branch name (`git rev-parse --abbrev-ref HEAD`). Returns null for a non-repo or a
 *  detached/unborn HEAD ('HEAD'). Never throws. */
export async function getCurrentBranch(cwd: string, gitBin = 'git'): Promise<string | null> {
  try {
    const name = (await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], gitBin)).stdout.trim()
    return name && name !== 'HEAD' ? name : null
  } catch { return null }
}

/** List hip checkpoint ref names under refs/hip/checkpoints/<sessionId>/. Never throws → []. */
export async function listCheckpointRefs(cwd: string, sessionId: string, gitBin = 'git'): Promise<string[]> {
  const prefix = `refs/hip/checkpoints/${sessionId}/`
  try {
    const out = (await runGit(cwd, ['for-each-ref', '--format=%(refname)', prefix], gitBin)).stdout
    return out.split('\n').map((l) => l.trim()).filter(Boolean)
  } catch { return [] }
}

/** Capture the working tree as a detached checkpoint commit and ref-protect it immediately.
 *  Borrows Zed's model: write-tree under a temp index (real index untouched), commit-tree -p prev
 *  with a synthetic hip author (so it never looks like a real commit), then update-ref. Skips the
 *  capture if the working tree is byte-identical to prevCommit's tree (empty turn). Never throws. */
export async function captureCheckpoint(cwd: string, opts: CaptureCheckpointOptions): Promise<CaptureResult> {
  const gitBin = opts.gitBin ?? 'git'
  try {
    await fs.stat(cwd)
    await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], gitBin)
  } catch { return { ok: false, error: 'not_a_repo' } }
  let hasHead = true
  try { await runGit(cwd, ['rev-parse', '--verify', 'HEAD'], gitBin) } catch { hasHead = false }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-ckpt-'))
  const idx = path.join(dir, 'index')
  try {
    const treeSha = await writeWorkingTree(cwd, gitBin, hasHead, idx)

    // Empty-turn skip: identical to prevCommit's tree → no checkpoint.
    if (opts.prevCommit) {
      const prevTree = (await runGit(cwd, ['rev-parse', `${opts.prevCommit}^{tree}`], gitBin)).stdout.trim()
      if (prevTree === treeSha) return { ok: true, skipped: true, treeSha }
    }

    const message = opts.label ?? 'hip checkpoint'
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 'hip', GIT_AUTHOR_EMAIL: 'hip@local',
      GIT_COMMITTER_NAME: 'hip', GIT_COMMITTER_EMAIL: 'hip@local',
    }
    const ctArgs = ['commit-tree', treeSha, ...(opts.prevCommit ? ['-p', opts.prevCommit] : []), '-m', message]
    const commitSha = (await execFileP(gitBin, ctArgs, { cwd, env, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER })).stdout.trim()

    const refSession = sanitizeRefComponent(opts.sessionId)
    const refTurn = sanitizeRefComponent(opts.turnId)
    const ref = `refs/hip/checkpoints/${refSession}/${refTurn}`
    await runGit(cwd, ['update-ref', ref, commitSha], gitBin)   // immediate → GC-safe

    const branch = await getCurrentBranch(cwd, gitBin)
    return { ok: true, treeSha, commitSha, branch }
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Read the commit log `<startCommit>..HEAD` (or the whole history when startCommit is null),
 *  newest-first. Uses a US/RS-delimited custom format to survive arbitrary CJK/multi-line messages.
 *  Never throws — folds failure into a DiffState. */
export async function collectCommitLog(cwd: string, startCommit: string | null, gitBin = 'git'): Promise<{ state: DiffState; commits?: CommitLogEntry[]; error?: string }> {
  try { await fs.stat(cwd) } catch { return { state: 'error', error: 'cwd not accessible: ' + cwd } }
  try { await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], gitBin) }
  catch (e) { return { state: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'git_missing' : 'not_a_repo' } }
  try {
    // %x1f = unit-sep (field), %x1e = record-sep (commit). %ct = committer unix time.
    const FMT = '--format=%H%x1f%h%x1f%an%x1f%ct%x1f%s%x1e'
    const range = startCommit ? `${startCommit}..HEAD` : 'HEAD'
    const out = (await runGit(cwd, ['log', FMT, range], gitBin)).stdout
    const commits: CommitLogEntry[] = []
    for (const rec of out.split('\x1e')) {
      const r = rec.replace(/^\n+/, '')
      if (!r.trim()) continue
      const [sha, shortSha, author, ct, message] = r.split('\x1f')
      if (!sha) continue
      commits.push({ sha, shortSha, author, message: message ?? '', timestamp: parseInt(ct, 10) * 1000 })
    }
    return { state: 'ok', commits }
  } catch (e) { return { state: 'error', error: (e instanceof Error ? e.message : String(e)).slice(0, 500) } }
}

/** 单文件 diff，自定义上下文行数（'full' = 看全文）。用于按需展开。 */
export async function collectWorkspaceDiffFile(
  cwd: string, filePath: string,
  opts: WorkspaceDiffOptions & { context?: number | 'full' } = {},
): Promise<{ state: DiffState; file?: DiffFile; error?: string }> {
  const gitBin = opts.gitBin ?? 'git'
  try {
    const p = await prepareTrees(cwd, opts)
    if (!p.ok) return { state: p.r.state, error: p.r.error }
    const { realCwd, repoRoot, nowTree, baseTree } = p.v
    const ctx = opts.context === 'full' ? '1000000' : String(opts.context ?? 3)
    const out = (await runGit(cwd, ['-c', 'core.quotepath=false', 'diff', '--no-color', '--find-renames', `-U${ctx}`, baseTree, nowTree, '--', filePath], gitBin)).stdout
    const rel = (q: string) => path.relative(realCwd, path.join(repoRoot, q))
    const file = parseUnifiedDiff(out).map((f) => ({ ...f, path: rel(f.path), ...(f.oldPath ? { oldPath: rel(f.oldPath) } : {}) }))[0]
    return { state: 'ok', file }
  } catch (e) { return { state: 'error', error: (e instanceof Error ? e.message : String(e)).slice(0, 500) } }
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

/** List local branches with the current one flagged. Never throws → { ok:false } on a non-repo. */
export async function listBranches(cwd: string, gitBin = 'git'): Promise<{ ok: boolean; branches?: Branch[]; error?: string }> {
  try {
    await fs.stat(cwd)
    await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], gitBin)
  } catch { return { ok: false, error: 'not_a_repo' } }
  try {
    // %(HEAD) = '*' for the checked-out branch, ' ' otherwise. %(refname:short) = bare branch name.
    const out = (await runGit(cwd, ['for-each-ref', '--format=%(HEAD)%09%(refname:short)', 'refs/heads/'], gitBin)).stdout
    const branches: Branch[] = []
    for (const ln of out.split('\n')) {
      if (!ln.trim()) continue
      const [flag, name] = ln.split('\t')
      if (!name) continue
      branches.push({ name, current: flag === '*' })
    }
    return { ok: true, branches }
  } catch (e) { return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) } }
}

/** Switch the checkout to an existing branch. `git switch` with a `checkout` fallback for old git.
 *  Never throws → { ok:false, error } (e.g. a dirty tree that would be overwritten, or a missing branch). */
export async function switchBranch(cwd: string, name: string, gitBin = 'git'): Promise<{ ok: boolean; error?: string }> {
  try { await runGit(cwd, ['switch', name], gitBin); return { ok: true } }
  catch {
    try { await runGit(cwd, ['checkout', name], gitBin); return { ok: true } }
    catch (e) { return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) } }
  }
}

/** Read a repo-local git config value (e.g. user.name). Returns '' when unset. Never throws.
 *  Scoped to `--local` deliberately: the synthetic `hip` identity should kick in when *this repo*
 *  has no user identity, independent of any machine-wide --global identity (otherwise the global
 *  config leaks in and the synthetic fallback never fires). */
async function gitConfigGet(cwd: string, gitBin: string, key: string): Promise<string> {
  try { return (await runGit(cwd, ['config', '--local', '--get', key], gitBin)).stdout.trim() }
  catch { return '' }
}

/** Stage everything (`git add -A`) and commit. Identity: use the user's git config (user.name +
 *  user.email) plus a `Co-authored-by: hip <hip@local>` trailer when both are present; otherwise
 *  commit with the synthetic `hip <hip@local>` identity (no trailer). Always commit.gpgsign=false
 *  + --no-verify so a user's hooks/signing never block an agent commit. Reads back HEAD for the sha.
 *  Never throws → { ok:false, error }. */
export async function gitCommit(cwd: string, message: string, gitBin = 'git'): Promise<{ ok: boolean; sha?: string; error?: string }> {
  try {
    await fs.stat(cwd)
    await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], gitBin)
  } catch { return { ok: false, error: 'not_a_repo' } }
  try {
    await runGit(cwd, ['add', '-A'], gitBin)
    const name = await gitConfigGet(cwd, gitBin, 'user.name')
    const email = await gitConfigGet(cwd, gitBin, 'user.email')
    const hasUser = !!name && !!email
    const fullMessage = hasUser ? `${message}\n\nCo-authored-by: hip <hip@local>` : message
    const identityArgs = hasUser
      ? ['-c', 'commit.gpgsign=false']
      : ['-c', 'user.name=hip', '-c', 'user.email=hip@local', '-c', 'commit.gpgsign=false']
    await runGit(cwd, [...identityArgs, 'commit', '-m', fullMessage, '--no-verify'], gitBin)
    const sha = (await runGit(cwd, ['rev-parse', 'HEAD'], gitBin)).stdout.trim()
    return { ok: true, sha }
  } catch (e) { return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) } }
}

/** Create a branch at HEAD without switching to it. Never throws → { ok:false, error }. */
export async function gitCreateBranch(cwd: string, name: string, gitBin = 'git'): Promise<{ ok: boolean; error?: string }> {
  try { await runGit(cwd, ['branch', name], gitBin); return { ok: true } }
  catch (e) { return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) } }
}

/** Switch to an existing branch (agent tool path). Thin alias over switchBranch so the tool and
 *  the panel share one implementation. */
export async function gitSwitchBranch(cwd: string, name: string, gitBin = 'git'): Promise<{ ok: boolean; error?: string }> {
  return switchBranch(cwd, name, gitBin)
}

/** Exact worktree restore to a checkpoint's tree, Zed-style and hardened. NEVER touches HEAD/index/
 *  branches. Steps: (1) MANDATORY pre-revert safety checkpoint via captureCheckpoint — must succeed
 *  (or be a clean empty-turn skip) or we abort before deleting anything; (2) read-tree targetTree into
 *  a temp index; (3) checkout-index -f -a writes the tracked content; (4) delete worktree files absent
 *  from `git ls-tree -r --name-only targetTree` (the set-difference — the only data-loss surface).
 *  Never `reset --hard`. Never throws → { ok:false, error }. */
export async function revertToCheckpoint(cwd: string, opts: RevertOptions): Promise<RevertResult> {
  const gitBin = opts.gitBin ?? 'git'
  try {
    await fs.stat(cwd)
    await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], gitBin)
  } catch { return { ok: false, error: 'not_a_repo' } }

  // (1) Mandatory pre-revert safety checkpoint. A monotonic turnId keeps refs unique across reverts.
  const safetyTurnId = `pre-revert-${Date.now()}`
  const safety = await captureCheckpoint(cwd, { sessionId: opts.sessionId, turnId: safetyTurnId, label: 'pre-revert safety', prevCommit: opts.prevCommit, gitBin })
  if (!safety.ok) return { ok: false, error: 'safety checkpoint failed: ' + (safety.error ?? 'unknown') }
  const safetyCheckpointId = `${opts.sessionId}:${safetyTurnId}`

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-revert-'))
  const idx = path.join(dir, 'index')
  try {
    // (2) read the target tree into a temp index (real index untouched).
    const env = { ...process.env, GIT_INDEX_FILE: idx }
    const runIdx = (args: string[]) => execFileP(gitBin, args, { cwd, env, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER })
    await runIdx(['read-tree', opts.targetTree])
    // (3) write the tracked content from that index into the worktree.
    await runIdx(['checkout-index', '-f', '-a'])

    // (4) delete worktree files absent from the target tree (set-difference).
    const wantOut = (await runGit(cwd, ['ls-tree', '-r', '--name-only', opts.targetTree], gitBin)).stdout
    const want = new Set(wantOut.split('\n').map((l) => l.trim()).filter(Boolean))
    // Enumerate the worktree's tracked + untracked files (respecting .gitignore: ignored files stay).
    const haveOut = (await runGit(cwd, ['ls-files', '--cached', '--others', '--exclude-standard'], gitBin)).stdout
    const have = haveOut.split('\n').map((l) => l.trim()).filter(Boolean)
    for (const rel of have) {
      if (!want.has(rel)) await fs.rm(path.join(cwd, rel), { force: true }).catch(() => {})
    }
    return { ok: true, safetyCheckpointId }
  } catch (e) {
    return { ok: false, safetyCheckpointId, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Resolve a checkpoint ref's commit sha, tree sha, and branch (at the ref commit). Used to persist the
 *  pre-revert safety checkpoint after revertToCheckpoint wrote it. Returns null if the ref is missing. */
export async function checkpointRefMeta(cwd: string, sessionId: string, turnId: string, gitBin = 'git'): Promise<{ commitSha: string; treeSha: string; branch: string | null } | null> {
  const ref = `refs/hip/checkpoints/${sanitizeRefComponent(sessionId)}/${sanitizeRefComponent(turnId)}`
  try {
    const commitSha = (await runGit(cwd, ['rev-parse', ref], gitBin)).stdout.trim()
    const treeSha = (await runGit(cwd, ['rev-parse', `${ref}^{tree}`], gitBin)).stdout.trim()
    const branch = await getCurrentBranch(cwd, gitBin)
    return { commitSha, treeSha, branch }
  } catch { return null }
}
