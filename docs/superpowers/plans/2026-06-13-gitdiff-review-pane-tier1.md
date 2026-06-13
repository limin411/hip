# git diff 评审面板 Tier 1 实现计划（正确性 + 核心人体工学）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 hip 的 workspace diff 从「扁平行列表 + 手写 untracked 合并」升级为「hunk-first 数据模型 + 双树 git diff 引擎」，修正 B1–B8 全部 bug，并补上文件状态徽标、总计、改完即刷新的 Diff 角标。

**Architecture:** 用临时 index 把工作区（含 untracked，遵守 `.gitignore`）写成一棵「now 树」，再 `git diff --find-renames <base> <nowTree> -- .`；base 在 Tier 1 恒为 `HEAD`（无 HEAD 用空树）。git 原生处理 rename / untracked / mode / binary / symlink，一举消除 B2/B5/B7/B8。parser 改产出 `DiffHunk[]`（保留 `@@` 边界，修 B1）。前端按 hunk 渲染、加分隔规则、A/M/D/R chip、总计；`message:complete` 总是拉一次 numstat summary 刷新角标（修 B3）。

**Tech Stack:** TypeScript monorepo（`@hip/protocol` / `@hip/sidecar` / 前端 React+zustand+react-i18next），git CLI（`execFile`），vitest（env=node），wdio e2e。

**承接 spec:** `docs/superpowers/specs/2026-06-13-gitdiff-review-pane-design.md`

**测试命令:** 全量 `yarn test`；单文件 `npx vitest run <精确路径>`。**严禁** `vitest run src`（会触发付费实测，见 AGENTS.md / memory）。每个 sidecar 单测用临时 git 仓库，不触网、不调 LLM。

---

## Shared Contracts（两档共用，Tier 2 复用本节，勿改名）

`packages/protocol/src/index.ts` 最终形态（Tier 1 全量引入，Tier 2 不再改协议类型，仅新增 `fs:diffFile` 消息）：

```ts
export type DiffLineType = 'add' | 'del' | 'ctx'
export interface DiffLine {
  type: DiffLineType
  content: string
  oldNo: number | null
  newNo: number | null
  noNewline?: boolean            // 该侧文件末尾无换行（B8）
}
export interface DiffHunk {
  oldStart: number; oldLines: number
  newStart: number; newLines: number
  header?: string                // @@ 第二段后的 section 文本（如所在函数），可空
  lines: DiffLine[]
  truncated?: boolean            // 本文件行预算耗尽后该 hunk 被截断
}
export type DiffFileStatus = 'added' | 'modified' | 'deleted' | 'renamed'
export interface DiffFile {
  path: string                   // cwd 相对；renamed 时为新路径
  oldPath?: string               // renamed 旧路径（cwd 相对）
  status: DiffFileStatus
  additions: number
  deletions: number
  hunks: DiffHunk[]
  truncated?: boolean            // 文件级截断
  binary?: boolean               // 二进制变更，hunks 为空
}
export type DiffState = 'ok' | 'not_a_repo' | 'git_missing' | 'no_cwd' | 'error'
export type DiffBase = 'session-start' | 'head'
export interface DiffSummary { totalFiles: number; totalAdditions: number; totalDeletions: number }
```

消息（Tier 1 引入除 `fs:diffFile` 外的全部；`base` 字段 Tier 1 即存在，但服务端 Tier 1 恒回 `base:'head'`、`hasSessionStart:false`）：

```ts
// ClientMessage 追加 / 替换
| { type: 'fs:diff'; sessionId: string; base?: DiffBase }
| { type: 'fs:diffSummary'; sessionId: string; base?: DiffBase }
// （Tier 2 追加）| { type: 'fs:diffFile'; sessionId: string; path: string; base?: DiffBase; context?: number | 'full' }
| { type: 'fs:gitInit'; sessionId: string }

// ServerMessage 追加 / 替换
| { type: 'fs:diff:result'; sessionId: string; base: DiffBase; hasSessionStart: boolean; state: DiffState; files?: DiffFile[]; summary?: DiffSummary; error?: string }
| { type: 'fs:diffSummary:result'; sessionId: string; base: DiffBase; hasSessionStart: boolean; state: DiffState; summary?: DiffSummary; error?: string }
// （Tier 2 追加）| { type: 'fs:diffFile:result'; sessionId: string; path: string; base: DiffBase; state: DiffState; file?: DiffFile; error?: string }
| { type: 'fs:gitInit:result'; sessionId: string; ok: boolean; error?: string }
```

> 注意：旧 `fs:diff:result.totalFiles` 被 `summary.totalFiles` 取代——所有引用一并迁移。

sidecar `packages/sidecar/src/session/workspace-git.ts` 公共 API 最终形态：

