# Diff Tab — Workspace Git View (Slice 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock Diff tab with a real worktree-vs-HEAD git view of the session's bound cwd, with a one-click `git init` fallback for non-repo folders.

**Architecture:** A new sidecar module `workspace-git.ts` (peer of `workspace-fs.ts`) spawns the system `git` binary scoped to the cwd subtree and parses unified diff into protocol-typed `DiffFile[]`. Two new request/response message pairs (`fs:diff`, `fs:gitInit`) follow the existing `fs:ls` pattern through `Session` wrappers and `SessionManager` cases. The frontend folds results into a new `diffStore` (mirroring `fsStore`) and `DiffViewer` renders them with the already-built `FileDiff` line model. No DB schema change, no persistence.

**Tech Stack:** TypeScript, node `child_process.execFile`, zustand, vitest (real temp git repos — zero LLM calls), wdio E2E.

**Spec:** `docs/superpowers/specs/2026-06-10-diff-workspace-git-design.md`

**Branch:** `feat/diff-workspace-git` (create from `main` before Task 1: `git checkout -b feat/diff-workspace-git`)

**Conventions that apply to every task:**
- Run unit tests with `yarn vitest run <file>` from the repo root; the root config covers `packages/` too.
- NO DOM/RTL component tests (project rule). UI is covered by type-check + the E2E spec.
- All i18n keys must land in en / zh-CN / zh-TW in the same commit (typed translations make a missing key a type error).

---

### Task 1: Protocol — diff types + message pairs

**Files:**
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1: Add the shared diff types** (after the `FsEntry` interface, line ~83)

```ts
export type DiffLineType = 'add' | 'del' | 'ctx'

/** One rendered diff line. `oldNo`/`newNo` are 1-based; null on the side the line doesn't exist. */
export interface DiffLine {
  type: DiffLineType
  content: string
  oldNo: number | null
  newNo: number | null
}

/** One changed file in the workspace diff. `path` is cwd-relative for display. */
export interface DiffFile {
  path: string
  additions: number
  deletions: number
  lines: DiffLine[]
  truncated?: boolean   // per-file line cap (or untracked read cap) hit
  binary?: boolean      // binary change — lines is empty
}

/** Outcome of a workspace diff request. */
export type DiffState = 'ok' | 'not_a_repo' | 'git_missing' | 'no_cwd' | 'error'
```

- [ ] **Step 2: Add the client messages** (append to `ClientMessage` union after `fs:readCwd`)

```ts
  | { type: 'fs:diff'; sessionId: string }
  | { type: 'fs:gitInit'; sessionId: string }
```

- [ ] **Step 3: Add the server messages** (append to `ServerMessage` union after `fs:readCwd:result`)

```ts
  | { type: 'fs:diff:result'; sessionId: string; state: DiffState; files?: DiffFile[]; totalFiles?: number; error?: string }
  | { type: 'fs:gitInit:result'; sessionId: string; ok: boolean; error?: string }
```

- [ ] **Step 4: Verify**

Run: `yarn type-check`
Expected: PASS (additive types break nothing)

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/index.ts
git commit -m "feat(protocol): fs:diff/fs:gitInit message pairs + DiffFile/DiffLine/DiffState types"
```

---

### Task 2: `parseUnifiedDiff` — pure unified-diff parser

**Files:**
- Create: `packages/sidecar/src/session/workspace-git.ts`
- Create: `packages/sidecar/src/session/workspace-git.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/sidecar/src/session/workspace-git.test.ts
import { describe, it, expect } from 'vitest'
import { parseUnifiedDiff, MAX_DIFF_LINES_PER_FILE } from './workspace-git.js'

const MODIFY = `diff --git a/src/app.ts b/src/app.ts
index 1234567..89abcde 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 const a = 1
-const b = 2
+const b = 3
+const c = 4
 export {}
`

const NEW_FILE = `diff --git a/notes.md b/notes.md
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/notes.md
@@ -0,0 +1,2 @@
+hello
+world
`

const DELETED = `diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index e69de29..0000000
--- a/gone.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-bye
-now
`

const BINARY = `diff --git a/logo.png b/logo.png
index 1234567..89abcde 100644
Binary files a/logo.png and b/logo.png differ
`

const NO_NEWLINE = `diff --git a/x.txt b/x.txt
index 1234567..89abcde 100644
--- a/x.txt
+++ b/x.txt
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`

