# 更改面板 · Diff 可见性 × 面板体验优化 执行计划

- 系列：`docs/design/changes-diff-stage/`
- 配套：`docs/design/changes-diff-stage/changes-diff-clarity-spec.md`（根因 K1-K8 + 改进 T1-T17 + 验收 12 项）；`changes-diff-clarity-preview.html`（现状/方案对照 + 全交互原型，已通过 17/17 Chrome CDP 断言）
- 状态：待评审
- 日期：2026-08-13
- 前置基线：spec 已评审通过；`fs:diffFile` 的 `context` 参数已端到端可用（`requestDiffFile(sessionId, p, context)` → sidecar `-U${ctx}`，默认 3 行）——T6/T11 **零协议/零 sidecar 改动**

---

## 1. 策略

1. **P0 可见性先行、只动行渲染**：PR-1..3 全部收敛在 `DiffDisplay.tsx` 一行族（行样式/块分组/行号列/word diff/徽标/展开），不动面板结构与数据流——先让"diff 读得出来"，再做面板级结构（汇总条/筛选）。
2. **复用协议，不扩协议**：上下文档位与展开（T6/T11）全部走现有 `fs:diffFile` + `context` 参数，按 path 替换该文件 hunks（`diffStore` 现有 `fs:diffFile:result` 语义）。初始列表 `fs:diff` 保持 git 默认 `-U3` 不动——**档位语义 = 展开/重取粒度，不是初始列表粒度**，避免误解（与 spec 措辞对齐：默认行为不变）。
3. **共享组件 props 门控**：`DiffDisplay` 被 Diff / Timeline / Changes 三方复用，汇总条/筛选（T7/T8）必须通过 props 开关（`showSummary` 等）默认关闭，只 Changes 场景启用——不允许污染其他两个视图。
4. **store 最小面**：T9 只加 `refreshing` 位；档位（diffContext）放 `uiStore` 与 `diffViewMode` 并列；不新增任何消息类型。
5. **P0 / P1 / P2 分层**：P0 = 行级可见性三 PR（用户感知核心）；P1 = 面板体验三 PR；P2 = 语义/无障碍两 PR（可独立验证，后置不阻塞）。
6. **门禁**：每 PR `yarn tsc` + `npx vitest run`（相关文件 + 全量回归）+ `translation-keys.test.ts` 五语言 + e2e 选择器同步 + 与 preview「方案」态人工对照。

## 2. 依赖图

```
PR-1 行级可见性(T1-T3) ─▶ PR-2 word diff(T4) ─▶ PR-3 徽标+档位+展开(T5/T6/T11)
        │                                              │
        └── 同一文件族串行（DiffDisplay.tsx 增量）        ▼
                                              PR-4 汇总条+筛选(T7/T8)
                                                      │
                                              PR-5 刷新反馈+复制+行级操作(T9/T12/T13)
                                                      │
                                              PR-6 hunk 键盘导航(T10)
                                                      │
                                              PR-7 审查三级+无障碍(T14/T15)
                                                      │
                                              PR-8(P2) minimap+状态分组(T16/T17)
```

- 串行主链：PR-1 → PR-2 → PR-3 → PR-4 → PR-5 → PR-6 → PR-7（PR-1..3 同改 `DiffDisplay.tsx`；PR-4/5 各含 DiffDisplay 增量 + 各自新区域，仍按序避免合并冲突）
- 可并行插队：PR-6 只动 `ChangesView.tsx` keydown，PR-1 后可随时插队；PR-8 独立，任意时点可做（P2 可选）
- PR-3 依赖 PR-2 的 split 行结构（展开按钮挂在 HunkHeader，徽标计数与行渲染共用）

## 3. PR 明细

### PR-1 行级可见性：色条 + 块分组 + 行号列（T1/T2/T3，1.5 天）

**目标**：变更行 = 2px 色条 + 12% 底色 + hover 加深；连续变更成圆角块；行号列与内容列分层、add/del 行号着色。

