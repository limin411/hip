import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseUnifiedDiff, collectWorkspaceDiff, collectWorkspaceDiffSummary, collectWorkspaceDiffFile, gitInit, captureSessionSnapshot, sanitizeRefComponent, isSafeBranchName, getCurrentBranch, listCheckpointRefs, deleteCheckpointRefs, captureCheckpoint, collectCommitLog, listBranches, switchBranch, gitCommit, gitCreateBranch, gitSwitchBranch, revertToCheckpoint, checkpointRefMeta, MAX_DIFF_LINES_PER_FILE, MAX_DIFF_FILES } from './workspace-git.js'

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

const RENAME = `diff --git a/old.txt b/new.txt
similarity index 80%
rename from old.txt
rename to new.txt
index 1234567..89abcde 100644
--- a/old.txt
+++ b/new.txt
@@ -1,2 +1,2 @@
 keep
-x
+y
`

describe('parseUnifiedDiff', () => {
  it('parses a modified file into hunks with per-hunk line numbers', () => {
    const [f] = parseUnifiedDiff(MODIFY)
    expect(f).toMatchObject({ path: 'src/app.ts', status: 'modified', additions: 2, deletions: 1 })
    expect(f.hunks).toHaveLength(1)
    expect(f.hunks[0]).toMatchObject({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4 })
    expect(f.hunks[0].lines).toEqual([
      { type: 'ctx', content: 'const a = 1', oldNo: 1, newNo: 1 },
      { type: 'del', content: 'const b = 2', oldNo: 2, newNo: null },
      { type: 'add', content: 'const b = 3', oldNo: null, newNo: 2 },
      { type: 'add', content: 'const c = 4', oldNo: null, newNo: 3 },
      { type: 'ctx', content: 'export {}', oldNo: 3, newNo: 4 },
    ])
  })

  it('keeps each hunk separate (no flattening across @@ boundaries)', () => {
    const TWO_HUNKS = `diff --git a/m.ts b/m.ts
--- a/m.ts
+++ b/m.ts
@@ -1,2 +1,2 @@
 top
-one
+ONE
@@ -10,2 +10,2 @@
 middle
-ten
+TEN
`
    const [f] = parseUnifiedDiff(TWO_HUNKS)
    expect(f.hunks).toHaveLength(2)
    expect(f.hunks[1]).toMatchObject({ oldStart: 10, newStart: 10 })
    expect(f.hunks[1].lines[0]).toEqual({ type: 'ctx', content: 'middle', oldNo: 10, newNo: 10 })
  })

  it('splits multiple files', () => {
    const files = parseUnifiedDiff(MODIFY + NEW_FILE)
    expect(files.map((f) => f.path)).toEqual(['src/app.ts', 'notes.md'])
  })

  it('marks a new file added', () => {
    const [f] = parseUnifiedDiff(NEW_FILE)
    expect(f).toMatchObject({ path: 'notes.md', status: 'added', additions: 2, deletions: 0 })
    expect(f.hunks[0].lines.every((l) => l.type === 'add')).toBe(true)
  })

  it('marks a deleted file deleted (path from a/ side)', () => {
    const [f] = parseUnifiedDiff(DELETED)
    expect(f).toMatchObject({ path: 'gone.txt', status: 'deleted', additions: 0, deletions: 2 })
  })

  it('detects a rename with oldPath and counts only content changes', () => {
    const [f] = parseUnifiedDiff(RENAME)
    expect(f).toMatchObject({ path: 'new.txt', oldPath: 'old.txt', status: 'renamed', additions: 1, deletions: 1 })
  })

  it('flags a binary change with no hunks', () => {
    const [f] = parseUnifiedDiff(BINARY)
    expect(f).toMatchObject({ path: 'logo.png', status: 'modified', binary: true, hunks: [] })
  })

  it('marks noNewline on the affected lines', () => {
    const [f] = parseUnifiedDiff(NO_NEWLINE)
    const lines = f.hunks[0].lines
    expect(lines.map((l) => l.type)).toEqual(['del', 'add'])
    expect(lines.every((l) => l.noNewline === true)).toBe(true)
  })

  it('caps lines per file across hunks and flags truncated', () => {
    const adds = Array.from({ length: MAX_DIFF_LINES_PER_FILE + 100 }, (_, i) => `+line ${i}`).join('\n')
    const big = `diff --git a/big.txt b/big.txt\n--- /dev/null\n+++ b/big.txt\n@@ -0,0 +1,${MAX_DIFF_LINES_PER_FILE + 100} @@\n${adds}\n`
    const [f] = parseUnifiedDiff(big)
    expect(f.hunks.reduce((n, h) => n + h.lines.length, 0)).toBe(MAX_DIFF_LINES_PER_FILE)
    expect(f.truncated).toBe(true)
    expect(f.additions).toBe(MAX_DIFF_LINES_PER_FILE + 100) // 计数 pre-truncation
  })

  it('emits a mode-change-only file with zero hunks (path from the header)', () => {
    const MODE_ONLY = `diff --git a/run.sh b/run.sh
old mode 100644
new mode 100755
`
    const [f] = parseUnifiedDiff(MODE_ONLY)
    expect(f).toMatchObject({ path: 'run.sh', status: 'modified', additions: 0, deletions: 0, hunks: [] })
  })

  it('returns [] for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })
})

describe('collectWorkspaceDiff', () => {
  it('reports not_a_repo for a plain folder', async () => {
    expect((await collectWorkspaceDiff(root)).state).toBe('not_a_repo')
  })
  it('reports git_missing when the git binary is absent', async () => {
    expect((await collectWorkspaceDiff(root, { gitBin: 'hip-missing-git' })).state).toBe('git_missing')
  })
  it('reports ok with empty summary for a clean repo', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    const r = await collectWorkspaceDiff(root)
    expect(r.state).toBe('ok'); expect(r.files).toEqual([])
    expect(r.summary).toEqual({ totalFiles: 0, totalAdditions: 0, totalDeletions: 0 })
  })
  it('reports a modified tracked file with cwd-relative path + summary totals', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
    const r = await collectWorkspaceDiff(root)
    expect(r.files![0]).toMatchObject({ path: 'a.txt', status: 'modified', additions: 1, deletions: 1 })
    expect(r.summary).toEqual({ totalFiles: 1, totalAdditions: 1, totalDeletions: 1 })
  })
  it('reports a deleted file', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\ntwo\n'); await makeRepo(root)
    await fs.rm(path.join(root, 'a.txt'))
    expect((await collectWorkspaceDiff(root)).files![0]).toMatchObject({ path: 'a.txt', status: 'deleted', deletions: 2 })
  })
  it('shows an untracked file as added via the now-tree', async () => {
    await makeRepo(root)
    await fs.writeFile(path.join(root, 'new.txt'), 'x\ny\n')
    const r = await collectWorkspaceDiff(root)
    expect(r.files![0]).toMatchObject({ path: 'new.txt', status: 'added', additions: 2 })
    expect(r.files![0].hunks[0].lines.map((l) => l.content)).toEqual(['x', 'y'])
  })
  it('detects a rename instead of delete+add (B2)', async () => {
    await fs.writeFile(path.join(root, 'old.txt'), 'a\nb\nc\nd\n'); await makeRepo(root)
    await fs.rename(path.join(root, 'old.txt'), path.join(root, 'new.txt'))
    const r = await collectWorkspaceDiff(root)
    expect(r.files).toHaveLength(1)
    expect(r.files![0]).toMatchObject({ path: 'new.txt', oldPath: 'old.txt', status: 'renamed' })
    expect(r.summary!.totalFiles).toBe(1)
  })
  it('keeps a CJK filename literal', async () => {
    await fs.writeFile(path.join(root, '说明.txt'), '甲\n'); await makeRepo(root)
    await fs.writeFile(path.join(root, '说明.txt'), '乙\n')
    expect((await collectWorkspaceDiff(root)).files![0].path).toBe('说明.txt')
  })
  it('handles a path containing spaces (B5)', async () => {
    await fs.writeFile(path.join(root, 'my file.txt'), 'a\n'); await makeRepo(root)
    await fs.writeFile(path.join(root, 'my file.txt'), 'b\n')
    expect((await collectWorkspaceDiff(root)).files![0].path).toBe('my file.txt')
  })
  it('flags a binary change', async () => {
    await fs.writeFile(path.join(root, 'b.bin'), Buffer.from([0, 1, 2])); await makeRepo(root)
    await fs.writeFile(path.join(root, 'b.bin'), Buffer.from([0, 9, 9, 9]))
    expect((await collectWorkspaceDiff(root)).files![0]).toMatchObject({ path: 'b.bin', binary: true })
  })
  it('treats every file as new in a fresh repo with no HEAD', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await git(root, 'init')
    const r = await collectWorkspaceDiff(root)
    expect(r.state).toBe('ok'); expect(r.files![0]).toMatchObject({ path: 'a.txt', status: 'added', additions: 1 })
  })
  it('scopes to the cwd subtree', async () => {
    await fs.mkdir(path.join(root, 'sub'))
    await fs.writeFile(path.join(root, 'top.txt'), 'top\n')
    await fs.writeFile(path.join(root, 'sub', 'inner.txt'), 'in\n'); await makeRepo(root)
    await fs.writeFile(path.join(root, 'top.txt'), 'TOP\n')
    await fs.writeFile(path.join(root, 'sub', 'inner.txt'), 'IN\n')
    expect((await collectWorkspaceDiff(path.join(root, 'sub'))).files!.map((f) => f.path)).toEqual(['inner.txt'])
  })
  it('caps the file list but counts the true total in summary', async () => {
    await makeRepo(root)
    for (let i = 0; i < MAX_DIFF_FILES + 1; i++) await fs.writeFile(path.join(root, `f${String(i).padStart(3, '0')}.txt`), 'x\n')
    const r = await collectWorkspaceDiff(root)
    expect(r.files).toHaveLength(MAX_DIFF_FILES)
    expect(r.summary!.totalFiles).toBe(MAX_DIFF_FILES + 1)
  })
  it('does not render a symlink target content', async () => {
    await makeRepo(root)
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-wsgit-out-'))
    try {
      await fs.writeFile(path.join(outside, 'secret.txt'), 'TOP SECRET\n')
      await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'))
      const r = await collectWorkspaceDiff(root)
      expect(r.state).toBe('ok'); expect(JSON.stringify(r.files)).not.toContain('TOP SECRET')
    } finally { await fs.rm(outside, { recursive: true, force: true }) }
  })
  it('diffs base tree → an explicit headSha tree (tree↔tree), ignoring the live working tree', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    // capture a tree with a.txt edited; this becomes the fixed head
    await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
    const headTree = await captureSessionSnapshot(root)
    expect(headTree).toBeTruthy()
    // now dirty the working tree differently — it must NOT appear because headSha pins the head
    await fs.writeFile(path.join(root, 'a.txt'), 'three\n')
    await fs.writeFile(path.join(root, 'b.txt'), 'noise\n')
    const r = await collectWorkspaceDiff(root, { base: 'head', headSha: headTree! })
    expect(r.state).toBe('ok')
    expect(r.files!.map((f) => f.path)).toEqual(['a.txt'])      // only the pinned head's change
    expect(r.files![0]).toMatchObject({ additions: 1, deletions: 1 })
  })
})