```ts
export interface WorkspaceDiff { state: DiffState; files?: DiffFile[]; summary?: DiffSummary; error?: string }
export interface WorkspaceDiffOptions { gitBin?: string; base?: DiffBase; baseSha?: string | null; indexFile?: string }
export function parseUnifiedDiff(text: string): DiffFile[]
export function collectWorkspaceDiff(cwd: string, opts?: WorkspaceDiffOptions): Promise<WorkspaceDiff>
export function collectWorkspaceDiffSummary(cwd: string, opts?: WorkspaceDiffOptions): Promise<WorkspaceDiff>
// （Tier 2 追加）captureSessionSnapshot / collectWorkspaceDiffFile
export function gitInit(cwd: string, gitBin?: string): Promise<{ ok: boolean; error?: string }>
```

---

## Task 1: 协议类型与消息（hunk-first）

**Files:**
- Modify: `packages/protocol/src/index.ts:121-142`（类型）与 `:160-194`（消息）

- [ ] **Step 1: 替换 DiffLine/新增 DiffHunk/改 DiffFile/新增 status·base·summary**

把 `packages/protocol/src/index.ts` 中 `DiffLineType`…`DiffState` 段（约 121-142 行）整体替换为 “Shared Contracts” 的类型块（`DiffLine` 加 `noNewline?`、新增 `DiffHunk`、`DiffFile.lines→hunks` 并加 `oldPath?`/`status`、新增 `DiffFileStatus`/`DiffBase`/`DiffSummary`）。

- [ ] **Step 2: 改消息联合类型**

`ClientMessage` 中 `{ type: 'fs:diff'; sessionId: string }` 改为带 `base?: DiffBase`；其后新增 `{ type: 'fs:diffSummary'; sessionId: string; base?: DiffBase }`。
`ServerMessage` 中 `fs:diff:result` 替换为 Shared Contracts 的形态（去掉 `totalFiles`，加 `base`/`hasSessionStart`/`summary`）；其后新增 `fs:diffSummary:result`。（`fs:diffFile` 系列留给 Tier 2。）

- [ ] **Step 3: 类型检查（预期下游报错，下一任务修复）**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 仅 `workspace-git.ts` / `diffStore.ts` / `DiffViewer.tsx` / `sessionService.ts` 等下游因 `lines→hunks`、`totalFiles` 缺失而报错（本任务预期，逐个任务修复）。协议文件本身无错。

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/index.ts
git commit -m "feat(protocol): hunk-first diff model + status/summary/base"
```

---

## Task 2: parser 重写为 hunk-first（含 status / rename / noNewline）

**Files:**
- Modify: `packages/sidecar/src/session/workspace-git.ts:24-104`（`HUNK_RE`、`GIT_HEADER_RE`、`parseUnifiedDiff`）
- Test: `packages/sidecar/src/session/workspace-git.test.ts:23-159`（parser 用例）

- [ ] **Step 1: 改写 parser 测试为 hunks 模型 + 新增 rename/noNewline 断言**

把 `workspace-git.test.ts` 的 `describe('parseUnifiedDiff')` 整体替换为下列内容（fixtures 顶部 import 后新增 `RENAME`）：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/sidecar/src/session/workspace-git.test.ts -t parseUnifiedDiff`
Expected: FAIL（`f.hunks` undefined / `status` undefined）。

- [ ] **Step 3: 实现新 parser**

把 `workspace-git.ts` 中 `const HUNK_RE = ...` 到 `parseUnifiedDiff` 结束（24-104 行，含 `GIT_HEADER_RE`）整体替换为：

```ts
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
```

并在文件顶部 import 补上新类型：把 `import type { DiffFile, DiffLine, DiffState } from '@hip/protocol'` 改为
`import type { DiffFile, DiffHunk, DiffFileStatus, DiffState, DiffSummary, DiffBase } from '@hip/protocol'`（`DiffLine` 不再直接用可去掉；`DiffHunk`/`DiffSummary`/`DiffBase` 后续任务用到）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/sidecar/src/session/workspace-git.test.ts -t parseUnifiedDiff`
Expected: PASS（全部 parser 用例）。

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/workspace-git.ts packages/sidecar/src/session/workspace-git.test.ts
git commit -m "feat(sidecar): hunk-first diff parser with rename/status/noNewline (B1/B5/B7/B8)"
```

---

## Task 3: 双树 diff 引擎（`collectWorkspaceDiff` 重写，修 B2）

**Files:**
- Modify: `packages/sidecar/src/session/workspace-git.ts`（删除 `parseStatusZ`/`untrackedDiffFile`/旧 `collectWorkspaceDiff`，新增 `prepareTrees`/重写 `collectWorkspaceDiff`；顶部加 `import * as os from 'node:os'`）
- Test: `packages/sidecar/src/session/workspace-git.test.ts`（`describe('collectWorkspaceDiff')`）

- [ ] **Step 1: 改写 collect 测试为 summary + rename + 双树语义**