文件级任务：
- `src/components/artifact/DiffDisplay.tsx`：
  - `lineStyle(t)` 扩展：add 行 `bg-success/[0.12]` + `box-shadow: inset 2px 0 0 0 var(--success)`（inset 而非 border，不挤内容宽度）；del 同理 `--danger`；hover 加深类（`hover:bg-success/[0.18]`）——`SplitCell` 行样式同步受益（同一函数）
  - T2 块分组：`HunkLines` 改为按连续 add/del run 分组渲染——run 包 `<div class="diff-chg">`（首行 `rounded-t-[4px]`、末行 `rounded-b-[4px]`、块内行加 1px 内描边 `inset 0 0 0 1px` 组合，块与相邻 ctx 行留 1px 边距）；run 间 ctx 行保持裸渲染
  - T3 行号列：`.ln` 加 `bg-surface-subtle/60` 底纹；unified 第二行号列右侧 1px 分隔线（split 单列同）；add/del 行号分别 `text-success/80` / `text-danger/80`（unified 双列、split 各侧同规则）
- `src/styles/` 无新增（内联 Tailwind 类，任意值 alpha 语法已可用）
- 注意：`useLayoutEffect` 的 sticky 偏移按 header 高度累加，块分组不改 header 高度——回归点；`data-testid` 全部保持（`diff-file` / `diff-status` / `diff-hunk-header` / `diff-code-area` / `diff-show-full`）

测试（`DiffDisplay.test.tsx` 增量）：
- add/del 行含 rail 类与块 wrapper（run 分组正确：`del,del,add,add` → 两个块；`del,add` 等长配对同块）
- 上下文行无任何装饰类；块间空隙类存在
- 行号列底纹/分隔类存在；add 行号、del 行号、ctx 行号三类样式类正确
- 既有用例（展开/折叠/truncated/status chip）保持绿——选择器未变

验收：spec §5 项 1/2/3/12。

### PR-2 word diff 增强（T4，0.5 天）

**目标**：word diff 强度 25% → 36% + 圆角内衬；**split 视图补齐行内高亮**（现状只有 unified 有）。

文件级任务：
- `src/components/artifact/DiffDisplay.tsx`：
  - unified：`HunkLines` 内 word diff span 类 `bg-success/25` → `bg-success/35`（`/danger/35`）+ `rounded-[2px]`
  - split：`SplitCell` 增加 spans 渲染——`SplitHunks` 的 `buildSplitRows` 已产出 `{left, right}` 行配对，对 `left.type==='del' && right.type==='add'` 的配对行调 `wordDiff(left.content, right.content)`（`src/lib/wordDiff.ts` 已导出，零改动），左栏渲染 `del` span、右栏渲染 `add` span；非配对行裸渲染
  - 超长行防护：`line.content.length > 2000` 跳过计算（配对仍渲染、不高亮）
- `src/lib/wordDiff.ts`：不改（如需导出粒度调整仅注释）

测试：
- `DiffDisplay.test.tsx`：unified 配对行含 changed span；split 配对行两侧含对应 span；非配对（del 数 ≠ add 数）行无 span；超长行不产生 span
- `wordDiff.test.ts` 回归（零改动应全绿）

验收：spec §5 项 4。

### PR-3 Hunk 徽标 + 上下文档位/展开（T5/T6/T11，1 天）

**目标**：hunk header 显示 `+N −M` 量化徽标；⋯ 菜单提供上下文行数档位（全部/5/2）；hunk 展开按钮可增减上下文。

文件级任务：
- `DiffDisplay.tsx` `HunkHeader`：
  - T5 徽标：`@@ -a,b +c,d @@` 后追加 `+N −M`（从 `hunk.lines` 派生，样式复用 STATUS_CHIP 色板）；`data-testid="diff-hunk-badge"`；hover 操作按钮显隐规则不变
  - T11 展开按钮：hover 显示「展开 ↑5 行 / ↓5 行」→ `onExpandContext(path, dir)` 回调（向上=更早行、向下=更晚行；内部按当前 ctx 行数 +5 计算新 context 值）
- `src/domain/actions/fsActions.ts`：`requestDiffFile` 已带 `context` 参数，**仅需确认调用方传入**；若按行数增量语义需小改签名（`context` 接受 `number | 'full'` 现状够用，倾向不改）
- `src/store/uiStore.ts`：新增 `diffContext: number | 'full'`（默认 `'full'` = 现状）+ setter
- `ChangesTitlebarActions.tsx`：⋯ 菜单「上下文行数」radio 组（全部/5 行/2 行）→ 设置 `diffContext` 后对**当前已展开的每个文件**重发 `requestDiffFile(sessionId, path, ctx)`；`fs:diffFile:result` 按 path 替换（diffStore 现有语义，确认即可）
- `ChangesView.tsx`：`onExpandContext` 接线（传 `requestDiffFile(sessionId, p, nextCtx)`）；档位切换时清 `expanded`（`diff.expanded[path]`）避免与 showFull 状态打架