describe('collectWorkspaceDiffSummary', () => {
  it('returns only totals, no files', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    await fs.writeFile(path.join(root, 'a.txt'), 'two\nthree\n')
    await fs.writeFile(path.join(root, 'new.txt'), 'x\n')
    const r = await collectWorkspaceDiffSummary(root)
    expect(r.state).toBe('ok'); expect(r.files).toBeUndefined()
    expect(r.summary).toEqual({ totalFiles: 2, totalAdditions: 3, totalDeletions: 1 })
  })
  it('reports not_a_repo for a plain folder', async () => {
    expect((await collectWorkspaceDiffSummary(root)).state).toBe('not_a_repo')
  })
})

describe('gitInit', () => {
  it('initializes with a baseline commit so the diff starts clean', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n')
    expect((await gitInit(root)).ok).toBe(true)
    const initDiff = await collectWorkspaceDiff(root)
    expect(initDiff.state).toBe('ok')
    expect(initDiff.files).toEqual([])
    expect(initDiff.summary).toEqual({ totalFiles: 0, totalAdditions: 0, totalDeletions: 0 })
    const log = await git(root, 'log', '--oneline')
    expect(log.stdout).toContain('hip baseline')
    expect((await git(root, 'log', '--format=%an')).stdout.trim()).toBe('hip')
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

describe('collectWorkspaceDiffFile', () => {
  it('returns one file with full context', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n') + '\n')
    await makeRepo(root)
    await fs.writeFile(path.join(root, 'a.txt'), Array.from({ length: 30 }, (_, i) => (i === 15 ? 'CHANGED' : `l${i}`)).join('\n') + '\n')
    const r = await collectWorkspaceDiffFile(root, 'a.txt', { context: 'full' })
    expect(r.state).toBe('ok')
    const ctxLines = r.file!.hunks.reduce((n, h) => n + h.lines.filter((l) => l.type === 'ctx').length, 0)
    expect(ctxLines).toBeGreaterThan(20) // 全文上下文
  })
})

describe('captureSessionSnapshot + session-start base', () => {
  it('snapshot then diff session-start shows only post-snapshot changes', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    await fs.writeFile(path.join(root, 'pre.txt'), 'pre-existing\n') // 会话前已存在的未提交改动
    const snap = await captureSessionSnapshot(root)
    expect(snap).toBeTruthy()
    await fs.writeFile(path.join(root, 'agent.txt'), 'by agent\n')   // 会话内 agent 新建
    const r = await collectWorkspaceDiff(root, { base: 'session-start', baseSha: snap })
    expect(r.files!.map((f) => f.path)).toEqual(['agent.txt'])        // pre.txt 不计入
    const head = await collectWorkspaceDiff(root, { base: 'head' })
    expect(head.files!.map((f) => f.path).sort()).toEqual(['agent.txt', 'pre.txt']) // HEAD 仍显示两者
  })
  it('returns null for a non-repo folder', async () => {
    expect(await captureSessionSnapshot(root)).toBeNull()
  })
})

describe('sanitizeRefComponent', () => {
  it('passes alnum / dash / underscore through unchanged', () => {
    expect(sanitizeRefComponent('asst-supervisor-123_4')).toBe('asst-supervisor-123_4')
  })
  it('replaces unsafe chars with a stable hash (no slashes, dots, spaces, CJK)', () => {
    const a = sanitizeRefComponent('a/b .c~说明')
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(a).toBe(sanitizeRefComponent('a/b .c~说明')) // deterministic
    expect(a).not.toBe(sanitizeRefComponent('different'))
  })
  it('returns a non-empty token for an empty input', () => {
    expect(sanitizeRefComponent('')).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('getCurrentBranch + listCheckpointRefs', () => {
  it('returns the current branch name for a repo with a HEAD', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    await git(root, 'branch', '-m', 'main')
    expect(await getCurrentBranch(root)).toBe('main')
  })
  it('returns null for a non-repo folder', async () => {
    expect(await getCurrentBranch(root)).toBeNull()
  })
  it('lists hip checkpoint refs under a session prefix', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    const head = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
    await git(root, 'update-ref', 'refs/hip/checkpoints/sess1/t1', head)
    await git(root, 'update-ref', 'refs/hip/checkpoints/sess1/t2', head)
    await git(root, 'update-ref', 'refs/hip/checkpoints/other/x', head)
    const refs = await listCheckpointRefs(root, 'sess1')
    expect(refs.sort()).toEqual(['refs/hip/checkpoints/sess1/t1', 'refs/hip/checkpoints/sess1/t2'])
  })
  it('returns [] when there are no refs for the session', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    expect(await listCheckpointRefs(root, 'nope')).toEqual([])
  })
  it('lists refs for an unsafe sessionId (list/write share sanitizeRefComponent)', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    const head = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
    const unsafe = 'sess/说明 1' // sanitized to a hash component by captureCheckpoint
    await git(root, 'update-ref', `refs/hip/checkpoints/${sanitizeRefComponent(unsafe)}/t1`, head)
    const refs = await listCheckpointRefs(root, unsafe)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toBe(`refs/hip/checkpoints/${sanitizeRefComponent(unsafe)}/t1`)
  })
})

describe('deleteCheckpointRefs', () => {
  it('removes all checkpoint refs for a session (listCheckpointRefs → [] after)', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    const head = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
    // two checkpoints (distinct trees so neither is an empty-turn skip)
    await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
    const c1 = await captureCheckpoint(root, { sessionId: 's1', turnId: 't1', label: 'a', prevCommit: head })
    await fs.writeFile(path.join(root, 'a.txt'), 'three\n')
    const c2 = await captureCheckpoint(root, { sessionId: 's1', turnId: 't2', label: 'b', prevCommit: c1.commitSha! })
    expect(c1.ok && c2.ok).toBe(true)
    expect((await listCheckpointRefs(root, 's1')).length).toBe(2)
    await deleteCheckpointRefs(root, 's1')
    expect(await listCheckpointRefs(root, 's1')).toEqual([])
  })
  it('only deletes the targeted session\'s refs', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    const head = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
    await git(root, 'update-ref', 'refs/hip/checkpoints/s1/t1', head)
    await git(root, 'update-ref', 'refs/hip/checkpoints/other/x', head)
    await deleteCheckpointRefs(root, 's1')
    expect(await listCheckpointRefs(root, 's1')).toEqual([])
    expect(await listCheckpointRefs(root, 'other')).toEqual(['refs/hip/checkpoints/other/x'])
  })
  it('never throws on a non-repo folder', async () => {
    await expect(deleteCheckpointRefs(root, 's1')).resolves.toBeUndefined()
  })
})

