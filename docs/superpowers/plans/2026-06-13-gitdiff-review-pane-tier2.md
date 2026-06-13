# git diff 评审面板 Tier 2 实现计划（更丰富的评审 UX）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **前置:** 必须先完成 Tier 1（`2026-06-13-gitdiff-review-pane-tier1.md`）。

**Goal:** 在 Tier 1 的 hunk-first + 双树引擎之上，补：会话起点 diff 基准（快照）、base 切换、按需展开/看全文、文件折叠 + 改动文件列表跳转、行内 word-level 高亮、并排（split）视图、截断可达性收尾。

**Architecture:** 会话创建时 `git write-tree` 抓工作区快照树存入 sessions 表（`diff_base_sha`）；diff 引擎按 `base` 选 `snapSha`(session-start) 或 `HEAD`。`fs:diffFile` 用 `-U<n>` 单文件重取实现「看全文」。word-level / split 全部抽成纯函数（`src/lib/wordDiff.ts`、`src/lib/diffSplit.ts`）做单测，渲染走 e2e + 手动验收。

**Tech Stack:** 同 Tier 1。新增持久化迁移（user_version 6→7）。

**承接:** spec `docs/superpowers/specs/2026-06-13-gitdiff-review-pane-design.md` §8 步骤 4–8；契约见 Tier 1 计划「Shared Contracts」。

**测试命令:** 全量 `yarn test`；单文件 `npx vitest run <精确路径>`。**严禁** `vitest run src`。

---

## Task 1: 持久化 `diff_base_sha`（user_version 7 迁移 + store 读写）

**Files:**
- Modify: `packages/sidecar/src/persistence/schema.ts`（追加 v7 迁移）
- Modify: `packages/sidecar/src/persistence/store.ts:11-24`（`getSession` 选列、新增 `setDiffBaseSha`）
- Test: `packages/sidecar/src/persistence/store.test.ts`

- [ ] **Step 1: 写失败测试**

在 `store.test.ts` 增补：

```ts
it('round-trips diff_base_sha (null by default)', () => {
  store.insertSession({ id: 'sd', title: 't', config: '{}', createdAt: 1, updatedAt: 1 })
  expect(store.getSession('sd')!.diff_base_sha).toBeNull()
  store.setDiffBaseSha('sd', 'deadbeef')
  expect(store.getSession('sd')!.diff_base_sha).toBe('deadbeef')
})
```