把 `describe('collectWorkspaceDiff')` 整体替换为：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/sidecar/src/session/workspace-git.test.ts -t collectWorkspaceDiff`
Expected: FAIL（`summary` undefined / 旧签名）。

- [ ] **Step 3: 实现双树引擎**

在 `workspace-git.ts` 顶部 import 加 `import * as os from 'node:os'`。
删除旧的 `StatusEntry`/`parseStatusZ`/`untrackedDiffFile` 与旧 `collectWorkspaceDiff`（约 110-205 行），替换为：

```ts
export interface WorkspaceDiff { state: DiffState; files?: DiffFile[]; summary?: DiffSummary; error?: string }
export interface WorkspaceDiffOptions { gitBin?: string; base?: DiffBase; baseSha?: string | null; indexFile?: string }

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

  const ownIndex = !opts.indexFile
  const indexDir = ownIndex ? await fs.mkdtemp(path.join(os.tmpdir(), 'hip-idx-')) : ''
  const indexFile = opts.indexFile ?? path.join(indexDir, 'index')
  let nowTree: string
  try { nowTree = await writeWorkingTree(cwd, gitBin, hasHead, indexFile) }
  finally { if (ownIndex) await fs.rm(indexDir, { recursive: true, force: true }).catch(() => {}) }

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
```

> `runGit` / `GIT_TIMEOUT_MS` / `GIT_MAX_BUFFER` / `GIT_INIT_TIMEOUT_MS` / `MAX_DIFF_LINES_PER_FILE` / `MAX_DIFF_FILES` 保留不动；`gitInit` 保留不动；`readHead`/`UNTRACKED_READ_CAP` import 若不再使用则删掉（now-tree 不再读盘）。

- [ ] **Step 4: 跑测试确认通过 + 全 sidecar git 用例**

Run: `npx vitest run packages/sidecar/src/session/workspace-git.test.ts`
Expected: PASS（parser + collect 全绿）。

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/workspace-git.ts packages/sidecar/src/session/workspace-git.test.ts
git commit -m "feat(sidecar): two-tree diff engine — native rename/untracked/binary (B2)"
```

---

## Task 4: numstat summary（喂角标）

**Files:**
- Modify: `packages/sidecar/src/session/workspace-git.ts`（新增 `collectWorkspaceDiffSummary`）
- Test: `packages/sidecar/src/session/workspace-git.test.ts`（新增 `describe('collectWorkspaceDiffSummary')`）

- [ ] **Step 1: 写失败测试**

在测试文件末尾（`describe('gitInit')` 前）追加：

```ts
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
```

并在文件顶部 import 补 `collectWorkspaceDiffSummary`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/sidecar/src/session/workspace-git.test.ts -t collectWorkspaceDiffSummary`
Expected: FAIL（函数未定义）。

- [ ] **Step 3: 实现**

在 `collectWorkspaceDiff` 之后追加：

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/sidecar/src/session/workspace-git.test.ts -t collectWorkspaceDiffSummary`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/workspace-git.ts packages/sidecar/src/session/workspace-git.test.ts
git commit -m "feat(sidecar): numstat-only diff summary for the badge"
```

---

## Task 5: sidecar 会话层 + 路由（`fs:diff` 返 summary，新增 `fs:diffSummary`）

**Files:**
- Modify: `packages/sidecar/src/session/session.ts:301-311`（`workspaceDiff` 返回 summary、新增 `workspaceDiffSummary`）
- Modify: `packages/sidecar/src/session/session-manager.ts:145-154`（`fs:diff` 路由补 `base`/`hasSessionStart`，新增 `fs:diffSummary`）
- Test: `packages/sidecar/src/session/session-manager-diff.test.ts`（按现有风格补 `fs:diffSummary` 与 summary 字段断言）

- [ ] **Step 1: 读现有 session-manager-diff 测试风格**

Run: `sed -n '1,60p' packages/sidecar/src/session/session-manager-diff.test.ts`
（沿用其 harness：构造 SessionManager、发 `fs:diff`、断言回包。）

- [ ] **Step 2: 写失败测试**

在 `session-manager-diff.test.ts` 增补两条用例（按文件既有 helper 改造收发）：

```ts
it('fs:diff result carries base=head and a summary', async () => {
  // …既有方式建一个 cwd 为临时 git 仓库的 session，制造一处改动…
  const res = await sendAndCollect({ type: 'fs:diff', sessionId })
  const msg = res.find((m) => m.type === 'fs:diff:result')!
  expect(msg).toMatchObject({ state: 'ok', base: 'head', hasSessionStart: false })
  expect(msg.summary.totalFiles).toBeGreaterThanOrEqual(1)
  expect('totalFiles' in msg).toBe(false) // 旧字段已移除
})

