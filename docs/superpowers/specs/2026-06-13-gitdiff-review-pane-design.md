# hip git diff 评审面板 — 对齐 Zed 能力补全 spec

**日期:** 2026-06-13
**状态:** 已批准方向(Tier 1+2),待 spec 评审 → 进入 writing-plans
**承接:** `2026-06-10-diff-workspace-git-design.md`(首版 workspace diff:`git diff HEAD -- .` + 磁盘读 untracked,扁平 line 列表)。本次以 Zed 的 git diff 能力为参照,补全不足、修正 bug,把面板做成「评审 agent 本次会话改了什么」的完整工具。

## 背景 & 核心定位

调研对照了 hip 现状与 Zed(`buffer_diff` 引擎、`git` core、`git_ui` 的 `project_diff`/`git_panel`、`editor` 渲染层)。

**关键定位差异:Zed 是完整 git 客户端,hip 的 diff 面板只是「评审 agent 工作区改动」的工具。** 因此「补全」对齐评审场景,而**不**搬运 Zed 的 git 客户端能力。

明确**不做**(对 hip 价值低、surface 大):staging/index、commit UI、blame、history、stash、合并冲突解决、行内评审评论→agent(Tier 3,XL,后续可选)、语法高亮(暂缓,与聊天代码块保持一致——聊天 `CodeBlock.tsx` 当前也无高亮)。

## 决策(用户已确认)

1. **范围 = Tier 1 + Tier 2**(正确性 + 完整评审 UX)。
2. **数据模型 = hunk-first 重构**:`DiffFile.lines[]` → `DiffFile.hunks[]`。理由:hunk 分隔、上下文展开、word-level 高亮三项都依赖 hunk 边界。
3. **diff 基准 = 会话起点优先**:会话创建时抓工作区快照树,默认显示「自会话起点的改动」,提供切回 HEAD 的开关;无快照(老会话)自动回退 HEAD。
4. **语法高亮 = 暂缓**(与聊天代码块一致,避免单独引入重型高亮库 + 风格不一致)。

## 现状 bug 清单(本次一并修正)

| # | 严重度 | 问题 | 证据 |
|---|---|---|---|
| B1 | 🔴 高 | 多 hunk 无分隔符,非相邻改动紧贴显示、行号无声跳变 | `workspace-git.ts:65-90` 把所有 hunk 拍平进一个 `out[]`,`@@` 头被 `continue` 吃掉无标记;`DiffViewer.tsx:38-55` 扁平渲染 |
| B2 | 🔴 高 | `--no-renames` → agent 重命名炸成「整删 + 整增」,虚增文件数/统计 | `workspace-git.ts:178` |
| B3 | 🟡 中 | diff 仅在 Diff 标签激活时刷新,无角标提示 | `sessionService.ts:84` |
| B4 | 🟡 中 | base 写死 HEAD,会话前的未提交改动混入 agent 改动 | `workspace-git.ts:178` |
| B5 | 🟢 低 | `GIT_HEADER_RE = /^a\/(.+) b\/\1$/` 假设 a/=b/,对含空格路径脆弱 | `workspace-git.ts:31` |
| B6 | 🟢 低 | 文件数(200)/行数(2000)截断后内容不可触达 | `workspace-git.ts:10-11`,`DiffViewer.tsx:153-156` |
| B7 | 🟢 低 | mode-only 改动渲染成空块,像渲染故障 | parser 产出 `lines:[]`,UI 无说明 |
| B8 | 🟢 低 | whitespace-only / 无 EOF 换行的改动丢失标注 | `workspace-git.ts:89` 跳过 `\ No newline` |

B1/B2 是 Tier 1 直接修复项;B5/B7/B8 由 §2 的双树重构「顺带」修掉(git 原生处理);B3=Tier 1 自动刷新项;B4=Tier 2 会话基准项;B6=Tier 2 截断可达性。

## 架构总览

```
protocol(数据模型 + 新 IPC 动词)
  └─ sidecar  workspace-git.ts  ← 双树 diff 引擎(重写核心)
              session.ts        ← 持有会话快照 SHA、转发 base/path/context
              session-manager   ← 路由新动词、会话创建时抓快照
              persistence       ← diffBaseSha 入库(nullable)
  └─ store    diffStore         ← summary / base / 折叠 / 展开态
              uiStore           ← unified|split 视图偏好(持久)
              sessionService    ← 路由结果 + 改完即刷新(badge)
  └─ UI       DiffViewer.tsx    ← hunk 渲染 + 分隔 + chip + 折叠 + 跳转 + word 高亮 + 展开 + base/split 开关
              ArtifactPanel.tsx ← Diff 标签角标
  └─ i18n     en / zh-CN / zh-TW
```