测试：
- `DiffDisplay.test.tsx`：徽标数字与行计数一致（add 2 del 1 → `+2 −1`）；展开按钮 hover 显隐
- `ChangesTitlebarActions.test.tsx`（若存在，否则新建）：档位 radio 切换 → `requestDiffFile` 以新 context 发出（transport spy）
- `ChangesView.test.tsx`：展开按钮点击 → requestDiffFile(context 增量) 发出

验收：spec §5 项 5/6。

### PR-4 汇总条 + 文件筛选（T7/T8，1 天）

**目标**：文件列表顶部 sticky 汇总条（文件数/总增删/折叠/展开/刷新 + 筛选输入）；⌘F 聚焦、Esc 还原。

文件级任务：
- `DiffDisplay.tsx`：
  - 新增 props：`showSummary?: boolean`（默认 false，**Timeline/Diff 场景不受影响**）、`onFilterChange?: (q: string) => void`、`filterQuery?: string`、`filterEmptyLabel?: string`
  - `showSummary` 时在滚动容器顶部渲染 sticky 汇总条：`N 个文件 · +A −D`（`sumDiffStats` 复用，`panelContextSlotModel` 已有）+ 全部折叠/全部展开/刷新按钮 + 筛选输入（`data-testid="diff-filter"`）；`>6` 文件时自动显示（`showSummary && files.length > 6` 或由 Changes 传入 `summaryShown` 计算）
  - 筛选空态：无匹配时显示「没有匹配的文件」+ 恢复提示
- `ChangesView.tsx`：`showSummary` 接线 + `filterQuery` 本地状态（useState，不进 store——刷新/切 base 时保留）；`⌘F`/`Ctrl+F` 聚焦筛选输入、`Esc` 清空还原（复用现有 keydown 的 INPUT 守卫）；窄面板（<420px）筛选收缩为图标态
- `ChangesTitlebarActions.tsx`：汇总条出现时标题栏 `+A −D` 小字保留（不冲突）；⋯ 菜单「全部折叠/展开」入口保留（不删，双入口）

测试：
- `DiffDisplay.test.tsx`：`showSummary=false` 不渲染汇总条（Timeline 回归）；true 时数字与 files 一致；折叠/展开按钮触发回调
- `ChangesView.test.tsx`：⌘F 聚焦、输入过滤（行数变化）、Esc 还原、无匹配空态文案
- 键盘：筛选聚焦时 j/k 不触发（现有守卫回归用例）

验收：spec §5 项 7/8。

### PR-5 刷新反馈 + 复制 diff + 行级操作（T9/T12/T13，1 天）

**目标**：刷新有进行中反馈；文件/全局可复制 git diff 文本；变更行 hover 提供复制行/引用到对话。

文件级任务：
- `src/store/diffStore.ts`：`refreshing: Record<sessionId, boolean>`——`requestDiff`（`FsActions.requestDiff`）置位、`fs:diff:result`/`fs:diffFile:result` 清除（最小面，现状 `status: 'loading'` 已有但被 dedupe 逻辑占用，独立位避免行为变更）
- `ChangesTitlebarActions.tsx`：⋯ 菜单 + 汇总条刷新按钮在 `refreshing` 时显示转圈（复用 `.animate-spin`，`data-testid="changes-refresh-spinning"`）；⋯ 菜单加「复制全部 diff」（拼接 `formatHunkText` 输出，与 hunk 复制同格式）
- `DiffDisplay.tsx`：
  - 文件行 ⋯ 菜单加「复制此文件 diff」（`formatHunkText` 拼接 `diff --git a/... b/...` 头）
  - T12 行级操作：add/del 行 hover 行尾浮出「复制行」「引用到对话」icon 按钮（`data-testid="diff-line-copy"` / `diff-line-quote`）→ 分别 `copyText(line.content)` / `setComposerQuote(\`${path}\n${content}\`)`（`composerBridge` 已有）；**按钮 click 必须 `stopPropagation`**（防触发手风琴）
  - 引用按钮在无 composer 时 toast 降级（复用现有 `insertComposerText` 失败分支语义，如不适用则仅 quote 不注入）