it('fs:diffSummary returns only the summary', async () => {
  const res = await sendAndCollect({ type: 'fs:diffSummary', sessionId })
  const msg = res.find((m) => m.type === 'fs:diffSummary:result')!
  expect(msg).toMatchObject({ state: 'ok', base: 'head', hasSessionStart: false })
  expect(msg.summary).toBeDefined(); expect(msg.files).toBeUndefined()
})
```

> 若该测试文件无现成 `sendAndCollect`，复用文件顶部既有 harness 命名；保持与现有用例同构。

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run packages/sidecar/src/session/session-manager-diff.test.ts`
Expected: FAIL（`fs:diffSummary:result` 未发出 / 缺 base 字段）。

- [ ] **Step 4: 实现 session 层**

`session.ts` 把 `workspaceDiff` 改为透传 base 并补 summary 版本：

```ts
/** 工作区 diff（base 默认 head；Tier 2 接 session-start）。Never throws。 */
async workspaceDiff(base: DiffBase = 'head'): Promise<workspaceGit.WorkspaceDiff & { base: DiffBase; hasSessionStart: boolean }> {
  if (!this._config.cwd) return { state: 'no_cwd', base: 'head', hasSessionStart: false }
  const r = await workspaceGit.collectWorkspaceDiff(this._config.cwd, { base })
  return { ...r, base: 'head', hasSessionStart: false } // Tier 2 用真实快照覆盖
}

/** 仅 summary（喂角标）。 */
async workspaceDiffSummary(base: DiffBase = 'head'): Promise<workspaceGit.WorkspaceDiff & { base: DiffBase; hasSessionStart: boolean }> {
  if (!this._config.cwd) return { state: 'no_cwd', base: 'head', hasSessionStart: false }
  const r = await workspaceGit.collectWorkspaceDiffSummary(this._config.cwd, { base })
  return { ...r, base: 'head', hasSessionStart: false }
}
```

`session.ts` 顶部 import 补 `DiffBase`（`import type { …, DiffBase } from '@hip/protocol'`）。

- [ ] **Step 5: 实现 session-manager 路由**

`session-manager.ts` 把 `case 'fs:diff'` 改为透传 base，并新增 `fs:diffSummary`：

```ts
case 'fs:diff': {
  const r = await this.ensureSession(msg.sessionId).workspaceDiff(msg.base ?? 'session-start')
  send({ type: 'fs:diff:result', sessionId: msg.sessionId, ...r })
  break
}
case 'fs:diffSummary': {
  const r = await this.ensureSession(msg.sessionId).workspaceDiffSummary(msg.base ?? 'session-start')
  send({ type: 'fs:diffSummary:result', sessionId: msg.sessionId, ...r })
  break
}
```

> `...r` 已含 `state/files?/summary?/error?/base/hasSessionStart`，与协议吻合。Tier 1 base 实参虽传 `session-start`，session 层暂恒回 `head`/`false`，符合「Tier 1 无快照」。

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run packages/sidecar/src/session/session-manager-diff.test.ts`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/sidecar/src/session/session.ts packages/sidecar/src/session/session-manager.ts packages/sidecar/src/session/session-manager-diff.test.ts
git commit -m "feat(sidecar): route fs:diff (summary+base) and fs:diffSummary (B3 server side)"
```

---

## Task 6: 前端 store（summary / hunks / setSummary）

**Files:**
- Modify: `src/store/diffStore.ts`
- Test: `src/store/diffStore.test.ts`

- [ ] **Step 1: 写失败测试**

把 `diffStore.test.ts` 替换为（去掉 `totalFiles`，改 `summary`，新增 `setSummary`、`base`/`hasSessionStart` 默认）：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useDiffStore, EMPTY_DIFF } from './diffStore'

const file = { path: 'a.ts', status: 'modified' as const, additions: 1, deletions: 0, hunks: [] }
const summary = { totalFiles: 1, totalAdditions: 1, totalDeletions: 0 }
beforeEach(() => { useDiffStore.setState({ bySession: {} }) })