> 用文件顶部既有的 `store`/`beforeEach` harness；若变量名不同照搬其命名。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/sidecar/src/persistence/store.test.ts -t diff_base_sha`
Expected: FAIL（列不存在 / 方法未定义）。

- [ ] **Step 3: 加迁移**

`schema.ts` 的 `migrate()` 末尾（`if (version < 6) {…}` 之后）追加：

```ts
  if (version < 7) {
    db.exec('BEGIN')
    try {
      // diff_base_sha: 会话起点工作区快照树 SHA（用于「自会话起点」diff base）。
      // NULL = 无快照（老会话 / 非 git 工作区）→ 客户端回退 HEAD。
      db.exec(`ALTER TABLE sessions ADD COLUMN diff_base_sha TEXT`)
      db.exec('PRAGMA user_version = 7')
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
```

- [ ] **Step 4: 改 store**

`store.ts` 中 `getSession` 选列加 `diff_base_sha`，返回类型加该字段：

```ts
getSession(id: string) {
  return this.db.prepare(`SELECT id,title,config,created_at,updated_at,diff_base_sha FROM sessions WHERE id=?`).get(id) as
    | { id: string; title: string; config: string; created_at: number; updated_at: number; diff_base_sha: string | null }
    | undefined
}
```

并在 `updateConfig` 附近新增：

```ts
/** 写入会话起点快照树 SHA（null = 清除）。 */
setDiffBaseSha(id: string, sha: string | null): void {
  this.db.prepare(`UPDATE sessions SET diff_base_sha=? WHERE id=?`).run(sha, id)
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run packages/sidecar/src/persistence/store.test.ts && npx vitest run packages/sidecar/src/persistence/schema.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/sidecar/src/persistence/schema.ts packages/sidecar/src/persistence/store.ts packages/sidecar/src/persistence/store.test.ts
git commit -m "feat(persistence): diff_base_sha column + setter (v7 migration)"
```

---

## Task 2: 会话快照 + 真实 session-start base

**Files:**
- Modify: `packages/sidecar/src/session/workspace-git.ts`（新增 `captureSessionSnapshot`）
- Modify: `packages/sidecar/src/session/session.ts`（`_diffBaseSha`、`captureSnapshot`、改 `workspaceDiff`/`workspaceDiffSummary` 接快照）
- Modify: `packages/sidecar/src/session/session-manager.ts:158-167`（createSession 触发抓快照）
- Test: `packages/sidecar/src/session/workspace-git.test.ts`、`session-manager-diff.test.ts`

- [ ] **Step 1: 写 sidecar 快照测试**

`workspace-git.test.ts` 末尾追加：

```ts
import { captureSessionSnapshot } from './workspace-git.js' // 顶部 import 合并

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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/sidecar/src/session/workspace-git.test.ts -t session-start`
Expected: FAIL（`captureSessionSnapshot` 未定义）。

- [ ] **Step 3: 实现 captureSessionSnapshot**

`workspace-git.ts` 中 `collectWorkspaceDiffSummary` 之后追加：

```ts
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
```

- [ ] **Step 4: 实现 Session 快照接线**

`session.ts`：在其它私有字段旁加 `private _diffBaseSha: string | null = null`；确保顶部有 `import type { …, DiffBase } from '@hip/protocol'`。替换 Tier 1 写的 `workspaceDiff`/`workspaceDiffSummary` 两个方法为：

```ts
/** 解析会话起点快照 SHA：优先内存缓存，回退 DB。 */
private resolvedDiffBaseSha(): string | null {
  return this._diffBaseSha ?? this.store?.getSession(this.id)?.diff_base_sha ?? null
}

/** 会话创建时抓一次工作区快照并持久化（fire-and-forget 调用）。 */
async captureSnapshot(): Promise<void> {
  if (!this._config.cwd) return
  const sha = await workspaceGit.captureSessionSnapshot(this._config.cwd)
  this._diffBaseSha = sha
  this.store?.setDiffBaseSha(this.id, sha)
}

private resolveBase(base: DiffBase): { base: DiffBase; baseSha: string | null; hasSessionStart: boolean } {
  const snap = this.resolvedDiffBaseSha()
  const hasSessionStart = snap != null
  const effective: DiffBase = base === 'session-start' && hasSessionStart ? 'session-start' : 'head'
  return { base: effective, baseSha: effective === 'session-start' ? snap : null, hasSessionStart }
}

/** 工作区 diff。Never throws。 */
async workspaceDiff(base: DiffBase = 'head'): Promise<workspaceGit.WorkspaceDiff & { base: DiffBase; hasSessionStart: boolean }> {
  if (!this._config.cwd) return { state: 'no_cwd', base: 'head', hasSessionStart: false }
  const b = this.resolveBase(base)
  const r = await workspaceGit.collectWorkspaceDiff(this._config.cwd, { base: b.base, baseSha: b.baseSha })
  return { ...r, base: b.base, hasSessionStart: b.hasSessionStart }
}

/** 仅 summary（喂角标）。 */
async workspaceDiffSummary(base: DiffBase = 'head'): Promise<workspaceGit.WorkspaceDiff & { base: DiffBase; hasSessionStart: boolean }> {
  if (!this._config.cwd) return { state: 'no_cwd', base: 'head', hasSessionStart: false }
  const b = this.resolveBase(base)
  const r = await workspaceGit.collectWorkspaceDiffSummary(this._config.cwd, { base: b.base, baseSha: b.baseSha })
  return { ...r, base: b.base, hasSessionStart: b.hasSessionStart }
}
```

- [ ] **Step 5: createSession 触发抓快照**

`session-manager.ts` 的 `createSession` 在 `this.sessions.set(id, …)` 之后、`send({ type: 'session:created' … })` 之前追加 fire-and-forget：

```ts
void this.sessions.get(id)!.captureSnapshot()
```

> 快照异步完成；agent 须等用户首条消息（一个 client 往返之后）才会跑，几乎必在首次改动前完成。竞态良性：未就绪时 `resolveBase` 回退 head（hasSessionStart=false），不会误把会话前改动算作 agent 改动。

- [ ] **Step 6: 写 session-manager session-start 路由测试**

`session-manager-diff.test.ts` 增补（建仓库 session → 等 `captureSnapshot` → 改动 → 发 `fs:diff` base=session-start）：

```ts
it('fs:diff base=session-start reports hasSessionStart and scopes to post-create changes', async () => {
  // …建 cwd 为临时 git 仓库的 session;等其 captureSnapshot() resolve…
  await sm.ensureSessionForTest(sessionId).captureSnapshot() // 或文件既有等待方式
  // …会话后制造一处改动…
  const res = await sendAndCollect({ type: 'fs:diff', sessionId, base: 'session-start' })
  const msg = res.find((m) => m.type === 'fs:diff:result')!
  expect(msg).toMatchObject({ base: 'session-start', hasSessionStart: true, state: 'ok' })
})
```

> harness 命名照搬文件既有；若无 `ensureSessionForTest`，用其建 session 的既有路径并显式 `await` 一次 `captureSnapshot`。

- [ ] **Step 7: 跑测试确认通过**

Run: `npx vitest run packages/sidecar/src/session/workspace-git.test.ts packages/sidecar/src/session/session-manager-diff.test.ts`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add packages/sidecar/src/session/workspace-git.ts packages/sidecar/src/session/session.ts packages/sidecar/src/session/session-manager.ts packages/sidecar/src/session/workspace-git.test.ts packages/sidecar/src/session/session-manager-diff.test.ts
git commit -m "feat(sidecar): session-start snapshot base (B4)"
```

---

## Task 3: base 切换（前端）

**Files:**
- Modify: `src/store/diffStore.ts`（`setBase`）
- Modify: `src/domain/sessionService.ts`（`requestDiff(sessionId, base?)`）
- Modify: `src/components/artifact/DiffViewer.tsx`（工具条 base 开关）
- Test: `src/store/diffStore.test.ts`、`src/domain/sessionService.test.ts`

- [ ] **Step 1: 写失败测试（store + service）**

`diffStore.test.ts` 增补：

```ts
it('setBase switches the requested base without clearing data', () => {
  useDiffStore.getState().setResult('s1', { state: 'ok', files: [file], summary, base: 'session-start', hasSessionStart: true })
  useDiffStore.getState().setBase('s1', 'head')
  expect(useDiffStore.getState().bySession['s1']).toMatchObject({ base: 'head', files: [file] })
})
```

`sessionService.test.ts` 增补（沿用 `FakeTransport`）：

```ts
it('requestDiff sends the current store base', () => {
  const t = new FakeTransport(); const svc = new SessionService(t)
  useDiffStore.getState().setResult('s1', { state: 'ok', files: [], base: 'head', hasSessionStart: true })
  svc.requestDiff('s1')
  expect(t.sent).toContainEqual({ type: 'fs:diff', sessionId: 's1', base: 'head' })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/store/diffStore.test.ts src/domain/sessionService.test.ts -t base`
Expected: FAIL。

- [ ] **Step 3: 实现 store.setBase**

`diffStore.ts` 的 `DiffStore` 接口加 `setBase: (sessionId: string, base: DiffBase) => void`；实现：

```ts
setBase: (id, base) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, base })) })),
```

- [ ] **Step 4: 实现 requestDiff(base)**

`sessionService.ts` 的 `requestDiff` 改为读当前 base 并下发：

```ts
requestDiff(sessionId: string, base?: DiffBase): void {
  const cur = useDiffStore.getState().bySession[sessionId]
  if (cur?.status === 'loading') return
  const b = base ?? cur?.base ?? 'session-start'
  useDiffStore.getState().setLoading(sessionId)
  this.transport.send({ type: 'fs:diff', sessionId, base: b })
}
```

顶部 import 补 `DiffBase`（`import type { … , DiffBase } from '@hip/protocol'`）。`message:complete` 里 `fs:diffSummary` 也带 base：

```ts
const base = useDiffStore.getState().bySession[msg.sessionId]?.base ?? 'session-start'
this.transport.send({ type: 'fs:diffSummary', sessionId: msg.sessionId, base })
```

- [ ] **Step 5: 实现 base 开关 UI**

`DiffViewer.tsx` 工具条（`state==='ok'` 头部）加分段开关，`hasSessionStart` 为假时禁用 session-start 段：

```tsx
<div className="inline-flex overflow-hidden rounded border border-border text-caption" data-testid="diff-base-toggle">
  {(['session-start', 'head'] as const).map((b) => {
    const disabled = b === 'session-start' && !diff.hasSessionStart
    return (
      <button
        key={b}
        disabled={disabled}
        onClick={() => { if (diff.base !== b) { useDiffStore.getState().setBase(sessionId, b); sessionService.requestDiff(sessionId, b) } }}
        className={cn('px-2 py-0.5', diff.base === b ? 'bg-accent/15 text-accent' : 'text-ink-tertiary hover:text-ink', disabled && 'cursor-not-allowed opacity-40')}
      >
        {t(b === 'session-start' ? 'artifact.diffView.baseSession' : 'artifact.diffView.baseHead')}
      </button>
    )
  })}
</div>
```

并在 i18n 三语补 `baseSession` / `baseHead`（en: `Since session start` / `vs HEAD`；zh-CN: `自会话起点` / `对比 HEAD`；zh-TW: `自工作階段起點` / `對比 HEAD`）。

- [ ] **Step 6: 跑测试 + 类型检查**

Run: `npx vitest run src/store/diffStore.test.ts src/domain/sessionService.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/store/diffStore.ts src/domain/sessionService.ts src/components/artifact/DiffViewer.tsx src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "feat(diff): session-start ⇄ HEAD base toggle"
```

---

## Task 4: 按需「看全文」（`fs:diffFile` + 单文件重取）

**Files:**
- Modify: `packages/protocol/src/index.ts`（`fs:diffFile` / `fs:diffFile:result`）
- Modify: `packages/sidecar/src/session/workspace-git.ts`（`collectWorkspaceDiffFile`）
- Modify: `packages/sidecar/src/session/session.ts`（`workspaceDiffFile`）+ `session-manager.ts`（路由）
- Modify: `src/store/diffStore.ts`（`expanded` + `setFileExpanded`/`collapseFile`）+ `sessionService.ts`（`requestDiffFile` + 路由结果）
- Modify: `src/components/artifact/DiffViewer.tsx`（看全文/收起按钮）
- Test: `workspace-git.test.ts`、`diffStore.test.ts`

- [ ] **Step 1: 协议加消息**

`index.ts` 的 ClientMessage 加 `| { type: 'fs:diffFile'; sessionId: string; path: string; base?: DiffBase; context?: number | 'full' }`；ServerMessage 加 `| { type: 'fs:diffFile:result'; sessionId: string; path: string; base: DiffBase; state: DiffState; file?: DiffFile; error?: string }`。

- [ ] **Step 2: 写 sidecar 失败测试**

`workspace-git.test.ts` 追加：

```ts
import { collectWorkspaceDiffFile } from './workspace-git.js' // 合并到顶部 import

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
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run packages/sidecar/src/session/workspace-git.test.ts -t collectWorkspaceDiffFile`
Expected: FAIL。

- [ ] **Step 4: 实现 collectWorkspaceDiffFile**

`workspace-git.ts` 追加：

```ts
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
```

- [ ] **Step 5: session + 路由**

`session.ts` 追加：

```ts
async workspaceDiffFile(filePath: string, base: DiffBase = 'head', context?: number | 'full'): Promise<{ state: DiffState; file?: workspaceGit.WorkspaceDiff['files'] extends (infer _)[] ? import('@hip/protocol').DiffFile : never; error?: string }> {
  if (!this._config.cwd) return { state: 'no_cwd' }
  const b = this.resolveBase(base)
  return workspaceGit.collectWorkspaceDiffFile(this._config.cwd, filePath, { base: b.base, baseSha: b.baseSha, context })
}
```

> 上面的复杂返回类型可简化为直接用 `DiffFile`：在 `session.ts` 顶部 `import type { DiffFile } from '@hip/protocol'`，签名写成
> `Promise<{ state: DiffState; file?: DiffFile; error?: string }>`。

`session-manager.ts` 加路由：

```ts
case 'fs:diffFile': {
  const r = await this.ensureSession(msg.sessionId).workspaceDiffFile(msg.path, msg.base ?? 'session-start', msg.context)
  send({ type: 'fs:diffFile:result', sessionId: msg.sessionId, path: msg.path, base: msg.base ?? 'session-start', state: r.state, file: r.file, error: r.error })
  break
}
```

- [ ] **Step 6: store expanded + service**

`diffStore.ts`：`SessionDiff` 加 `expanded: Record<string, DiffFile>`；`EMPTY_DIFF` 加 `expanded: {}`；`setResult`/`clearSession` 重置 `expanded: {}`（切 base / 重取时清展开）。新增动作：

```ts
setFileExpanded: (id, p, file) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, expanded: { ...s.expanded, [p]: file } })) })),
collapseFile: (id, p) => set((st) => ({ bySession: patch(st.bySession, id, (s) => { const e = { ...s.expanded }; delete e[p]; return { ...s, expanded: e } }) })),
```

接口同步加这两个签名 + `expanded` 写进类型。

`diffStore.test.ts` 增补一条 `setFileExpanded`/`collapseFile` round-trip 断言。

`sessionService.ts`：新增方法并路由结果：

```ts
requestDiffFile(sessionId: string, p: string, context: number | 'full' = 'full'): void {
  const base = useDiffStore.getState().bySession[sessionId]?.base ?? 'session-start'
  this.transport.send({ type: 'fs:diffFile', sessionId, path: p, base, context })
}
// onMessage 内：
} else if (msg.type === 'fs:diffFile:result') {
  if (msg.file) useDiffStore.getState().setFileExpanded(msg.sessionId, msg.path, msg.file)
}
```

- [ ] **Step 7: UI 看全文/收起**

`DiffViewer.tsx`：`FileDiff` 用展开覆盖渲染，并在文件底部加按钮。改 `FileDiff` 签名为接收 `sessionId` 与展开态：

```tsx
function FileDiff({ file, sessionId, expanded }: { file: DiffFile; sessionId: string; expanded?: DiffFile }) {
  const { t } = useTranslation()
  const shown = expanded ?? file
  const isExpanded = !!expanded
  // …用 shown.hunks 渲染（替换原 file.hunks）…
  // 文件底部（非 binary 且有 hunks 时）：
  // <div className="flex justify-center gap-3 border-t border-border py-1 text-caption text-ink-tertiary">
  //   {!isExpanded
  //     ? <button data-testid="diff-show-full" onClick={() => sessionService.requestDiffFile(sessionId, file.path, 'full')}>{t('artifact.diffView.showFull')}</button>
  //     : <button onClick={() => useDiffStore.getState().collapseFile(sessionId, file.path)}>{t('artifact.diffView.collapseFull')}</button>}
  // </div>
}
```

调用处把 `diff.files.map((file, i) => <FileDiff key={…} file={file} sessionId={sessionId} expanded={diff.expanded[file.path]} />)`。

i18n 三语补 `showFull`（en `Show full file` / zh-CN `查看全文` / zh-TW `檢視全文`）、`collapseFull`（en `Collapse` / zh-CN `收起` / zh-TW `收合`）。

- [ ] **Step 8: 跑测试 + 类型检查**

Run: `npx vitest run packages/sidecar/src/session/workspace-git.test.ts src/store/diffStore.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS。

- [ ] **Step 9: Commit**

```bash
git add packages/protocol/src/index.ts packages/sidecar/src/session/workspace-git.ts packages/sidecar/src/session/session.ts packages/sidecar/src/session/session-manager.ts src/store/diffStore.ts src/store/diffStore.test.ts src/domain/sessionService.ts src/components/artifact/DiffViewer.tsx src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "feat(diff): on-demand show-full-file via fs:diffFile (B6)"
```

---

## Task 5: 文件折叠 + 改动文件列表跳转

**Files:**
- Modify: `src/store/diffStore.ts`（`collapsed` + `toggleCollapsed`）
- Modify: `src/components/artifact/DiffViewer.tsx`（折叠 chevron + 顶部文件列表跳转）
- Test: `src/store/diffStore.test.ts`

- [ ] **Step 1: 写失败测试**

`diffStore.test.ts` 增补：

```ts
it('toggleCollapsed flips per-file collapse', () => {
  useDiffStore.getState().toggleCollapsed('s1', 'a.ts')
  expect(useDiffStore.getState().bySession['s1'].collapsed['a.ts']).toBe(true)
  useDiffStore.getState().toggleCollapsed('s1', 'a.ts')
  expect(useDiffStore.getState().bySession['s1'].collapsed['a.ts']).toBe(false)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/store/diffStore.test.ts -t toggleCollapsed`
Expected: FAIL。

- [ ] **Step 3: 实现 store**

`diffStore.ts`：`SessionDiff` 加 `collapsed: Record<string, boolean>`；`EMPTY_DIFF` 加 `collapsed: {}`；新增动作：

```ts
toggleCollapsed: (id, p) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, collapsed: { ...s.collapsed, [p]: !s.collapsed[p] } })) })),
```

接口加签名 + 类型字段。`setResult`/`clearSession` 重置 `collapsed: {}`（重取时全部展开）。

- [ ] **Step 4: UI 折叠 + 顶部文件列表**

`DiffViewer.tsx`：
1) 给每个文件块根 div 加锚点 id：`id={`diff-file-${file.path}`}`。
2) 文件头加折叠 chevron（点击 `toggleCollapsed`）；`collapsed[file.path]` 为真时不渲染 hunks 区与底部按钮。
3) `state==='ok'` 且 `files.length > 1` 时，在工具条下渲染可折叠「改动文件」列表，每行点击滚动跳转：

```tsx
const jump = (p: string) => document.getElementById(`diff-file-${p}`)?.scrollIntoView({ block: 'start' })
// …列表行：
<button key={file.path} data-testid="diff-file-jump" onClick={() => jump(file.path)} className="flex w-full items-center justify-between px-3 py-0.5 text-meta hover:bg-surface-muted">
  <span className="flex min-w-0 items-center gap-2">
    <span className={cn('shrink-0 rounded px-1 text-caption font-medium', STATUS_CHIP[file.status].cls)}>{t(STATUS_CHIP[file.status].key)}</span>
    <span className="truncate font-mono text-ink-secondary">{file.path}</span>
  </span>
  <span className="shrink-0 font-mono text-caption"><span className="text-success">+{file.additions}</span> <span className="text-danger">-{file.deletions}</span></span>
