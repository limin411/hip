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