describe('diffStore', () => {
  it('EMPTY_DIFF defaults base=session-start, no summary', () => {
    expect(EMPTY_DIFF).toMatchObject({ status: 'idle', files: [], base: 'session-start', hasSessionStart: false, initPending: false })
  })
  it('setLoading marks loading without clearing data', () => {
    useDiffStore.getState().setResult('s1', { state: 'ok', files: [file], summary, base: 'head', hasSessionStart: false })
    useDiffStore.getState().setLoading('s1')
    expect(useDiffStore.getState().bySession['s1']).toMatchObject({ status: 'loading', state: 'ok', files: [file] })
  })
  it('setResult stores files, summary, base, hasSessionStart', () => {
    useDiffStore.getState().setResult('s1', { state: 'ok', files: [file], summary, base: 'head', hasSessionStart: true })
    expect(useDiffStore.getState().bySession['s1']).toMatchObject({ status: 'ready', state: 'ok', files: [file], summary, base: 'head', hasSessionStart: true })
  })
  it('setResult defaults files to []', () => {
    useDiffStore.getState().setResult('s1', { state: 'not_a_repo', base: 'head', hasSessionStart: false })
    expect(useDiffStore.getState().bySession['s1']).toMatchObject({ status: 'ready', files: [] })
  })
  it('setSummary updates only the summary (badge) without touching files/status', () => {
    useDiffStore.getState().setResult('s1', { state: 'ok', files: [file], summary, base: 'head', hasSessionStart: false })
    useDiffStore.getState().setSummary('s1', { totalFiles: 3, totalAdditions: 9, totalDeletions: 2 }, 'head', false)
    const s = useDiffStore.getState().bySession['s1']
    expect(s.summary).toEqual({ totalFiles: 3, totalAdditions: 9, totalDeletions: 2 })
    expect(s.files).toEqual([file]); expect(s.status).toBe('ready')
  })
  it('setInitPending toggles the flag', () => {
    useDiffStore.getState().setInitPending('s1', true)
    expect(useDiffStore.getState().bySession['s1']).toMatchObject({ initPending: true })
  })
  it('clearSession resets to EMPTY_DIFF', () => {
    useDiffStore.getState().setResult('s1', { state: 'ok', files: [], base: 'head', hasSessionStart: false })
    useDiffStore.getState().clearSession('s1')
    expect(useDiffStore.getState().bySession['s1']).toEqual(EMPTY_DIFF)
  })
  it('resetTransient unwedges loading and initPending', () => {
    useDiffStore.getState().setLoading('s1'); useDiffStore.getState().setInitPending('s2', true)
    useDiffStore.getState().resetTransient()
    expect(useDiffStore.getState().bySession['s1'].status).toBe('idle')
    expect(useDiffStore.getState().bySession['s2'].initPending).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/store/diffStore.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 store**

把 `src/store/diffStore.ts` 替换为：

```ts
import { create } from 'zustand'
import type { DiffFile, DiffState, DiffBase, DiffSummary } from '@hip/protocol'

export interface SessionDiff {
  status: 'idle' | 'loading' | 'ready'
  state?: DiffState
  base: DiffBase
  hasSessionStart: boolean
  files: DiffFile[]
  summary?: DiffSummary
  error?: string
  initPending: boolean
}

export const EMPTY_DIFF: SessionDiff = { status: 'idle', base: 'session-start', hasSessionStart: false, files: [], initPending: false }

interface SetResultArg { state: DiffState; files?: DiffFile[]; summary?: DiffSummary; base: DiffBase; hasSessionStart: boolean; error?: string }

interface DiffStore {
  bySession: Record<string, SessionDiff>
  setLoading: (sessionId: string) => void
  setResult: (sessionId: string, r: SetResultArg) => void
  setSummary: (sessionId: string, summary: DiffSummary, base: DiffBase, hasSessionStart: boolean) => void
  setInitPending: (sessionId: string, pending: boolean) => void
  clearSession: (sessionId: string) => void
  resetTransient: () => void
}

function patch(by: Record<string, SessionDiff>, id: string, fn: (s: SessionDiff) => SessionDiff): Record<string, SessionDiff> {
  return { ...by, [id]: fn(by[id] ?? EMPTY_DIFF) }
}

export const useDiffStore = create<DiffStore>((set) => ({
  bySession: {},
  setLoading: (id) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, status: 'loading' })) })),
  setResult: (id, r) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({
    ...s, status: 'ready', state: r.state, files: r.files ?? [], summary: r.summary, base: r.base, hasSessionStart: r.hasSessionStart, error: r.error,
  })) })),
  setSummary: (id, summary, base, hasSessionStart) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, summary, base, hasSessionStart })) })),
  setInitPending: (id, pending) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, initPending: pending })) })),
  clearSession: (id) => set((st) => ({ bySession: { ...st.bySession, [id]: EMPTY_DIFF } })),
  resetTransient: () => set((st) => ({
    bySession: Object.fromEntries(Object.entries(st.bySession).map(([id, s]) => [id, { ...s, status: s.status === 'loading' ? 'idle' : s.status, initPending: false }])),
  })),
}))
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/store/diffStore.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/store/diffStore.ts src/store/diffStore.test.ts
git commit -m "feat(store): diffStore summary/base/hasSessionStart + setSummary"
```

---

## Task 7: sessionService 路由 + 改完即刷新角标（修 B3 前端侧）

**Files:**
- Modify: `src/domain/sessionService.ts:71-85`（`fs:diff:result` 透传新字段、新增 `fs:diffSummary:result`、`message:complete` 总是拉 summary）
- Test: `src/domain/sessionService.test.ts`（按既有 transport-mock 风格补两条）

- [ ] **Step 1: 确认测试 harness**

文件已有 `FakeTransport`（`t.sent: ClientMessage[]` 捕获下发、`t.push(serverMsg)` 投递服务端消息）、`new SessionService(t)`，`beforeEach` 设 `activeSessionId='s1'`、`activeTab='agents'`、清空 `useDiffStore`。服务端消息分发在私有 `receive`，**测试经 `t.push` 触发**（勿直接调 `receive`）。

- [ ] **Step 2: 写失败测试**

在 `sessionService.test.ts` 增补（沿用既有 `FakeTransport`/`useDiffStore`/`useUiStore` import）：

```ts
it('routes fs:diffSummary:result into the diff store summary', () => {
  const t = new FakeTransport(); new SessionService(t)
  t.push({ type: 'fs:diffSummary:result', sessionId: 's1', state: 'ok', base: 'head', hasSessionStart: false, summary: { totalFiles: 2, totalAdditions: 5, totalDeletions: 1 } })
  expect(useDiffStore.getState().bySession['s1'].summary).toEqual({ totalFiles: 2, totalAdditions: 5, totalDeletions: 1 })
})

it('on message:complete always requests a diff summary even when the diff tab is inactive', () => {
  const t = new FakeTransport(); new SessionService(t)
  useUiStore.setState({ activeTab: 'files' })
  t.push({ type: 'message:complete', sessionId: 's1', message: { id: 'm', role: 'assistant', content: '', timestamp: 0 } as any })
  expect(t.sent.some((m) => m.type === 'fs:diffSummary' && m.sessionId === 's1')).toBe(true)
})
```

> 第二条用 `some(...)` 而非 `toContainEqual`，对 base 字段不敏感 —— Tier 2 给 `fs:diffSummary` 加 base 后此断言仍成立。

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/domain/sessionService.test.ts`
Expected: FAIL。

- [ ] **Step 4: 实现**

`sessionService.ts` 中：
1) `fs:diff:result` 分支改为透传新字段：

```ts
} else if (msg.type === 'fs:diff:result') {
  useDiffStore.getState().setResult(msg.sessionId, { state: msg.state, files: msg.files, summary: msg.summary, base: msg.base, hasSessionStart: msg.hasSessionStart, error: msg.error })
} else if (msg.type === 'fs:diffSummary:result') {
  if (msg.summary) useDiffStore.getState().setSummary(msg.sessionId, msg.summary, msg.base, msg.hasSessionStart)
```

2) `fs:gitInit:result` 失败分支的 `setResult` 也补 base 字段：

```ts
else useDiffStore.getState().setResult(msg.sessionId, { state: 'not_a_repo', base: 'head', hasSessionStart: false, error: msg.error })
```

3) `message:complete` 末尾把「仅在 diff 激活时刷新」改为「总是拉 summary，激活时再拉全量」：

```ts
// 改完文件 → 总是刷新角标(便宜)；diff 标签激活时再拉全量
this.transport.send({ type: 'fs:diffSummary', sessionId: msg.sessionId })
if (useUiStore.getState().activeTab === 'diff') this.requestDiff(msg.sessionId)
```

- [ ] **Step 5: 跑测试确认通过 + 全量**

Run: `npx vitest run src/domain/sessionService.test.ts && yarn test`
Expected: PASS（含全量回归）。

- [ ] **Step 6: Commit**

```bash
git add src/domain/sessionService.ts src/domain/sessionService.test.ts
git commit -m "feat(domain): route diff summary + always refresh badge on turn end (B3)"
```

---

## Task 8: DiffViewer 按 hunk 渲染 + 分隔 + chip + 总计 + noNewline（修 B1/B7/B8 视觉）

**Files:**
- Modify: `src/components/artifact/DiffViewer.tsx`
- Test:（纯逻辑，无组件测试栈）—— 本任务无新单测，验证靠 `type-check` + Task 11 e2e/手动

- [ ] **Step 1: 重写 FileDiff 为 hunk 渲染**

把 `DiffViewer.tsx` 中 `FileDiff` 组件替换为按 `file.hunks` 渲染、hunk 之间插 `@@` 分隔行、文件头加 A/M/D/R chip 与 rename 的 `old → new`、`noNewline` 行尾标注、`status==='modified' && hunks.length===0 && !binary` 时显示「仅模式变更」：

```tsx
import type { DiffFile, DiffHunk, DiffLine, DiffLineType, DiffFileStatus } from '@hip/protocol'

const STATUS_CHIP: Record<DiffFileStatus, { cls: string; key: string }> = {
  added: { cls: 'bg-success/15 text-success', key: 'artifact.diffView.statusAdded' },
  modified: { cls: 'bg-warning/15 text-warning', key: 'artifact.diffView.statusModified' },
  deleted: { cls: 'bg-danger/15 text-danger', key: 'artifact.diffView.statusDeleted' },
  renamed: { cls: 'bg-accent/15 text-accent', key: 'artifact.diffView.statusRenamed' },
}

function lineStyle(t: DiffLineType): string { return t === 'add' ? 'bg-success/10' : t === 'del' ? 'bg-danger/10' : '' }
function sign(t: DiffLineType): string { return t === 'add' ? '+' : t === 'del' ? '-' : ' ' }

function HunkLines({ hunk }: { hunk: DiffHunk }) {
  const { t } = useTranslation()
  return (
    <>
      <div className="flex bg-surface-muted/60 text-caption text-ink-tertiary">
        <span className="shrink-0 select-none px-2 font-mono">@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</span>
        {hunk.header && <span className="truncate px-1 opacity-70">{hunk.header}</span>}
      </div>
      {hunk.lines.map((line: DiffLine, i) => (
        <div key={i} className={cn('flex', lineStyle(line.type))}>
          <span className="w-10 shrink-0 select-none px-1 text-right text-ink-tertiary">{line.oldNo ?? ''}</span>
          <span className="w-10 shrink-0 select-none px-1 text-right text-ink-tertiary">{line.newNo ?? ''}</span>
          <span className={cn('w-4 shrink-0 select-none text-center', line.type === 'add' && 'text-success', line.type === 'del' && 'text-danger')}>{sign(line.type)}</span>
          <span className="whitespace-pre px-1 text-ink">{line.content}</span>
          {line.noNewline && <span className="select-none px-1 text-caption text-ink-tertiary" title={t('artifact.diffView.noNewline')}>↵̸</span>}
        </div>
      ))}
    </>
  )
}

function FileDiff({ file }: { file: DiffFile }) {
  const { t } = useTranslation()
  const chip = STATUS_CHIP[file.status]
  return (
    <div className="border-b border-border" data-testid="diff-file">
      <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 bg-surface-muted px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn('shrink-0 rounded px-1 text-caption font-medium', chip.cls)} data-testid="diff-status">{t(chip.key)}</span>
          <span className="truncate font-mono text-meta text-ink">
            {file.oldPath && <span className="text-ink-tertiary">{file.oldPath} → </span>}{file.path}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-caption">
          {file.truncated && <span className="text-ink-tertiary">{t('artifact.truncated')}</span>}
          <span className="text-success">+{file.additions}</span>
          <span className="text-danger">-{file.deletions}</span>
        </span>
      </div>
      {file.binary ? (
        <div className="px-3 py-2 text-meta text-ink-tertiary">{t('artifact.diffView.binary')}</div>
      ) : file.hunks.length === 0 ? (
        <div className="px-3 py-2 text-meta text-ink-tertiary">{t('artifact.diffView.modeOnly')}</div>
      ) : (
        <div className="overflow-x-auto font-mono text-meta leading-relaxed">
          {file.hunks.map((h, i) => <HunkLines key={i} hunk={h} />)}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 头部总计用 summary**

把 `DiffViewer()` 中 `state === 'ok'` 分支的头部 `changedFiles` 段改为用 `diff.summary`：

```tsx
<div className="flex items-center gap-3 text-meta text-ink-secondary">
  <span>{t('artifact.diffView.changedFiles', { count: diff.summary?.totalFiles ?? diff.files.length })}</span>
  {diff.summary && (diff.summary.totalAdditions > 0 || diff.summary.totalDeletions > 0) && (
    <span className="font-mono text-caption"><span className="text-success">+{diff.summary.totalAdditions}</span> <span className="text-danger">-{diff.summary.totalDeletions}</span></span>
  )}
</div>
```

并把底部 `moreFiles` 判断由 `diff.totalFiles` 改为 `diff.summary?.totalFiles`：

```tsx
{(diff.summary?.totalFiles ?? 0) > diff.files.length && (
  <div className="px-3 py-2 text-meta text-ink-tertiary">{t('artifact.diffView.moreFiles', { count: (diff.summary!.totalFiles) - diff.files.length })}</div>
)}
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS（DiffViewer 无 `lines`/`totalFiles` 残留引用）。

- [ ] **Step 4: Commit**

```bash
git add src/components/artifact/DiffViewer.tsx
git commit -m "feat(ui): render diffs by hunk with separators, status chips, totals (B1/B7/B8)"
```

---

## Task 9: ArtifactPanel Diff 角标

**Files:**
- Modify: `src/components/artifact/ArtifactPanel.tsx`

- [ ] **Step 1: 在 Diff TabsTrigger 上挂角标**

`ArtifactPanel.tsx` 中读取活动会话的 diff summary，并在 `value==='diff'` 的 `TabsTrigger` 内渲染计数：

```tsx
import { useDomainStore } from '@/domain/sessionStore'
import { useDiffStore } from '@/store/diffStore'
// …组件内：
const sid = useDomainStore((s) => s.activeSessionId)
const diffCount = useDiffStore((s) => (sid ? s.bySession[sid]?.summary?.totalFiles : 0)) ?? 0
// …TabsTrigger 渲染：
<TabsTrigger key={tab.value} value={tab.value} data-testid={`tab-${tab.value}`}>
  {tab.label}
  {tab.value === 'diff' && diffCount > 0 && (
    <span data-testid="diff-badge" className="ml-1.5 rounded-full bg-accent/15 px-1.5 text-caption text-accent">{diffCount}</span>
  )}
</TabsTrigger>
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/components/artifact/ArtifactPanel.tsx
git commit -m "feat(ui): changed-file count badge on the Diff tab (B3)"
```

---

## Task 10: i18n 文案（en / zh-CN / zh-TW）

**Files:**
- Modify: `src/i18n/en.ts`、`src/i18n/zh-CN.ts`、`src/i18n/zh-TW.ts`（`artifact.diffView` 块）

- [ ] **Step 1: 三语补键**

在每个语言文件的 `artifact.diffView` 对象里新增以下键（值按语言）：

en.ts:
```ts
statusAdded: 'Added', statusModified: 'Modified', statusDeleted: 'Deleted', statusRenamed: 'Renamed',
modeOnly: 'File mode changed only', noNewline: 'No newline at end of file',
```
zh-CN.ts:
```ts
statusAdded: '新增', statusModified: '修改', statusDeleted: '删除', statusRenamed: '重命名',
modeOnly: '仅文件权限/模式变更', noNewline: '文件末尾无换行',
```
zh-TW.ts:
```ts
statusAdded: '新增', statusModified: '修改', statusDeleted: '刪除', statusRenamed: '重新命名',
modeOnly: '僅檔案權限/模式變更', noNewline: '檔案結尾無換行',
```

- [ ] **Step 2: 校验三语键齐 + 类型检查**

Run: `npx tsc --noEmit -p tsconfig.json && node -e "const a=Object.keys(require('./src/i18n/en.ts'));" 2>/dev/null; echo done`
（若仓库已有 i18n 键一致性测试则跑它：`npx vitest run src -t i18n` 仅当存在该用例；否则人工核对三语同键。）
Expected: PASS / 三语键一致。

- [ ] **Step 3: Commit**

```bash
git add src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "i18n(diff): status chips, mode-only, no-newline"
```

---

## Task 11: e2e 扩展 + 手动 GUI 验收

**Files:**
- Modify: `e2e/specs/diff-workspace.spec.ts`

- [ ] **Step 1: 看现有 e2e 用例与 selector 风格**

Run: `sed -n '1,80p' e2e/specs/diff-workspace.spec.ts`
（沿用其 `data-testid`：`diff-view`、`diff-file`、`diff-refresh` 等；遵守 e2e GUI 启动 gotchas，paid-call-free。）

- [ ] **Step 2: 增补断言**

在既有「制造改动 → 打开 Diff」流程后追加：存在 `[data-testid="diff-status"]`（chip）、多 hunk 文件出现 `@@` 分隔文本、`[data-testid="diff-badge"]` 在改动后出现且数字 ≥1、总计区出现 `+`/`-` 数字。

- [ ] **Step 3: 跑 e2e（真机，遵守 gotchas）**

Run: `yarn test:e2e --spec e2e/specs/diff-workspace.spec.ts`
Expected: PASS（如本机 e2e 环境未就绪，记录为手动验收项，勿伪报通过）。

- [ ] **Step 4: 手动 GUI 验收清单**

- [ ] 让 agent 改一个已跟踪文件的两处相隔很远的行 → Diff 面板两处各自成 hunk、之间有 `@@` 分隔、行号不再无声跳变（B1）。
- [ ] 让 agent 重命名一个文件并改一行 → 显示一个 `R` chip + `old → new` + `+1/-1`，而非整删整增（B2）。
- [ ] 新建文件显示 `A`、删除文件显示 `D`、改动显示 `M`。
- [ ] agent 改完文件时停留在 Files 标签 → Diff 标签角标出现/更新计数（B3）。
- [ ] 头部出现 `N files · +X −Y` 总计。
- [ ] 仅 `chmod +x` 一个文件 → 显示「仅模式变更」而非空块（B7）。

- [ ] **Step 5: Commit**

```bash
git add e2e/specs/diff-workspace.spec.ts
git commit -m "test(e2e): diff status chips, hunk separators, badge"
```

---

## Self-Review 结论（写计划者自查）

- **Spec 覆盖**:B1=Task2/8、B2=Task3、B3=Task5/7/9、B5=Task2/3、B7=Task2/8、B8=Task2/8;hunk-first=Task1/2/8;status chip=Task8;总计=Task4/8;角标=Task9;i18n=Task10;测试=各任务 + Task11。Tier 1 范围全覆盖。
- **占位符**:无 TBD;UI 任务因项目无组件测试栈,显式以 type-check + e2e + 手动验收替代组件单测(已在 spec §6 对齐)。
- **类型一致**:`hunks`/`status`/`oldPath`/`summary`/`base`/`hasSessionStart`/`noNewline` 全程同名;`collectWorkspaceDiff(cwd, opts)` 签名贯穿;`setSummary(id, summary, base, hasSessionStart)` 与 Task7 调用一致。