## 1. 数据模型 / protocol(`packages/protocol/src/index.ts`)

```ts
export type DiffLineType = 'add' | 'del' | 'ctx'
export interface DiffLine {
  type: DiffLineType; content: string; oldNo: number | null; newNo: number | null
  noNewline?: boolean                       // 新增:该侧文件末尾无换行(修 B8);唯一新增字段
}

// 新增:一个 hunk
export interface DiffHunk {
  oldStart: number; oldLines: number       // @@ -oldStart,oldLines +newStart,newLines @@
  newStart: number; newLines: number
  header?: string                          // @@ 第二段后的 section 文本(如函数名),可空
  lines: DiffLine[]
  truncated?: boolean                       // 本 hunk 行数触顶
}

export type DiffFileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export interface DiffFile {
  path: string                              // cwd 相对,展示用;renamed 时为新路径
  oldPath?: string                          // 新增:renamed 旧路径
  status: DiffFileStatus                    // 新增
  additions: number; deletions: number
  hunks: DiffHunk[]                          // 由 lines[] 改为 hunks[]
  truncated?: boolean                        // 文件级截断(hunk 数 / 总行数触顶)
  binary?: boolean
}

export type DiffState = 'ok' | 'not_a_repo' | 'git_missing' | 'no_cwd' | 'error'
export type DiffBase = 'session-start' | 'head'
export interface DiffSummary { totalFiles: number; totalAdditions: number; totalDeletions: number }
```

`DiffLine` 仅加一个可选 `noNewline`(修 B8);word-level 高亮在**前端计算**,不进 protocol。

新增 / 变更 IPC(全部加法式,不破坏既有 fs:* 语义):

```ts
// client → server
| { type: 'fs:diff'; sessionId: string; base?: DiffBase }                                  // base 缺省 = session-start
| { type: 'fs:diffSummary'; sessionId: string; base?: DiffBase }                           // 新增:numstat-only,喂角标
| { type: 'fs:diffFile'; sessionId: string; path: string; base?: DiffBase; context?: number | 'full' }  // 新增:单文件按需展开
| { type: 'fs:gitInit'; sessionId: string }

// server → client
| { type: 'fs:diff:result'; sessionId: string; base: DiffBase; hasSessionStart: boolean; state: DiffState; files?: DiffFile[]; summary?: DiffSummary; error?: string }
| { type: 'fs:diffSummary:result'; sessionId: string; base: DiffBase; hasSessionStart: boolean; state: DiffState; summary?: DiffSummary; error?: string }
| { type: 'fs:diffFile:result'; sessionId: string; path: string; base: DiffBase; state: DiffState; file?: DiffFile; error?: string }
| { type: 'fs:gitInit:result'; sessionId: string; ok: boolean; error?: string }
```

结果回显**实际使用的 base** 与 `hasSessionStart`:客户端请求 `session-start` 但无快照时,服务端回退 `head` 并置 `hasSessionStart:false`,UI 据此禁用「会话起点」开关。`totalFiles` 字段由 `summary.totalFiles` 取代(`fs:diff:result` 不再单列 `totalFiles`)。

## 2. sidecar diff 引擎 —「没有问题」的核心(`workspace-git.ts`)

**用双树 diff 取代现有混合实现**(tracked 走 `git diff HEAD`,untracked 手动读盘 + 手动合并)。

### 2.1 会话快照(session-start 基准)

会话创建时,若 cwd 是 git work tree,把工作区(tracked + untracked,遵守 `.gitignore`)写成一棵**快照树**,用**临时 index**,不碰真实 index/worktree:

```
TMP=<~/.hip/scratch>/<sessionId>.index        # 会话专属、复用以增量哈希
GIT_INDEX_FILE=$TMP git read-tree HEAD          # 无 HEAD 仓库 → git read-tree --empty
GIT_INDEX_FILE=$TMP git add -A -- .             # 纳入 untracked,遵守 .gitignore
snapSha=$(GIT_INDEX_FILE=$TMP git write-tree)
```

`snapSha` 存入会话(持久化,见 §3.3)。临时 index **保留复用**——后续抓「now 树」时 git 借助其 stat-cache 仅哈希变更过的 blob,使 `add -A` 增量化。

### 2.2 每次 diff = 两棵树相比

