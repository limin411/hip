import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseUnifiedDiff, collectWorkspaceDiff, collectWorkspaceDiffSummary, gitInit, MAX_DIFF_LINES_PER_FILE, MAX_DIFF_FILES } from './workspace-git.js'

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