describe('captureCheckpoint', () => {
  it('captures a tree+commit, ref-protects it, and parents to prevCommit', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    const headCommit = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
    await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
    const r = await captureCheckpoint(root, { sessionId: 's1', turnId: 't1', label: 'edit a', prevCommit: headCommit })
    expect(r.ok).toBe(true)
    expect(r.treeSha).toBeTruthy()
    expect(r.commitSha).toBeTruthy()
    // ref exists and points at the commit
    const refTarget = (await git(root, 'rev-parse', 'refs/hip/checkpoints/s1/t1')).stdout.trim()
    expect(refTarget).toBe(r.commitSha)
    // parent is prevCommit
    const parent = (await git(root, 'rev-parse', `${r.commitSha}^`)).stdout.trim()
    expect(parent).toBe(headCommit)
    // author is the synthetic hip identity (never a real commit)
    expect((await git(root, 'show', '-s', '--format=%an', r.commitSha!)).stdout.trim()).toBe('hip')
  })

  it('skips an empty turn (working tree identical to prevCommit tree)', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    const headCommit = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
    const r = await captureCheckpoint(root, { sessionId: 's1', turnId: 't1', label: 'noop', prevCommit: headCommit })
    expect(r.ok).toBe(true)
    expect(r.skipped).toBe(true)
    expect(r.commitSha).toBeUndefined()
    expect(await listCheckpointRefs(root, 's1')).toEqual([]) // no ref created
  })

  it('captures with no parent on an unborn HEAD (fresh git init)', async () => {
    await git(root, 'init')
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n')
    const r = await captureCheckpoint(root, { sessionId: 's1', turnId: 't1', label: 'first', prevCommit: null })
    expect(r.ok).toBe(true)
    expect(r.skipped).toBeFalsy()
    expect(r.commitSha).toBeTruthy()
    // a root commit has no parent
    const parents = (await git(root, 'rev-list', '--parents', '-n', '1', r.commitSha!)).stdout.trim().split(' ')
    expect(parents).toHaveLength(1) // just the commit sha, no parents
  })

  it('sanitizes an unsafe turnId into a valid ref', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    const headCommit = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
    await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
    const r = await captureCheckpoint(root, { sessionId: 's1', turnId: 'a/b .c', label: 'x', prevCommit: headCommit })
    expect(r.ok).toBe(true)
    const refs = await listCheckpointRefs(root, 's1')
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatch(/^refs\/hip\/checkpoints\/s1\/h[a-f0-9]{16}$/)
  })

  it('returns ok:false for a non-repo folder (never throws)', async () => {
    const r = await captureCheckpoint(root, { sessionId: 's1', turnId: 't1', label: 'x', prevCommit: null })
    expect(r.ok).toBe(false)
  })
})