</button>
```

> 滚动容器是既有 `min-h-0 flex-1 overflow-y-auto` 区；`scrollIntoView` 对其内锚点有效。`STATUS_CHIP` 复用 Tier 1 定义（提到模块作用域）。

- [ ] **Step 5: 跑测试 + 类型检查**

Run: `npx vitest run src/store/diffStore.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/store/diffStore.ts src/store/diffStore.test.ts src/components/artifact/DiffViewer.tsx
git commit -m "feat(diff): per-file collapse + changed-files jump list"
```

---

## Task 6: 行内 word-level 高亮（纯函数 + 渲染）

**Files:**
- Create: `src/lib/wordDiff.ts`
- Create: `src/lib/wordDiff.test.ts`
- Modify: `src/components/artifact/DiffViewer.tsx`（HunkLines 集成）

- [ ] **Step 1: 写失败测试**

`src/lib/wordDiff.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { wordDiff, computeHunkWordDiffs } from './wordDiff'
import type { DiffLine } from '@hip/protocol'

describe('wordDiff', () => {
  it('marks only the changed middle span', () => {
    const r = wordDiff('const b = 2', 'const b = 3')
    expect(r.del).toEqual([{ text: 'const b = ', changed: false }, { text: '2', changed: true }])
    expect(r.add).toEqual([{ text: 'const b = ', changed: false }, { text: '3', changed: true }])
  })
  it('all-changed when nothing in common', () => {
    expect(wordDiff('abc', 'xyz')).toEqual({ del: [{ text: 'abc', changed: true }], add: [{ text: 'xyz', changed: true }] })
  })
  it('no changed span for identical content', () => {
    expect(wordDiff('same', 'same')).toEqual({ del: [{ text: 'same', changed: false }], add: [{ text: 'same', changed: false }] })
  })
})