- i18n：`copyLine / quoteLine / copyFileDiff / copyAllDiff / refreshing` 等新 key

测试：
- `diffStore.test.ts`：refreshing 置位/清除流转
- `ChangesTitlebarActions`：复制全部 diff 输出含全部文件路径（clipboard spy 或回调捕获）
- `DiffDisplay.test.tsx`：行 hover 按钮存在且 click 不冒泡到折叠（spy `onToggleCollapse` 未调用）；复制行内容正确
- 验收：spec §5 项 9/10。

### PR-6 Hunk 键盘导航（T10，0.5 天）

**目标**：⌥⌘↓/⌥⌘↑ 在当前展开文件的 hunk 间跳转，目标 header 高亮 1.2s 淡出并滚动跟随。

文件级任务：
- `ChangesView.tsx` keydown 扩展：
  - `⌥⌘↓/⌥⌘↑`：收集当前展开文件内 `[data-testid="diff-hunk-header"]` 列表（含跨文件？——**仅当前展开文件**，与 preview 一致），游标跳转 + `scrollIntoView({ block: 'nearest' })` + 目标加 `.hunk-flash` 类（`transition: background-color`，1.2s 后移除）
  - 与现有 j/k（文件行）、`⌘Enter`（审查）、`Esc`（关闭）共存；表单聚焦守卫沿用
  - 无展开文件 / 无 hunk 时忽略
- `DiffDisplay.tsx`：`HunkHeader` 增加 `.hunk-flash` 样式类（accent 色淡出，`fade-only` 原则：仅 background-color transition）

测试：
- `ChangesView.test.tsx`：展开文件后 ⌥⌘↓ 触发 flash 类 + 滚动调用（`scrollIntoView` spy）；未展开时无操作；INPUT 聚焦时不触发
- 验收：spec §5 项 9。

### PR-7 审查三级 + 无障碍（T14/T15，0.5 天）

**目标**：hunk 级「请 agent 解释此改动」；diff 行 aria 语义。

文件级任务：
- `DiffDisplay.tsx` `HunkHeader` hover 菜单/按钮加「请 agent 解释此改动」→ `setComposerQuote(\`${path}\n${hunkText}\`)` + 指令模板注入（与 `reviewPrompt` 同构，新建 i18n key `explainHunkPrompt`）
- aria：diff 行加 `role="row"` + `aria-label="新增行/删除行/上下文行"`（`lineStyle` 渲染处），hunk 结构 `role="group"`——纯属性增量，无视觉变化
- i18n 五语言 key 同步（含 PR-3..6 全部新增 keys 一并核对）

测试：
- `DiffDisplay.test.tsx`：aria 属性存在；「解释」按钮触发注入（composerBridge spy）
- `translation-keys.test.ts` 五语言一致（门禁）
- 验收：spec §5 项 11 + T14/T15。

### PR-8（P2，可选）Minimap + 状态分组（T16/T17，1 天）

**目标**：长文件变更分布条；文件列表按 A/M/D/R 分组。

- T16：文件行右侧 6px 细条（hunk 分布色点，`>400 行 && hunk ≥3` 显示，窄面板隐藏），hover 显示 hunk 位置、点击跳转该 hunk（复用 PR-6 的 flash 通道）
- T17：⋯ 菜单「按状态分组」开关（默认路径排序不变）；分组头为 A/M/D/R 小 chip 行
- 独立验证，不阻塞 M1/M2；验收 spec §5 项 1-12 回归 + 新项人工对照

## 4. 里程碑

| 里程碑 | 内容 | 估算 |
|---|---|---|
| M1（P0） | PR-1 + PR-2 + PR-3：diff 行级可见性全量（色条/块/行号/word diff/徽标/上下文档位/展开） | 3 人日 |
| M2（P1） | PR-4 + PR-5 + PR-6：汇总条/筛选/刷新反馈/复制/行级操作/hunk 导航 | 2.5 人日 |
| M3（P2） | PR-7：审查三级 + 无障碍 | 0.5 人日 |
| M4（P2 可选） | PR-8：minimap + 状态分组 | 1 人日 |

P0（M1）≈ 3 人日；P1（M2）≈ 2.5 人日；P2（M3+M4）≈ 1.5 人日。每 PR 独立提交，提交信息含 `changes-diff-clarity PR-N` 与 spec 条目（如 `T1/T2`）。