describe('collectCommitLog', () => {
  it('lists commits in session-start..HEAD newest-first with short sha + author', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    const start = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
    await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
    await git(root, 'add', '-A'); await git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'second')
    await fs.writeFile(path.join(root, 'a.txt'), 'three\n')
    await git(root, 'add', '-A'); await git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'third')
    const r = await collectCommitLog(root, start)
    expect(r.state).toBe('ok')
    expect(r.commits!.map((c) => c.message)).toEqual(['third', 'second']) // start excluded, newest-first
    expect(r.commits![0]).toMatchObject({ author: 't' })
    expect(r.commits![0].shortSha.length).toBeGreaterThanOrEqual(7)
  })
  it('lists ALL commits when startCommit is null (whole history)', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root) // 'init'
    const r = await collectCommitLog(root, null)
    expect(r.state).toBe('ok')
    expect(r.commits!.map((c) => c.message)).toEqual(['init'])
  })
  it('reports not_a_repo for a plain folder', async () => {
    expect((await collectCommitLog(root, null)).state).toBe('not_a_repo')
  })
  it('caps full-history results to 100 with --max-count', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), '0\n')
    await makeRepo(root)
    await git(root, 'config', 'user.name', 'test')
    await git(root, 'config', 'user.email', 'test@test')
    for (let i = 0; i < 105; i++) {
      await fs.writeFile(path.join(root, 'a.txt'), `commit-${i}\n`)
      await git(root, 'add', '-A')
      await git(root, 'commit', '-m', `commit-${i}`)
    }
    const r = await collectCommitLog(root, null)
    expect(r.state).toBe('ok')
    expect(r.commits!.length).toBe(100)
    expect(r.commits![0].message).toBe('commit-104')
    expect(r.commits![99].message).toBe('commit-5')
  }, { timeout: 30000 })
})