describe('computeHunkWordDiffs', () => {
  it('pairs equal-length del/add runs only', () => {
    const lines: DiffLine[] = [
      { type: 'ctx', content: 'x', oldNo: 1, newNo: 1 },
      { type: 'del', content: 'a1', oldNo: 2, newNo: null },
      { type: 'add', content: 'a2', oldNo: null, newNo: 2 },
    ]
    const out = computeHunkWordDiffs(lines)
    expect(out[0]).toBeNull()
    expect(out[1]).not.toBeNull()
    expect(out[2]).not.toBeNull()
  })
  it('leaves unbalanced runs unpaired (null)', () => {
    const lines: DiffLine[] = [
      { type: 'del', content: 'a', oldNo: 1, newNo: null },
      { type: 'add', content: 'b', oldNo: null, newNo: 1 },
      { type: 'add', content: 'c', oldNo: null, newNo: 2 },
    ]
    expect(computeHunkWordDiffs(lines).every((x) => x === null)).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/wordDiff.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`src/lib/wordDiff.ts`：

```ts
import type { DiffLine } from '@hip/protocol'

export interface WordDiffSpan { text: string; changed: boolean }
export interface WordDiffPair { del: WordDiffSpan[]; add: WordDiffSpan[] }

/** 公共前缀 + 公共后缀,中段标为 changed。O(n),适合单行配对高亮。 */
export function wordDiff(a: string, b: string): WordDiffPair {
  const max = Math.min(a.length, b.length)
  let p = 0
  while (p < max && a[p] === b[p]) p++
  let s = 0
  while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  const span = (pre: string, mid: string, suf: string): WordDiffSpan[] => {
    const out: WordDiffSpan[] = []
    if (pre) out.push({ text: pre, changed: false })
    if (mid) out.push({ text: mid, changed: true })
    if (suf) out.push({ text: suf, changed: false })
    return out.length ? out : [{ text: '', changed: false }]
  }
  return {
    del: span(a.slice(0, p), a.slice(p, a.length - s), a.slice(a.length - s)),
    add: span(b.slice(0, p), b.slice(p, b.length - s), b.slice(b.length - s)),
  }
}

/** 对一个 hunk 的 lines:把等长的 del-run→add-run 逐行配对算 word diff。
 *  返回与 lines 等长的数组,配对行为 span[],其余为 null。 */
export function computeHunkWordDiffs(lines: DiffLine[]): (WordDiffSpan[] | null)[] {
  const out: (WordDiffSpan[] | null)[] = lines.map(() => null)
  let i = 0
  while (i < lines.length) {
    if (lines[i].type === 'del') {
      let j = i; while (j < lines.length && lines[j].type === 'del') j++
      let k = j; while (k < lines.length && lines[k].type === 'add') k++
      const dels = j - i, adds = k - j
      if (dels > 0 && dels === adds) {
        for (let n = 0; n < dels; n++) {
          const wd = wordDiff(lines[i + n].content, lines[j + n].content)
          out[i + n] = wd.del
          out[j + n] = wd.add
        }
      }
      i = k
    } else i++
  }
  return out
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/wordDiff.test.ts`
Expected: PASS。

- [ ] **Step 5: 集成到 HunkLines**

`DiffViewer.tsx`:`HunkLines` 内 `const spans = computeHunkWordDiffs(hunk.lines)`;渲染行内容时若 `spans[i]` 非空,改为渲染 span 序列(changed 加底色):

```tsx
{spans[i]
  ? <span className="whitespace-pre px-1 text-ink">{spans[i]!.map((sp, k) => <span key={k} className={cn(sp.changed && (line.type === 'add' ? 'bg-success/30' : 'bg-danger/30'))}>{sp.text}</span>)}</span>
  : <span className="whitespace-pre px-1 text-ink">{line.content}</span>}
```

顶部 `import { computeHunkWordDiffs } from '@/lib/wordDiff'`。

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/lib/wordDiff.ts src/lib/wordDiff.test.ts src/components/artifact/DiffViewer.tsx
git commit -m "feat(diff): intra-line word-level highlight"
```

---

## Task 7: 并排（split）视图

**Files:**
- Create: `src/lib/diffSplit.ts`
- Create: `src/lib/diffSplit.test.ts`
- Modify: `src/store/uiStore.ts`（`diffViewMode` 持久偏好）
- Modify: `src/components/artifact/DiffViewer.tsx`（toggle + split 渲染）
- Test: `src/store/uiStore.test.ts`

- [ ] **Step 1: 写 diffSplit 失败测试**

`src/lib/diffSplit.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { buildSplitRows } from './diffSplit'
import type { DiffLine } from '@hip/protocol'

const L = (type: DiffLine['type'], content: string, oldNo: number | null, newNo: number | null): DiffLine => ({ type, content, oldNo, newNo })

describe('buildSplitRows', () => {
  it('pairs del/add and mirrors ctx on both sides', () => {
    const rows = buildSplitRows([L('ctx', 'a', 1, 1), L('del', 'b', 2, null), L('add', 'B', null, 2), L('ctx', 'c', 3, 3)])
    expect(rows).toEqual([
      { left: L('ctx', 'a', 1, 1), right: L('ctx', 'a', 1, 1) },
      { left: L('del', 'b', 2, null), right: L('add', 'B', null, 2) },
      { left: L('ctx', 'c', 3, 3), right: L('ctx', 'c', 3, 3) },
    ])
  })
  it('handles unbalanced runs with nulls', () => {
    const rows = buildSplitRows([L('del', 'x', 1, null), L('add', 'y', null, 1), L('add', 'z', null, 2)])
    expect(rows).toEqual([
      { left: L('del', 'x', 1, null), right: L('add', 'y', null, 1) },
      { left: null, right: L('add', 'z', null, 2) },
    ])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/diffSplit.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 buildSplitRows**

`src/lib/diffSplit.ts`：

```ts
import type { DiffLine } from '@hip/protocol'

export interface SplitRow { left: DiffLine | null; right: DiffLine | null }

/** 把统一 diff 行序列转成左右两栏:ctx 两侧镜像;del-run/add-run 逐行对齐,空缺补 null。 */
export function buildSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (l.type === 'ctx') { rows.push({ left: l, right: l }); i++; continue }
    if (l.type === 'del') {
      let j = i; while (j < lines.length && lines[j].type === 'del') j++
      let k = j; while (k < lines.length && lines[k].type === 'add') k++
      const dels = lines.slice(i, j), adds = lines.slice(j, k)
      for (let x = 0; x < Math.max(dels.length, adds.length); x++) rows.push({ left: dels[x] ?? null, right: adds[x] ?? null })
      i = k; continue
    }
    let k = i; while (k < lines.length && lines[k].type === 'add') k++
    for (let x = i; x < k; x++) rows.push({ left: null, right: lines[x] })
    i = k
  }
  return rows
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/diffSplit.test.ts`
Expected: PASS。

- [ ] **Step 5: uiStore 加 diffViewMode**

`uiStore.ts` 加 `diffViewMode: 'unified' | 'split'`(默认 `'unified'`,初值同 `activeTab` 风格)与 `setDiffViewMode: (m) => set({ diffViewMode: m })`。**注意:uiStore 当前无持久化(无 persist 中间件,`activeTab` 亦为内存态)**,故 `diffViewMode` 为内存态、刷新重置 —— 可接受;如需持久化另起任务,勿在本任务擅自引入 persist。`uiStore.test.ts` 加一条默认值 + setter 断言。

- [ ] **Step 6: UI toggle + split 渲染**

`DiffViewer.tsx`:工具条加 unified/split 切换按钮(读写 `useUiStore` 的 `diffViewMode`);`HunkLines` 在 split 模式用 `buildSplitRows(hunk.lines)` 渲染左右两栏(左 del/ctx 红、右 add/ctx 绿;null 侧渲染空占位)。word 高亮在 split 模式同样按 left/right 各自的 span 渲染(可复用 `computeHunkWordDiffs` 的配对结果按行索引映射;MVP 可在 split 下暂不做 word 高亮,保持行级底色)。

> split 仅改渲染,不改数据/协议。

- [ ] **Step 7: 跑测试 + 类型检查**

Run: `npx vitest run src/lib/diffSplit.test.ts src/store/uiStore.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add src/lib/diffSplit.ts src/lib/diffSplit.test.ts src/store/uiStore.ts src/store/uiStore.test.ts src/components/artifact/DiffViewer.tsx
git commit -m "feat(diff): unified/split view toggle"
```

---

## Task 8: 截断可达性收尾 + e2e + 手动验收

**Files:**
- Modify: `src/components/artifact/DiffViewer.tsx`（截断文案）+ i18n
- Modify: `e2e/specs/diff-workspace.spec.ts`

- [ ] **Step 1: 截断文案明确化**

`DiffViewer.tsx`:
- 单文件 `truncated` 标签旁提示「看全文」(Task 4 的按钮已提供可达路径;确保 truncated 文件也显示该按钮)。
- 文件列表溢出(`summary.totalFiles > files.length`)的 `moreFiles` 文案明确说明「超出 {{count}} 个文件未显示(收窄改动范围或在终端用 git 查看)」。i18n 三语更新 `moreFiles`。

- [ ] **Step 2: e2e 增补**

`e2e/specs/diff-workspace.spec.ts` 追加:base 开关存在且默认 `自会话起点`;点击「看全文」后该文件上下文行变多;split 切换后出现左右两栏;改动文件列表点击跳转。遵守 e2e GUI 启动 gotchas、paid-call-free。

- [ ] **Step 3: 跑 e2e + 全量单测**

Run: `yarn test && yarn test:e2e --spec e2e/specs/diff-workspace.spec.ts`
Expected: PASS(e2e 环境未就绪则降级为手动验收项,勿伪报)。

- [ ] **Step 4: 手动 GUI 验收清单**

- [ ] 新会话在一个本就有未提交改动的仓库里 → 默认「自会话起点」只显示 agent 本次改动;切「对比 HEAD」显示包括会话前改动的全部(B4)。
- [ ] 非 git 工作区 / 老会话 → 「自会话起点」段禁用,自动用 HEAD。
- [ ] 改一行长代码 → 行内只高亮变化的片段(word-level)。
- [ ] 点「看全文」→ 该文件展开为完整文件;「收起」回到 hunk(B6)。
- [ ] 改动跨多文件 → 顶部文件列表点击可跳转;文件头 chevron 可折叠。
- [ ] 切「并排」→ 修改文件左右对照;切回「统一」正常。

- [ ] **Step 5: Commit**

```bash
git add src/components/artifact/DiffViewer.tsx src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts e2e/specs/diff-workspace.spec.ts
git commit -m "feat(diff): truncation affordances + split/base/jump e2e"
```

---

## Self-Review 结论（写计划者自查）

- **Spec 覆盖**:会话起点 base=Task1/2/3(B4);看全文/上下文=Task4(B6);文件折叠+跳转=Task5;word-level=Task6;split=Task7;截断可达=Task8;sticky 头已在 Tier 1 Task8。spec §8 步骤 4–8 全覆盖。
- **占位符**:无 TBD;UI 渲染因无组件测试栈,逻辑抽 `wordDiff`/`diffSplit`/`computeHunkWordDiffs` 纯函数单测 + e2e/手动验收(已在 spec §6 对齐)。`session.ts` 复杂返回类型已给出简化写法(直接 `DiffFile`)。
- **类型一致**:`base`/`baseSha`/`hasSessionStart`/`expanded`/`collapsed`/`diff_base_sha`/`WordDiffSpan`/`SplitRow` 全程同名;`collectWorkspaceDiff(cwd, opts)`、`workspaceDiffFile(path, base, context)`、`requestDiff(sessionId, base?)`、`requestDiffFile(sessionId, path, context)` 签名贯穿。`prepareTrees` 由 Tier 1 引入、Tier 2 复用(快照/单文件均经它)。
- **依赖顺序**:Task1→2(持久化先于快照接线);Task3 依赖 2 的 hasSessionStart;Task4 独立;Task5/6/7 仅前端可并行;Task8 收尾。