describe('parseUnifiedDiff', () => {
  it('parses a modified file with correct line numbers and counts', () => {
    const [f] = parseUnifiedDiff(MODIFY)
    expect(f.path).toBe('src/app.ts')
    expect(f.additions).toBe(2)
    expect(f.deletions).toBe(1)
    expect(f.lines).toEqual([
      { type: 'ctx', content: 'const a = 1', oldNo: 1, newNo: 1 },
      { type: 'del', content: 'const b = 2', oldNo: 2, newNo: null },
      { type: 'add', content: 'const b = 3', oldNo: null, newNo: 2 },
      { type: 'add', content: 'const c = 4', oldNo: null, newNo: 3 },
      { type: 'ctx', content: 'export {}', oldNo: 3, newNo: 4 },
    ])
  })

  it('splits multiple files', () => {
    const files = parseUnifiedDiff(MODIFY + NEW_FILE)
    expect(files.map((f) => f.path)).toEqual(['src/app.ts', 'notes.md'])
  })

  it('parses a new file as all-add', () => {
    const [f] = parseUnifiedDiff(NEW_FILE)
    expect(f).toMatchObject({ path: 'notes.md', additions: 2, deletions: 0 })
    expect(f.lines.every((l) => l.type === 'add')).toBe(true)
  })

  it('parses a deleted file as all-del (path from the a/ side)', () => {
    const [f] = parseUnifiedDiff(DELETED)
    expect(f).toMatchObject({ path: 'gone.txt', additions: 0, deletions: 2 })
    expect(f.lines.every((l) => l.type === 'del')).toBe(true)
  })

  it('flags a binary change with no lines', () => {
    const [f] = parseUnifiedDiff(BINARY)
    expect(f).toMatchObject({ path: 'logo.png', binary: true, lines: [] })
  })

  it('skips "no newline at end of file" markers', () => {
    const [f] = parseUnifiedDiff(NO_NEWLINE)
    expect(f.lines).toHaveLength(2)
    expect(f.lines.map((l) => l.type)).toEqual(['del', 'add'])
  })

  it('caps lines per file and flags truncated', () => {
    const adds = Array.from({ length: MAX_DIFF_LINES_PER_FILE + 100 }, (_, i) => `+line ${i}`).join('\n')
    const big = `diff --git a/big.txt b/big.txt\n--- /dev/null\n+++ b/big.txt\n@@ -0,0 +1,${MAX_DIFF_LINES_PER_FILE + 100} @@\n${adds}\n`
    const [f] = parseUnifiedDiff(big)
    expect(f.lines).toHaveLength(MAX_DIFF_LINES_PER_FILE)
    expect(f.truncated).toBe(true)
    expect(f.additions).toBe(MAX_DIFF_LINES_PER_FILE + 100) // counts are pre-truncation
  })

  it('returns [] for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })
})
```

Note: in the `NO_NEWLINE` fixture the `\\` inside the template literal produces a single backslash — exactly what git prints.

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run packages/sidecar/src/session/workspace-git.test.ts`
Expected: FAIL — `workspace-git.js` does not exist

- [ ] **Step 3: Implement the parser**

Only the parser's own imports/constants land in this task — `tsconfig` has `noUnusedLocals: true`, so the git-execution imports arrive with their users in Task 3.

```ts
// packages/sidecar/src/session/workspace-git.ts
import type { DiffFile, DiffLine } from '@hip/protocol'

export const MAX_DIFF_LINES_PER_FILE = 2000

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * Parse `git diff` unified output into per-file DiffFiles. Paths come out exactly as git
 * prints them (repo-root-relative); the caller converts to cwd-relative. Line counts
 * (`additions`/`deletions`) are pre-truncation; `lines` is capped at MAX_DIFF_LINES_PER_FILE.
 */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  for (const chunk of text.split(/^diff --git /m).slice(1)) {
    const rawLines = chunk.split('\n')
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run packages/sidecar/src/session/workspace-git.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/workspace-git.ts packages/sidecar/src/session/workspace-git.test.ts
git commit -m "feat(sidecar): parseUnifiedDiff — pure unified-diff parser with line caps"
```

---

### Task 3: `collectWorkspaceDiff` + `gitInit` — git execution against real repos

**Files:**
- Modify: `packages/sidecar/src/session/workspace-git.ts`
- Modify: `packages/sidecar/src/session/workspace-git.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `workspace-git.test.ts`; extend the imports)

```ts
// extend the top imports:
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseUnifiedDiff, collectWorkspaceDiff, gitInit, MAX_DIFF_LINES_PER_FILE, MAX_DIFF_FILES } from './workspace-git.js'

const execFileP = promisify(execFile)
const git = (cwd: string, ...args: string[]) => execFileP('git', args, { cwd })
async function makeRepo(dir: string): Promise<void> {
  await git(dir, 'init')
  await git(dir, 'add', '-A')
  await git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init', '--allow-empty')
}

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-wsgit-'))
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