describe('listBranches + switchBranch', () => {
  it('lists branches with the current one flagged', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    await git(root, 'branch', '-m', 'main')
    await git(root, 'branch', 'feature')
    const r = await listBranches(root)
    expect(r.ok).toBe(true)
    expect(r.branches!.map((b) => b.name).sort()).toEqual(['feature', 'main'])
    expect(r.branches!.find((b) => b.name === 'main')!.current).toBe(true)
    expect(r.branches!.find((b) => b.name === 'feature')!.current).toBe(false)
  })
  it('switches to an existing branch (HEAD moves, never throws)', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    await git(root, 'branch', '-m', 'main')
    await git(root, 'branch', 'feature')
    const r = await switchBranch(root, 'feature')
    expect(r.ok).toBe(true)
    expect(await getCurrentBranch(root)).toBe('feature')
  })
  it('returns ok:false with an error switching to a missing branch', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    const r = await switchBranch(root, 'does-not-exist')
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })
  // DATA-LOSS guard: an unvalidated name must never be read by git as a pathspec/flag that would
  // discard uncommitted work. Each case must return ok:false AND leave the dirty file untouched.
  for (const bad of ['.', '-f', './a.txt']) {
    it(`refuses an unsafe name ${JSON.stringify(bad)} and does NOT touch a dirty tree`, async () => {
      await fs.writeFile(path.join(root, 'a.txt'), 'committed\n'); await makeRepo(root)
      await fs.writeFile(path.join(root, 'a.txt'), 'DIRTY UNCOMMITTED\n') // would be lost by `git checkout .`
      const r = await switchBranch(root, bad)
      expect(r.ok).toBe(false)
      expect(r.error).toBe('invalid branch name')
      expect(await fs.readFile(path.join(root, 'a.txt'), 'utf8')).toBe('DIRTY UNCOMMITTED\n')
    })
  }
  it('listBranches returns ok:false for a non-repo folder', async () => {
    expect((await listBranches(root)).ok).toBe(false)
  })
})