## 5. 回归门禁清单

1. `yarn tsc --noEmit` 零错误
2. `npx vitest run`：DiffDisplay / ChangesView / ChangesTitlebarActions / diffStore / wordDiff / translation-keys 相关全绿 + 全量回归（`yarn test` 前按 CLAUDE.md 将 `~/.hip/config/auth.json` 暂时移开，防付费 LLM 测试触发）
3. e2e：如 `e2e/specs/` 存在 changes/diff 相关 spec，选择器随 PR 同步（新 testid：`diff-hunk-badge` / `diff-filter` / `diff-line-copy` / `changes-refresh-spinning` 等）；无则 PR-4 补一条冒烟（打开更改 tab → 徽标存在）
4. i18n 五语言新增 keys 一致（`translation-keys.test.ts` 强制）
5. 与 `changes-diff-clarity-preview.html`「方案」态人工对照：行视觉（色条/块/行号色）、split word diff、徽标、筛选/汇总条、上下文折叠/展开、hunk 导航、行级操作——7 个场景逐一手感对比
6. 窄面板（<420px）回归：无横向溢出、split 菜单禁用（现有规则）、汇总条图标态

## 6. 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| 块分组 wrapper 在 `overflow-x-auto` 内宽度行为异常（长行横向滚动时圆角/描边错位） | 中 | wrapper 用 `w-max min-w-full`（preview 已验证的 f-inner 模式）；PR-1 单测 + 人工对照长行文件 |
| 行级操作按钮冒泡触发手风琴折叠 | 中 | click `stopPropagation`；PR-5 显式 spy 断言 `onToggleCollapse` 未调用 |
| `DiffDisplay` 共享组件被 Timeline/Diff 复用，汇总条/筛选泄漏 | 中 | props 门控 `showSummary` 默认 false；PR-4 回归用例断言 Timeline 不渲染 |
| 「上下文档位」语义误解（初始列表是 `-U3`，档位只作用于展开/重取） | 中 | 菜单文案明确「展开时上下文行数」；spec/plan 均注明；PR-3 测试断言初始请求不带新参数 |
| `showFull`（expanded）与档位切换/展开按钮状态冲突 | 中 | 档位切换时清 `expanded`；`expanded` 优先级高于档位（现状 showFull 语义不变） |
| 行号列底纹 + 色条在 sticky header 下滚动撕裂 | 低 | 行内样式无 sticky 依赖；PR-1 人工对照滚动 |
| 超长行 word diff 计算开销 | 低 | >2000 字符跳过（PR-2 已定，对齐 spec §7） |
| 新增 i18n keys 五语言漏同步 | 低 | `translation-keys.test.ts` 门禁 + 每 PR 提交前全量跑 |
| PR-5 的 `refreshing` 位与现有 `status:'loading'` dedupe 逻辑互扰 | 低 | 独立位、不动 dedupe；diffStore 测试覆盖双状态 |
| 筛选输入与 j/k/space 键盘冲突 | 低 | 现有 INPUT/TEXTAREA 守卫复用（ChangesView 已有），PR-4 回归用例 |

## 7. 交付物清单

- [ ] PR-1：`DiffDisplay.tsx` 行视觉（T1/T2/T3）+ `DiffDisplay.test.tsx` 增量
- [ ] PR-2：`DiffDisplay.tsx` split word diff + 强度（T4）+ 测试
- [ ] PR-3：`HunkHeader` 徽标/展开（T5/T6/T11）+ `uiStore.diffContext` + titlebar 菜单 + 测试
- [ ] PR-4：`DiffDisplay` 汇总条/筛选 props + `ChangesView` 筛选状态/⌘F（T7/T8）+ 测试
- [ ] PR-5：`diffStore.refreshing` + 复制 diff + 行级操作（T9/T12/T13）+ 测试
- [ ] PR-6：hunk 键盘导航（T10）+ 测试
- [ ] PR-7：审查三级 + aria（T14/T15）+ i18n 五语言
- [ ] PR-8（P2 可选）：minimap + 状态分组（T16/T17）
- [ ] i18n 五语言 `artifact.changesView.*` / `artifact.diffView.*` 新增 keys（随各 PR）
- [ ] e2e 选择器同步 / 冒烟（PR-4）