```
# now 树:同法写当前工作区(复用同一 TMP index)
GIT_INDEX_FILE=$TMP git add -A -- .
nowSha=$(GIT_INDEX_FILE=$TMP git write-tree)

# base = 'session-start' → snapSha;base = 'head' → HEAD
git -c core.quotepath=false diff --no-color --find-renames <base> <nowSha> -- .
```

**为什么这是对的:** 树-对-树 diff 让 git 原生且正确地处理 **untracked、rename、mode change、binary、symlink**——这正是现有手写逻辑出 bug 的地方(B2/B5/B7/B8 一次性消除),且 untracked 不再需要手动读盘(也消除符号链接内容泄漏面)。session-start 基准天然正确(两侧都是完整树)。

**代价与缓解:** 每次 diff 多一次 `add -A` 工作树遍历;靠 §2.1 的会话级常驻临时 index 增量化。仓库巨大时仍可接受(agent 工作区通常中小)。`not_a_repo` / `git_missing` / `no_cwd` 状态保留:diff 前先 `rev-parse --is-inside-work-tree`(`ENOENT`→`git_missing`,失败→`not_a_repo`),`fs.stat(cwd)` 失败 → `error`。

### 2.3 parser 重写(`parseUnifiedDiff`)

- 按 `@@` 分组成 `DiffHunk[]`,保留每个 hunk 的 old/new start+count 与 header 文本。
- 状态推导:`new file mode`→`added`;`deleted file mode`→`deleted`;`rename from/rename to`→`renamed`(取 oldPath/path);否则 `modified`。`+++ /dev/null`→deleted、`--- /dev/null`→added 作为兜底。
- 路径解析改用 `rename from`/`rename to` 头与 `--- a/`、`+++ b/` 行(配合 `core.quotepath=false`),**移除 `GIT_HEADER_RE` 反向引用**(修 B5)。
- `Binary files ... differ` → `binary:true, hunks:[]`。
- mode-only / 0 行改动:`status` 仍准确(modified),`hunks:[]`,UI 显式标注「仅权限/模式变更」(修 B7)。
- 保留 `\ No newline at end of file`:在其上一条 `DiffLine` 置 `noNewline:true`,UI 在该行尾渲染标注(修 B8)。

### 2.4 衍生动词

- `fs:diffSummary` = `git diff --numstat <base> <nowSha> -- .`,仅 +/- 与文件数,不生成 patch body;喂角标 + 总计。
- `fs:diffFile(path, context)` = 同一 `git diff` 加 `-U<n>`(`'full'` → `-U1000000`)且 `-- <path>`,返回单个 `DiffFile`;客户端合并入对应文件,替换其 hunks(修 B6 的单文件可达性)。
- 上限 `MAX_DIFF_FILES`(200)/ `MAX_DIFF_LINES_PER_FILE`(2000)保留;文件列表 >200 时给出明确「N 个文件未显示」且(Tier 2)可分页/「全部加载」;单文件触顶给「show full file」refetch。

## 3. store / IPC 接线

### 3.1 `diffStore.ts`

```ts
interface SessionDiff {
  status: 'idle' | 'loading' | 'ready'
  state?: DiffState
  base: DiffBase
  hasSessionStart: boolean
  files: DiffFile[]
  summary?: DiffSummary
  error?: string
  initPending: boolean
  collapsed: Record<string, boolean>       // path → 折叠
  expanded: Record<string, DiffFile>       // path → 已「展开/全文」覆盖
}
```

动作:`setResult`(写 files+summary+base+hasSessionStart)、`setSummary`(仅更新角标,不动 files)、`setFileExpanded(path, file)`、`toggleCollapsed(path)`、`setBase(base)`(触发重新请求)、`resetTransient`(重连兜底,保留)。

### 3.2 `sessionService` + 自动刷新(修 B3)

`message:complete` 时:**总是** `fs:diffSummary`(便宜)刷新角标;仅当 Diff 标签激活时再 `fs:diff` 拉全量。路由 `fs:diffSummary:result` / `fs:diffFile:result`。`unified|split` 视图存 `uiStore`(持久)。

### 3.3 会话持久化

`diffBaseSha: string | null` 入会话 schema/store(nullable)。会话创建时(§2.1)若可抓快照则写入;否则 null。老会话 = null → `hasSessionStart:false` → 回退 HEAD。reload 时恢复 snapSha;临时 index 文件丢失则下次 diff 重建 now 树(snapSha 仍是 git 对象,持久有效)。

## 4. UI / UX(见已批准 mockup)

`DiffViewer.tsx` 渲染 文件 → hunk:

- **hunk 分隔**:hunk 之间渲染 `@@ -a,b +c,d @@`(+可选 header)分隔规则(修 B1)。
- **文件头**:sticky + 可折叠;A/M/D/R 状态 chip(绿/琥珀/红/蓝);renamed 显示 `old → new`;per-file +/-。
- **「Changed files」列表**:顶部可折叠列表,点击滚动跳转到对应文件块。
- **工具条**:总计(N files · +X −Y)、base 开关(Since session start ⇄ vs HEAD,无快照时禁用)、unified/split 开关、refresh。
- **展开**:每 hunk「expand N lines」、每文件「show full file」→ `fs:diffFile`。
- **word-level 高亮**:前端 `wordDiff(a,b)` 工具,对 hunk 内**等长** del-run→add-run 的配对行做 char/token 级 LCS,包裹变更 span(无 protocol 改动)。
- **split 视图**:基于同一 hunk 数据的左右配对列布局,纯前端。

`ArtifactPanel.tsx`:Diff `TabsTrigger` 加计数角标(`summary.totalFiles`,0 时不显示)。

## 5. i18n

`en.ts` / `zh-CN.ts` / `zh-TW.ts` 新增:状态 chip(added/modified/deleted/renamed)、总计「{adds} additions, {dels} deletions」、base 开关(Since session start / vs HEAD)、expand context / show full file、unified / split、collapse all / expand all、renamed from {old}、mode changed、N more files、no newline at end of file。沿用 bash3.2 CJK 变量括号约定(若脚本侧涉及)。

## 6. 测试策略(TDD,严禁触发付费 LLM)

> 遵守 memory:`vitest run src …` 会子串匹配 sidecar 触发付费实测;只用 `yarn test`,LLM 无关的 git/FS/UI E2E 用临时仓库,不碰 API。

- `workspace-git.test.ts`(重写):hunk-first 解析、双树 diff、rename(`renamed`+oldPath)、added/deleted/modified/binary、mode-only、no-newline、session-start 基准、numstat summary、`-U<n>` 展开、含空格路径、`.gitignore` 遵守、no-HEAD 仓库。临时 git 仓库,逐场景。
- `diffStore.test.ts`:base/summary/collapsed/expanded/setSummary/resetTransient。
- `session-manager-diff.test.ts`:新动词路由、base 透传、快照抓取与回退、persistence round-trip。
- `wordDiff` 单测;`DiffViewer` 组件测(hunk 分隔、chip、折叠、跳转、word 高亮、base/split 开关、空/clean/各 DiffState)。
- 扩展 `e2e/specs/diff-workspace.spec.ts`(遵守 e2e GUI 启动 gotchas)。

## 7. 迁移 / 兼容

- `lines[]→hunks[]` 为破坏式改动,但仅 monorepo 内部(单 app 两端同发),逐处更新引用,无外部消费者。
- 持久会话 schema 加 `diffBaseSha`(nullable),老会话无值 → HEAD 回退,无需数据迁移。
- 旧 `fs:diff:result.totalFiles` 改为 `summary.totalFiles`;同步更新所有引用与测试。

## 8. 构建顺序(供 writing-plans 细化)

**Tier 1(先做,正确性 + 核心人体工学):**
1. protocol hunk-first 类型 + parser 重写(含 status/rename/no-newline)+ `workspace-git` 双树引擎(修 B1/B2/B5/B7/B8);测试先行。
2. store/UI 适配 hunk 渲染 + hunk 分隔(B1 闭环)+ A/M/D/R chip + 总计。
3. 自动刷新 + Diff 角标(`fs:diffSummary`,修 B3)。

**Tier 2(后做,丰富 UX):**
4. 会话快照 + base 开关(session-manager + persistence,B4)。
5. 文件折叠 + Changed files 跳转 + sticky 头。
6. 按需展开上下文 / show full file(`fs:diffFile`,B6)。
7. word-level 高亮(前端)。
8. split 视图开关 + 截断可达性收尾。

每步独立可验收、保持 `yarn test` 绿、不触付费 LLM。

## 9. 风险与边界

- **性能**:`add -A` 遍历——靠常驻临时 index 增量化;必要时对超大仓库加 size 阈值降级回 `git diff HEAD -- .`(保留为逃生通道)。
- **临时 index 生命周期**:放 `~/.hip/scratch/<sid>.index`,会话销毁随 scratch 清理;丢失可重建。
- **session-start 语义**:快照含 untracked(写树时 `add -A`),故「会话起点」= 工作区当时全貌;gitignored 文件两侧都不计,符合预期。
- **明确不做**:staging/commit/blame/history/stash/冲突解决/Tier3 评审评论/语法高亮——越界即偏离 hip 定位。