describe('isSafeBranchName', () => {
  it('accepts ordinary branch names', () => {
    for (const n of ['main', 'feature', 'feat/x', 'release-1.2.3', 'a_b-c.d']) expect(isSafeBranchName(n)).toBe(true)
  })
  it('rejects empty, flag-like, dot, whitespace, and out-of-charset names', () => {
    for (const n of ['', '-f', '-', '.', '..', 'a b', 'a\tb', 'a~b', 'a^b', 'a:b', 'feat;rm', '说明']) {
      expect(isSafeBranchName(n)).toBe(false)
    }
  })
})

describe('gitCreateBranch with startPoint', () => {
  it('creates a branch from HEAD by default', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    const r = await gitCreateBranch(root, 'from-head')
    expect(r.ok).toBe(true)
  })
})

describe('gitCommit', () => {
  it('stages everything and commits, returning the new HEAD sha', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
    await fs.writeFile(path.join(root, 'b.txt'), 'new\n')
    const r = await gitCommit(root, 'do a thing')
    expect(r.ok).toBe(true)
    expect(r.sha).toMatch(/^[0-9a-f]{40}$/)
    expect((await git(root, 'rev-parse', 'HEAD')).stdout.trim()).toBe(r.sha)
    expect((await git(root, 'log', '-1', '--format=%s')).stdout.trim()).toBe('do a thing')
    // working tree is now clean (everything was staged + committed)
    expect((await git(root, 'status', '--porcelain')).stdout.trim()).toBe('')
  })
  it('uses the user git identity + a Co-authored-by: hip trailer when user identity is configured', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    await git(root, 'config', 'user.name', 'Ada')
    await git(root, 'config', 'user.email', 'ada@example.com')
    await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
    const r = await gitCommit(root, 'real work')
    expect(r.ok).toBe(true)
    expect((await git(root, 'log', '-1', '--format=%an')).stdout.trim()).toBe('Ada')
    expect((await git(root, 'log', '-1', '--format=%ae')).stdout.trim()).toBe('ada@example.com')
    expect((await git(root, 'log', '-1', '--format=%b')).stdout).toContain('Co-authored-by: hip <hip@local>')
  })
  it('falls back to the synthetic hip identity when no user identity is configured', async () => {
    // A repo with NO user identity in ANY scope. Neutralize the machine's global/system git config
    // for this commit so the test is deterministic regardless of the dev's ~/.gitconfig (gitCommit
    // reads the *merged* identity in production, so a real --global identity would otherwise leak in).
    await git(root, 'init')
    await git(root, 'config', '--unset-all', 'user.name').catch(() => {})
    await git(root, 'config', '--unset-all', 'user.email').catch(() => {})
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n')
    const saved = { g: process.env.GIT_CONFIG_GLOBAL, n: process.env.GIT_CONFIG_NOSYSTEM }
    process.env.GIT_CONFIG_GLOBAL = '/dev/null'
    process.env.GIT_CONFIG_NOSYSTEM = '1'
    try {
      const r = await gitCommit(root, 'first')
      expect(r.ok).toBe(true)
      expect((await git(root, 'log', '-1', '--format=%an')).stdout.trim()).toBe('hip')
      expect((await git(root, 'log', '-1', '--format=%ae')).stdout.trim()).toBe('hip@local')
      // no Co-authored-by trailer in the synthetic-identity path
      expect((await git(root, 'log', '-1', '--format=%b')).stdout).not.toContain('Co-authored-by')
    } finally {
      if (saved.g === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved.g
      if (saved.n === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = saved.n
    }
  })
  it('returns ok:false with an error for a non-repo folder', async () => {
    const r = await gitCommit(root, 'x')
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })
})