describe('collectWorkspaceDiff', () => {
  it('reports not_a_repo for a plain folder', async () => {
    expect((await collectWorkspaceDiff(root)).state).toBe('not_a_repo')
  })

  it('reports git_missing when the git binary is absent', async () => {
    const r = await collectWorkspaceDiff(root, 'hip-definitely-missing-git')
    expect(r.state).toBe('git_missing')
  })

  it('reports ok with no files for a clean repo', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n')
    await makeRepo(root)
    expect(await collectWorkspaceDiff(root)).toEqual({ state: 'ok', files: [], totalFiles: 0 })
  })

  it('reports a modified tracked file with cwd-relative path', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n')
    await makeRepo(root)
    await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
    const r = await collectWorkspaceDiff(root)
    expect(r.state).toBe('ok')
    expect(r.files).toHaveLength(1)
    expect(r.files![0]).toMatchObject({ path: 'a.txt', additions: 1, deletions: 1 })
  })

  it('reports a deleted file as all-del', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\ntwo\n')
    await makeRepo(root)
    await fs.rm(path.join(root, 'a.txt'))
    const r = await collectWorkspaceDiff(root)
    expect(r.files![0]).toMatchObject({ path: 'a.txt', additions: 0, deletions: 2 })
  })

  it('renders an untracked file as all-add with line numbers', async () => {
    await makeRepo(root)
    await fs.writeFile(path.join(root, 'new.txt'), 'x\ny\n')
    const r = await collectWorkspaceDiff(root)
    expect(r.files![0]).toMatchObject({ path: 'new.txt', additions: 2, deletions: 0 })
    expect(r.files![0].lines).toEqual([
      { type: 'add', content: 'x', oldNo: null, newNo: 1 },
      { type: 'add', content: 'y', oldNo: null, newNo: 2 },
    ])
  })

  it('lists files inside an untracked directory individually (-uall)', async () => {
    await makeRepo(root)
    await fs.mkdir(path.join(root, 'newdir'))
    await fs.writeFile(path.join(root, 'newdir', 'f.txt'), 'z\n')
    const r = await collectWorkspaceDiff(root)
    expect(r.files!.map((f) => f.path)).toEqual([path.join('newdir', 'f.txt')])
  })

  it('keeps a CJK filename literal (core.quotepath=false)', async () => {
    await fs.writeFile(path.join(root, '说明.txt'), '甲\n')
    await makeRepo(root)
    await fs.writeFile(path.join(root, '说明.txt'), '乙\n')
    const r = await collectWorkspaceDiff(root)
    expect(r.files![0].path).toBe('说明.txt')
  })

  it('flags a binary change', async () => {
    await fs.writeFile(path.join(root, 'b.bin'), Buffer.from([0, 1, 2]))
    await makeRepo(root)
    await fs.writeFile(path.join(root, 'b.bin'), Buffer.from([0, 9, 9, 9]))
    const r = await collectWorkspaceDiff(root)
    expect(r.files![0]).toMatchObject({ path: 'b.bin', binary: true })
  })

  it('treats every file as new in a fresh repo with no HEAD', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n')
    await git(root, 'init')
    const r = await collectWorkspaceDiff(root)
    expect(r.state).toBe('ok')
    expect(r.files![0]).toMatchObject({ path: 'a.txt', additions: 1 })
  })

  it('scopes to the cwd subtree when cwd is inside a larger repo', async () => {
    await fs.mkdir(path.join(root, 'sub'))
    await fs.writeFile(path.join(root, 'top.txt'), 'top\n')
    await fs.writeFile(path.join(root, 'sub', 'inner.txt'), 'in\n')
    await makeRepo(root)
    await fs.writeFile(path.join(root, 'top.txt'), 'TOP\n')
    await fs.writeFile(path.join(root, 'sub', 'inner.txt'), 'IN\n')
    const r = await collectWorkspaceDiff(path.join(root, 'sub'))
    expect(r.files!.map((f) => f.path)).toEqual(['inner.txt']) // cwd-relative, sibling excluded
  })

  it('caps the file list and reports the true total', async () => {
    await makeRepo(root)
    for (let i = 0; i < MAX_DIFF_FILES + 1; i++) {
      await fs.writeFile(path.join(root, `f${String(i).padStart(3, '0')}.txt`), 'x\n')
    }
    const r = await collectWorkspaceDiff(root)
    expect(r.files).toHaveLength(MAX_DIFF_FILES)
    expect(r.totalFiles).toBe(MAX_DIFF_FILES + 1)
  })
})