describe('gitCreateBranch + gitSwitchBranch (tool helpers)', () => {
  it('creates a branch without switching to it', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    await git(root, 'branch', '-m', 'main')
    const r = await gitCreateBranch(root, 'feature')
    expect(r.ok).toBe(true)
    expect(await getCurrentBranch(root)).toBe('main') // still on main
    const list = await listBranches(root)
    expect(list.branches!.map((b) => b.name).sort()).toEqual(['feature', 'main'])
  })
  it('gitSwitchBranch moves HEAD to an existing branch', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    await git(root, 'branch', '-m', 'main')
    await git(root, 'branch', 'feature')
    const r = await gitSwitchBranch(root, 'feature')
    expect(r.ok).toBe(true)
    expect(await getCurrentBranch(root)).toBe('feature')
  })
  it('gitCreateBranch returns ok:false for a duplicate branch name', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    await git(root, 'branch', '-m', 'main')
    await git(root, 'branch', 'feature')
    const r = await gitCreateBranch(root, 'feature')
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })
  it('gitCreateBranch refuses an unsafe name without creating a branch', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    await git(root, 'branch', '-m', 'main')
    const r = await gitCreateBranch(root, '-f')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('invalid branch name')
    expect((await listBranches(root)).branches!.map((b) => b.name)).toEqual(['main'])
  })
  it('gitSwitchBranch refuses an unsafe name and keeps a dirty tree intact', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'committed\n'); await makeRepo(root)
    await fs.writeFile(path.join(root, 'a.txt'), 'DIRTY\n')
    const r = await gitSwitchBranch(root, '.')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('invalid branch name')
    expect(await fs.readFile(path.join(root, 'a.txt'), 'utf8')).toBe('DIRTY\n')
  })
})

describe('revertToCheckpoint', () => {
  it('restores the exact tree of a checkpoint (overwrites edits, deletes files added after)', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    const head = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
    // checkpoint captures the state "a.txt = two"
    await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
    const cap = await captureCheckpoint(root, { sessionId: 's1', turnId: 't1', label: 'edit', prevCommit: head })
    expect(cap.ok && cap.treeSha).toBeTruthy()
    // drift AFTER the checkpoint: change a.txt + add a brand-new file
    await fs.writeFile(path.join(root, 'a.txt'), 'three\n')
    await fs.writeFile(path.join(root, 'extra.txt'), 'added later\n')
    const r = await revertToCheckpoint(root, { sessionId: 's1', targetTree: cap.treeSha!, prevCommit: cap.commitSha! })
    expect(r.ok).toBe(true)
    expect(r.safetyCheckpointId).toBeTruthy()
    expect(await fs.readFile(path.join(root, 'a.txt'), 'utf8')).toBe('two\n') // restored
    await expect(fs.access(path.join(root, 'extra.txt'))).rejects.toThrow() // deleted (absent in target tree)
  })
  it('writes a mandatory pre-revert safety checkpoint ref before restoring', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    const head = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
    await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
    const cap = await captureCheckpoint(root, { sessionId: 's1', turnId: 't1', label: 'edit', prevCommit: head })
    await fs.writeFile(path.join(root, 'a.txt'), 'three\n') // dirty so the safety checkpoint is non-empty
    const r = await revertToCheckpoint(root, { sessionId: 's1', targetTree: cap.treeSha!, prevCommit: cap.commitSha! })
    expect(r.ok).toBe(true)
    // the safety checkpoint id is "<sessionId>:<turnId>"; its ref must exist
    const turnId = r.safetyCheckpointId!.split(':').slice(1).join(':')
    const refs = await listCheckpointRefs(root, 's1')
    expect(refs.some((ref) => ref.endsWith('/' + sanitizeRefComponent(turnId)))).toBe(true)
  })
  it('NEVER moves HEAD (revert is worktree-only)', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    const head = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
    await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
    const cap = await captureCheckpoint(root, { sessionId: 's1', turnId: 't1', label: 'edit', prevCommit: head })
    await fs.writeFile(path.join(root, 'a.txt'), 'three\n')
    await revertToCheckpoint(root, { sessionId: 's1', targetTree: cap.treeSha!, prevCommit: cap.commitSha! })
    expect((await git(root, 'rev-parse', 'HEAD')).stdout.trim()).toBe(head) // HEAD unchanged
  })
  it('works on an unborn-HEAD repo (fresh git init, checkpoint #0 has no commit ancestry)', async () => {
    await git(root, 'init')
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n')
    const cap = await captureCheckpoint(root, { sessionId: 's1', turnId: 'start', label: null, prevCommit: null })
    expect(cap.ok && cap.treeSha).toBeTruthy()
    await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
    await fs.writeFile(path.join(root, 'b.txt'), 'extra\n')
    const r = await revertToCheckpoint(root, { sessionId: 's1', targetTree: cap.treeSha!, prevCommit: cap.commitSha! })
    expect(r.ok).toBe(true)
    expect(await fs.readFile(path.join(root, 'a.txt'), 'utf8')).toBe('one\n')
    await expect(fs.access(path.join(root, 'b.txt'))).rejects.toThrow()
  })
  it('returns ok:false for a non-repo folder', async () => {
    const r = await revertToCheckpoint(root, { sessionId: 's1', targetTree: 'deadbeef', prevCommit: null })
    expect(r.ok).toBe(false)
  })
})

describe('checkpointRefMeta', () => {
  it('resolves a checkpoint ref to its commit + tree shas', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    const head = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
    await fs.writeFile(path.join(root, 'a.txt'), 'two\n')
    const cap = await captureCheckpoint(root, { sessionId: 's1', turnId: 't1', label: 'x', prevCommit: head })
    const meta = await checkpointRefMeta(root, 's1', 't1')
    expect(meta).not.toBeNull()
    expect(meta!.commitSha).toBe(cap.commitSha)
    expect(meta!.treeSha).toBe(cap.treeSha)
  })
  it('returns null for a missing ref', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await makeRepo(root)
    expect(await checkpointRefMeta(root, 's1', 'nope')).toBeNull()
  })
})