describe('gitInit', () => {
  it('initializes with a baseline commit so the diff starts clean', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n')
    expect((await gitInit(root)).ok).toBe(true)
    expect(await collectWorkspaceDiff(root)).toEqual({ state: 'ok', files: [], totalFiles: 0 })
    const log = await git(root, 'log', '--oneline')
    expect(log.stdout).toContain('hip baseline')
  })

  it('works in an empty folder (--allow-empty)', async () => {
    expect((await gitInit(root)).ok).toBe(true)
    expect((await collectWorkspaceDiff(root)).state).toBe('ok')
  })

  it('reports failure with an error message', async () => {
    const r = await gitInit(root, 'hip-definitely-missing-git')
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `yarn vitest run packages/sidecar/src/session/workspace-git.test.ts`
Expected: FAIL — `collectWorkspaceDiff` / `gitInit` not exported

- [ ] **Step 3: Implement** (append to `workspace-git.ts`; first replace the file's import/constant header with)

```ts
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
```

Then append the execution layer below `parseUnifiedDiff`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run packages/sidecar/src/session/workspace-git.test.ts`
Expected: PASS (8 parser + 12 collect/init tests)

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/workspace-git.ts packages/sidecar/src/session/workspace-git.test.ts
git commit -m "feat(sidecar): collectWorkspaceDiff + gitInit — worktree-vs-HEAD via system git, cwd-subtree scoped"
```

---

### Task 4: Session wrappers + SessionManager handlers

**Files:**
- Modify: `packages/sidecar/src/session/session.ts` (next to `lsDir`/`readForPreview`, ~line 236)
- Modify: `packages/sidecar/src/session/session-manager.ts` (after the `fs:readCwd` case, ~line 129)
- Create: `packages/sidecar/src/session/session-manager-diff.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/sidecar/src/session/session-manager-diff.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ServerMessage } from '@hip/protocol'
import { SessionManager } from './session-manager.js'

const execFileP = promisify(execFile)

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-mgr-diff-'))
  await fs.writeFile(path.join(root, 'README.md'), '# Hi\n')
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

function setup() {
  const sent: ServerMessage[] = []
  const send = (m: ServerMessage) => sent.push(m)
  const mgr = new SessionManager(undefined, () => new FakeListChatModel({ responses: ['ok'] }), path.join(root, '.scratch'))
  mgr.handle({ type: 'session:create', id: 's1', config: { llmProvider: 'deepseek', model: 'm', tools: [], cwd: root } }, send)
  return { mgr, sent, send }
}
const last = <T extends ServerMessage['type']>(sent: ServerMessage[], type: T) =>
  sent.filter((m) => m.type === type).at(-1) as Extract<ServerMessage, { type: T }>

describe('session-manager diff', () => {
  it('fs:diff on a non-repo cwd reports not_a_repo', async () => {
    const { mgr, sent, send } = setup()
    await mgr.handleAsync({ type: 'fs:diff', sessionId: 's1' }, send)
    expect(last(sent, 'fs:diff:result')).toMatchObject({ sessionId: 's1', state: 'not_a_repo' })
  })

  it('fs:gitInit then fs:diff reports a clean ok state', async () => {
    const { mgr, sent, send } = setup()
    await mgr.handleAsync({ type: 'fs:gitInit', sessionId: 's1' }, send)
    expect(last(sent, 'fs:gitInit:result')).toMatchObject({ sessionId: 's1', ok: true })
    await mgr.handleAsync({ type: 'fs:diff', sessionId: 's1' }, send)
    expect(last(sent, 'fs:diff:result')).toMatchObject({ state: 'ok', files: [], totalFiles: 0 })
  })

  it('fs:diff surfaces a modification made after init', async () => {
    const { mgr, sent, send } = setup()
    await mgr.handleAsync({ type: 'fs:gitInit', sessionId: 's1' }, send)
    await fs.writeFile(path.join(root, 'README.md'), '# Changed\n')
    await mgr.handleAsync({ type: 'fs:diff', sessionId: 's1' }, send)
    const r = last(sent, 'fs:diff:result')
    expect(r.state).toBe('ok')
    expect(r.files![0]).toMatchObject({ path: 'README.md', additions: 1, deletions: 1 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run packages/sidecar/src/session/session-manager-diff.test.ts`
Expected: FAIL — TypeScript error / unhandled message type (`fs:diff` not handled, result never sent)

- [ ] **Step 3: Implement the Session wrappers** (in `session.ts`, after `readForPreview`; add the import at the top of the file next to the `workspace-fs` import)

```ts
import * as workspaceGit from './workspace-git.js'
```

```ts
  /** Worktree-vs-HEAD diff of the bound cwd subtree. Never throws. */
  async workspaceDiff(): Promise<workspaceGit.WorkspaceDiff> {
    if (!this._config.cwd) return { state: 'no_cwd' }
    return workspaceGit.collectWorkspaceDiff(this._config.cwd)
  }

  /** One-click `git init` + baseline commit in the bound cwd. */
  async workspaceGitInit(): Promise<{ ok: boolean; error?: string }> {
    if (!this._config.cwd) return { ok: false, error: 'no_workspace' }
    return workspaceGit.gitInit(this._config.cwd)
  }
```

- [ ] **Step 4: Implement the manager cases** (in `session-manager.ts`, after the `fs:readCwd` case)

```ts
      case 'fs:diff': {
        const r = await this.ensureSession(msg.sessionId).workspaceDiff()
        send({ type: 'fs:diff:result', sessionId: msg.sessionId, ...r })
        break
      }
      case 'fs:gitInit': {
        const r = await this.ensureSession(msg.sessionId).workspaceGitInit()
        send({ type: 'fs:gitInit:result', sessionId: msg.sessionId, ok: r.ok, ...(r.error ? { error: r.error } : {}) })
        break
      }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn vitest run packages/sidecar/src/session/session-manager-diff.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Type-check and commit**

Run: `yarn type-check` — Expected: PASS

```bash
git add packages/sidecar/src/session/session.ts packages/sidecar/src/session/session-manager.ts packages/sidecar/src/session/session-manager-diff.test.ts
git commit -m "feat(sidecar): fs:diff/fs:gitInit handlers via Session workspace wrappers"
```

---

### Task 5: Frontend `diffStore`

**Files:**
- Create: `src/store/diffStore.ts`
- Create: `src/store/diffStore.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/store/diffStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useDiffStore, EMPTY_DIFF } from './diffStore'

beforeEach(() => { useDiffStore.setState({ bySession: {} }) })

describe('diffStore', () => {
  it('setLoading marks the session loading without clearing data', () => {
    useDiffStore.getState().setResult('s1', { state: 'ok', files: [], totalFiles: 0 })
    useDiffStore.getState().setLoading('s1')
    expect(useDiffStore.getState().bySession['s1']).toMatchObject({ status: 'loading', state: 'ok' })
  })

  it('setResult stores files, totalFiles and state', () => {
    const file = { path: 'a.ts', additions: 1, deletions: 0, lines: [] }
    useDiffStore.getState().setResult('s1', { state: 'ok', files: [file], totalFiles: 5 })
    expect(useDiffStore.getState().bySession['s1']).toMatchObject({ status: 'ready', state: 'ok', files: [file], totalFiles: 5 })
  })

  it('setResult defaults files to [] and totalFiles to files length', () => {
    useDiffStore.getState().setResult('s1', { state: 'not_a_repo' })
    expect(useDiffStore.getState().bySession['s1']).toMatchObject({ status: 'ready', files: [], totalFiles: 0 })
  })

  it('setInitPending toggles the flag', () => {
    useDiffStore.getState().setInitPending('s1', true)
    expect(useDiffStore.getState().bySession['s1'].initPending).toBe(true)
  })

  it('clearSession resets to EMPTY_DIFF', () => {
    useDiffStore.getState().setResult('s1', { state: 'ok', files: [], totalFiles: 0 })
    useDiffStore.getState().clearSession('s1')
    expect(useDiffStore.getState().bySession['s1']).toEqual(EMPTY_DIFF)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run src/store/diffStore.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement** (mirrors `fsStore.ts`)

```ts
// src/store/diffStore.ts
import { create } from 'zustand'
import type { DiffFile, DiffState } from '@hip/protocol'

export interface SessionDiff {
  status: 'idle' | 'loading' | 'ready'
  state?: DiffState
  files: DiffFile[]
  totalFiles: number
  error?: string
  initPending: boolean
}

export const EMPTY_DIFF: SessionDiff = { status: 'idle', files: [], totalFiles: 0, initPending: false }

interface DiffStore {
  bySession: Record<string, SessionDiff>
  setLoading: (sessionId: string) => void
  setResult: (sessionId: string, r: { state: DiffState; files?: DiffFile[]; totalFiles?: number; error?: string }) => void
  setInitPending: (sessionId: string, pending: boolean) => void
  clearSession: (sessionId: string) => void
}

function patch(bySession: Record<string, SessionDiff>, id: string, fn: (s: SessionDiff) => SessionDiff): Record<string, SessionDiff> {
  return { ...bySession, [id]: fn(bySession[id] ?? EMPTY_DIFF) }
}

export const useDiffStore = create<DiffStore>((set) => ({
  bySession: {},
  setLoading: (id) =>
    set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, status: 'loading' })) })),
  setResult: (id, r) =>
    set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, status: 'ready', state: r.state, files: r.files ?? [], totalFiles: r.totalFiles ?? r.files?.length ?? 0, error: r.error })) })),
  setInitPending: (id, pending) =>
    set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, initPending: pending })) })),
  clearSession: (id) =>
    set((st) => ({ bySession: { ...st.bySession, [id]: EMPTY_DIFF } })),
}))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run src/store/diffStore.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/store/diffStore.ts src/store/diffStore.test.ts
git commit -m "feat(store): diffStore — per-session workspace-diff view state"
```

---

### Task 6: `sessionService` wiring — request, fold, chain, auto-refresh

**Files:**
- Modify: `src/domain/sessionService.ts`
- Modify: `src/domain/sessionService.test.ts`

- [ ] **Step 1: Write the failing tests** (append a describe block to `sessionService.test.ts`; add the import `import { useDiffStore } from '@/store/diffStore'` at the top, and add `useDiffStore.setState({ bySession: {} })` plus `useUiStore.setState({ scrollTargetMessageId: null, activeTab: 'agents' })` — replacing the existing uiStore reset line — in the file's `beforeEach`)

```ts
describe('workspace diff', () => {
  it('requestDiff sets loading and sends fs:diff, deduping while in flight', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.requestDiff('s1')
    svc.requestDiff('s1') // in flight → dropped
    expect(t.sent.filter((m) => m.type === 'fs:diff')).toHaveLength(1)
    expect(useDiffStore.getState().bySession['s1'].status).toBe('loading')
  })

  it('fs:diff:result folds into diffStore', () => {
    const t = new FakeTransport()
    new SessionService(t)
    t.push({ type: 'fs:diff:result', sessionId: 's1', state: 'ok', files: [], totalFiles: 0 })
    expect(useDiffStore.getState().bySession['s1']).toMatchObject({ status: 'ready', state: 'ok' })
  })

  it('gitInitWorkspace sends fs:gitInit; an ok result chains a fresh fs:diff', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.gitInitWorkspace('s1')
    expect(t.sent.at(-1)).toMatchObject({ type: 'fs:gitInit', sessionId: 's1' })
    expect(useDiffStore.getState().bySession['s1'].initPending).toBe(true)
    t.push({ type: 'fs:gitInit:result', sessionId: 's1', ok: true })
    expect(useDiffStore.getState().bySession['s1'].initPending).toBe(false)
    expect(t.sent.at(-1)).toMatchObject({ type: 'fs:diff', sessionId: 's1' })
  })

  it('a failed fs:gitInit:result keeps not_a_repo with the error inline', () => {
    const t = new FakeTransport()
    new SessionService(t)
    t.push({ type: 'fs:gitInit:result', sessionId: 's1', ok: false, error: 'boom' })
    expect(useDiffStore.getState().bySession['s1']).toMatchObject({ state: 'not_a_repo', error: 'boom', initPending: false })
    expect(t.sent.filter((m) => m.type === 'fs:diff')).toHaveLength(0)
  })

  it('message:complete refreshes the diff only while the Diff tab is active', () => {
    const t = new FakeTransport()
    new SessionService(t)
    const message = { id: 'm1', role: 'assistant' as const, content: 'x', timestamp: 1 }
    t.push({ type: 'message:complete', sessionId: 's1', message })
    expect(t.sent.filter((m) => m.type === 'fs:diff')).toHaveLength(0)
    useUiStore.setState({ activeTab: 'diff' })
    t.push({ type: 'message:complete', sessionId: 's1', message })
    expect(t.sent.filter((m) => m.type === 'fs:diff')).toHaveLength(1)
  })

  it('setProjectDir clears the stale diff for that session', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    useDiffStore.getState().setResult('s1', { state: 'ok', files: [], totalFiles: 0 })
    svc.setProjectDir('s1', '/tmp/other')
    expect(useDiffStore.getState().bySession['s1'].status).toBe('idle')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run src/domain/sessionService.test.ts`
Expected: FAIL — `requestDiff` is not a function

- [ ] **Step 3: Implement in `sessionService.ts`**

Add the import:

```ts
import { useDiffStore } from '@/store/diffStore'
```

Add the public methods (next to `lsDir`/`readFile`):

```ts
  /** Pull the workspace diff. In-flight dedupe: a second request while loading is dropped. */
  requestDiff(sessionId: string): void {
    if (useDiffStore.getState().bySession[sessionId]?.status === 'loading') return
    useDiffStore.getState().setLoading(sessionId)
    this.transport.send({ type: 'fs:diff', sessionId })
  }

  /** One-click `git init` for a non-repo cwd; a successful result chains a fresh diff. */
  gitInitWorkspace(sessionId: string): void {
    useDiffStore.getState().setInitPending(sessionId, true)
    this.transport.send({ type: 'fs:gitInit', sessionId })
  }
```

Extend `receive()` — two new branches after the `fs:readCwd:result` branch, and one line added inside the existing `message:complete` branch:

```ts
    } else if (msg.type === 'fs:diff:result') {
      useDiffStore.getState().setResult(msg.sessionId, { state: msg.state, files: msg.files, totalFiles: msg.totalFiles, error: msg.error })
    } else if (msg.type === 'fs:gitInit:result') {
      useDiffStore.getState().setInitPending(msg.sessionId, false)
      if (msg.ok) this.requestDiff(msg.sessionId)
      else useDiffStore.getState().setResult(msg.sessionId, { state: 'not_a_repo', error: msg.error })
    } else if (msg.type === 'message:complete') {
      // (existing fs re-pull body stays unchanged; append:)
      if (useUiStore.getState().activeTab === 'diff') this.requestDiff(msg.sessionId)
    }
```

Extend `setProjectDir` — add one line next to the existing `useFsStore` clear:

```ts
    useDiffStore.getState().clearSession(id)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run src/domain/sessionService.test.ts`
Expected: PASS (all existing + 6 new)

- [ ] **Step 5: Commit**

```bash
git add src/domain/sessionService.ts src/domain/sessionService.test.ts
git commit -m "feat(domain): requestDiff/gitInitWorkspace + result folding + diff-tab auto-refresh"
```

---

### Task 7: i18n — `artifact.diffView` keys (en / zh-CN / zh-TW)

**Files:**
- Modify: `src/i18n/en.ts` (inside the `artifact` block, ~line 60)
- Modify: `src/i18n/zh-CN.ts` (same position)
- Modify: `src/i18n/zh-TW.ts` (same position)

Note: the existing `artifact.noDiff` / `artifact.noDiffDesc` keys stay for now — `DiffViewer` still references them until Task 8 removes both together.

- [ ] **Step 1: Add the en keys** (inside `artifact: { … }`)

```ts
      diffView: {
        noSession: 'No active conversation',
        noSessionDesc: 'Open a conversation to see its workspace changes',
        notRepo: 'Not a git repository',
        notRepoDesc: 'Initialize git to start tracking changes in this folder',
        initButton: 'Initialize git repository',
        gitMissing: 'git not found',
        gitMissingDesc: 'Install git (e.g. Xcode Command Line Tools) and retry',
        noCwd: 'No project folder',
        noCwdDesc: 'Bind a project folder in the Files tab first',
        clean: 'Working tree clean',
        cleanDesc: 'Uncommitted changes will appear here',
        error: 'Could not read changes',
        retry: 'Retry',
        changedFiles: '{{count}} changed files',
        moreFiles: 'and {{count}} more files',
        binary: 'Binary file changed',
      },
```

- [ ] **Step 2: Add the zh-CN keys**

```ts
      diffView: {
        noSession: '没有进行中的对话',
        noSessionDesc: '打开一个对话以查看其工作区改动',
        notRepo: '不是 git 仓库',
        notRepoDesc: '初始化 git 后即可跟踪此文件夹的改动',
        initButton: '初始化 git 仓库',
        gitMissing: '未找到 git',
        gitMissingDesc: '请安装 git（如 Xcode 命令行工具）后重试',
        noCwd: '未绑定项目文件夹',
        noCwdDesc: '请先在“文件”页绑定项目文件夹',
        clean: '工作区干净',
        cleanDesc: '未提交的改动将显示在这里',
        error: '无法读取改动',
        retry: '重试',
        changedFiles: '{{count}} 个文件有改动',
        moreFiles: '还有 {{count}} 个文件',
        binary: '二进制文件已更改',
      },
```

- [ ] **Step 3: Add the zh-TW keys**

```ts
      diffView: {
        noSession: '沒有進行中的對話',
        noSessionDesc: '開啟一個對話以查看其工作區變更',
        notRepo: '不是 git 倉庫',
        notRepoDesc: '初始化 git 後即可追蹤此資料夾的變更',
        initButton: '初始化 git 倉庫',
        gitMissing: '未找到 git',
        gitMissingDesc: '請安裝 git（如 Xcode 命令列工具）後重試',
        noCwd: '未綁定專案資料夾',
        noCwdDesc: '請先在「檔案」頁綁定專案資料夾',
        clean: '工作區乾淨',
        cleanDesc: '未提交的變更將顯示在這裡',
        error: '無法讀取變更',
        retry: '重試',
        changedFiles: '{{count}} 個檔案有變更',
        moreFiles: '還有 {{count}} 個檔案',
        binary: '二進位檔案已更改',
      },
```

- [ ] **Step 4: Verify and commit**

Run: `yarn type-check`
Expected: PASS (en is the type source; all three stay in parity)

```bash
git add src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "feat(i18n): artifact.diffView keys (en/zh-CN/zh-TW)"
```

---

### Task 8: `DiffViewer` — render the real diff

**Files:**
- Modify: `src/components/artifact/DiffViewer.tsx` (full rewrite below)
- Modify: `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts` (REMOVE the now-unused `noDiff` and `noDiffDesc` keys from all three `artifact` blocks)

No component tests (project rule). Type-check + E2E (Task 9) cover this.

- [ ] **Step 1: Rewrite `DiffViewer.tsx`**

```tsx
import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, Loader2, RefreshCw } from 'lucide-react'
import type { DiffFile, DiffLineType } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { useDomainStore } from '@/domain/sessionStore'
import { sessionService } from '@/domain/sessionService'
import { useDiffStore, EMPTY_DIFF } from '@/store/diffStore'
import { Button } from '@/components/ui/Button'

function lineStyle(type: DiffLineType): string {
  if (type === 'add') return 'bg-success/10'
  if (type === 'del') return 'bg-danger/10'
  return ''
}

function sign(type: DiffLineType): string {
  if (type === 'add') return '+'
  if (type === 'del') return '-'
  return ' '
}

function FileDiff({ file }: { file: DiffFile }) {
  const { t } = useTranslation()
  return (
    <div className="border-b border-border" data-testid="diff-file">
      <div className="flex items-center justify-between bg-surface-muted px-3 py-2">
        <span className="truncate font-mono text-[12px] text-ink">{file.path}</span>
        <span className="flex shrink-0 items-center gap-2 text-[11px]">
          {file.truncated && <span className="text-ink-tertiary">{t('artifact.truncated')}</span>}
          <span className="text-success">+{file.additions}</span>
          <span className="text-danger">-{file.deletions}</span>
        </span>
      </div>
      {file.binary ? (
        <div className="px-3 py-2 text-[12px] text-ink-tertiary">{t('artifact.diffView.binary')}</div>
      ) : (
        <div className="overflow-x-auto font-mono text-[12.5px] leading-relaxed">
          {file.lines.map((line, i) => (
            <div key={i} className={cn('flex', lineStyle(line.type))}>
              <span className="w-10 shrink-0 select-none px-1 text-right text-ink-tertiary">{line.oldNo ?? ''}</span>
              <span className="w-10 shrink-0 select-none px-1 text-right text-ink-tertiary">{line.newNo ?? ''}</span>
              <span
                className={cn(
                  'w-4 shrink-0 select-none text-center',
                  line.type === 'add' && 'text-success',
                  line.type === 'del' && 'text-danger',
                )}
              >
                {sign(line.type)}
              </span>
              <span className="whitespace-pre px-1 text-ink">{line.content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Empty({ icon, title, desc, children }: { icon?: ReactNode; title: string; desc?: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-ink-tertiary">
      <span className="text-[24px] opacity-40">{icon ?? '±'}</span>
      <div className="text-[13px]">{title}</div>
      {desc && <div className="max-w-[220px] text-center text-[12px] opacity-70">{desc}</div>}
      {children}
    </div>
  )
}

export function DiffViewer() {
  const { t } = useTranslation()
  const sessionId = useDomainStore((s) => s.activeSessionId)
  const diff = useDiffStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) ?? EMPTY_DIFF

  // Radix unmounts inactive TabsContent, so mount === tab activation (and session switches re-run it).
  useEffect(() => {
    if (sessionId) sessionService.requestDiff(sessionId)
  }, [sessionId])

  if (!sessionId) {
    return <Empty title={t('artifact.diffView.noSession')} desc={t('artifact.diffView.noSessionDesc')} />
  }

  if (diff.status !== 'ready') {
    return (
      <div className="flex h-full items-center justify-center text-ink-tertiary">
        <Loader2 size={16} className="animate-spin" />
      </div>
    )
  }

  if (diff.state === 'no_cwd') {
    return <Empty title={t('artifact.diffView.noCwd')} desc={t('artifact.diffView.noCwdDesc')} />
  }

  if (diff.state === 'git_missing') {
    return <Empty title={t('artifact.diffView.gitMissing')} desc={t('artifact.diffView.gitMissingDesc')} />
  }

  if (diff.state === 'not_a_repo') {
    return (
      <Empty icon={<GitBranch size={24} />} title={t('artifact.diffView.notRepo')} desc={t('artifact.diffView.notRepoDesc')}>
        <Button size="sm" data-testid="diff-init" disabled={diff.initPending} onClick={() => sessionService.gitInitWorkspace(sessionId)}>
          {diff.initPending && <Loader2 size={13} className="mr-1.5 animate-spin" />}
          {t('artifact.diffView.initButton')}
        </Button>
        {diff.error && <div className="max-w-[220px] text-center text-[12px] text-danger">{diff.error}</div>}
      </Empty>
    )
  }

  if (diff.state === 'error') {
    return (
      <Empty title={t('artifact.diffView.error')} desc={diff.error}>
        <Button size="sm" variant="secondary" onClick={() => sessionService.requestDiff(sessionId)}>
          {t('artifact.diffView.retry')}
        </Button>
      </Empty>
    )
  }

  // state === 'ok'
  return (
    <div className="flex h-full flex-col" data-testid="diff-view">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-2">
        <span className="text-[12px] text-ink-secondary">{t('artifact.diffView.changedFiles', { count: diff.totalFiles })}</span>
        <button
          title={t('artifact.refresh')}
          data-testid="diff-refresh"
          onClick={() => sessionService.requestDiff(sessionId)}
          className="rounded p-1 text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink"
        >
          <RefreshCw size={13} />
        </button>
      </div>
      {diff.files.length === 0 ? (
        <div data-testid="diff-clean" className="flex-1">
          <Empty title={t('artifact.diffView.clean')} desc={t('artifact.diffView.cleanDesc')} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {diff.files.map((file) => (
            <FileDiff key={file.path} file={file} />
          ))}
          {diff.totalFiles > diff.files.length && (
            <div className="px-3 py-2 text-[12px] text-ink-tertiary">
              {t('artifact.diffView.moreFiles', { count: diff.totalFiles - diff.files.length })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Remove the dead keys** — delete `noDiff` and `noDiffDesc` lines from the `artifact` block in `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`.

- [ ] **Step 3: Verify**

Run: `yarn type-check` — Expected: PASS (proves no other component referenced the removed keys)
Run: `yarn vitest run src` — Expected: PASS (frontend suites unaffected)

- [ ] **Step 4: Commit**

```bash
git add src/components/artifact/DiffViewer.tsx src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "feat(chat): DiffViewer renders the real workspace diff with init/error/clean states"
```

---

### Task 9: E2E — non-repo init flow on a real machine

**Files:**
- Create: `e2e/specs/diff-workspace.spec.ts`

Environment notes (from prior E2E work): the spec drives the built app via wdio+tauri; rebuild the dev sidecar shim first if the bundle is stale (`bash scripts/make-sidecar-dev-bin.sh`), and expect a keychain prompt on first launch after a rebuild. The folder dialog is bypassed through the `__hipPickDir` seam. Committing the session sends one message — with no/fake API key the turn errors gracefully, which is fine: the Diff tab does not depend on a successful LLM turn.

- [ ] **Step 1: Write the spec**

```ts
// e2e/specs/diff-workspace.spec.ts
import { expect } from 'expect-webdriverio'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// A disposable NON-repo folder — init must never touch the repo-tracked fixtures.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hip-e2e-diff-'))
fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello\n')

describe('workspace git diff', () => {
  before(async () => {
    await browser.pause(2500)
    const skip = await browser.$('button=跳过登录')
    if (await skip.isExisting()) {
      await browser.execute((el: HTMLElement) => el.click(), (await skip) as unknown as HTMLElement)
      await browser.waitUntil(async () => (await browser.getUrl()).includes('#/app'), { timeout: 10000, interval: 200 })
    }
    await browser.execute((d: string) => {
      ;(window as unknown as { __hipPickDir?: () => Promise<string> }).__hipPickDir = () => Promise.resolve(d)
    }, dir)
  })

  after(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('commits a session bound to the temp folder', async () => {
    await (await browser.$('[data-testid="new-conversation"]')).waitForExist({ timeout: 120000 })
    await (await browser.$('[data-testid="pick-folder"]')).click()
    await (await browser.$(`[data-testid="tree-entry"][data-path$="/hello.txt"]`)).waitForExist({ timeout: 60000 })
    const ta = await browser.$('[data-testid="new-conversation"] textarea')
    await ta.click()
    await browser.keys('diff e2e')
    const send = await browser.$('[data-testid="new-conversation"] [data-testid="composer-send"]')
    await send.waitForEnabled({ timeout: 10000 })
    await send.click()
    await (await browser.$('[data-testid="new-conversation"]')).waitForExist({ reverse: true, timeout: 30000 })
  })

  it('shows the not-a-repo state with an init button on the Diff tab', async () => {
    await (await browser.$('[data-testid="tab-diff"]')).click()
    await (await browser.$('[data-testid="diff-init"]')).waitForExist({ timeout: 30000 })
  })

  it('one-click init produces a clean baseline', async () => {
    await (await browser.$('[data-testid="diff-init"]')).click()
    await (await browser.$('[data-testid="diff-clean"]')).waitForExist({ timeout: 30000 })
  })

  it('an out-of-band file change appears after manual refresh', async () => {
    fs.writeFileSync(path.join(dir, 'hello.txt'), 'changed\n')
    await (await browser.$('[data-testid="diff-refresh"]')).click()
    const file = await browser.$('[data-testid="diff-file"]')
    await file.waitForExist({ timeout: 30000 })
    await browser.waitUntil(async () => (await file.getText()).includes('hello.txt'), { timeout: 10000, interval: 500 })
  })
})
```

- [ ] **Step 2: Run only this spec**

Run: `E2E_GREP="workspace git diff" yarn test:e2e`
Expected: 4 passing (paid-call-free — the one message send may error without an API key; unrelated to these assertions)

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/diff-workspace.spec.ts
git commit -m "test(e2e): workspace git diff — non-repo init flow + refresh surfaces a change"
```

---

### Task 10: Full gates

- [ ] **Step 1: Full unit suite** — `yarn test` — Expected: all green (live DeepSeek integration tests fire only when `DEEPSEEK_API_KEY` is set, per repo norm)
- [ ] **Step 2: Types** — `yarn type-check` — Expected: PASS
- [ ] **Step 3: Build** — `yarn build` — Expected: PASS
- [ ] **Step 4: Fix anything that fails, amend or add commits as appropriate**

---

## Manual GUI acceptance (user-side, post-merge — list for the acceptance pass)

1. Open a session bound to a real git repo → Diff tab shows uncommitted changes with +/- counts; refresh works.
2. Bind a non-repo folder → init empty state → click init → clean state; folder now has `.git` with a "hip baseline" commit.
3. Ask the agent to edit a file → after the turn completes with the Diff tab open, the change appears without manual refresh.
4. zh-CN / zh-TW labels render on all empty states.
