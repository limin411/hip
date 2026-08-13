# 更改面板 · Diff 可见性 × 面板体验优化 Spec

- 系列：`docs/design/changes-diff-stage/`
- 配套：`docs/design/changes-diff-stage/changes-diff-clarity-preview.html`（现状/方案对照 + 高保真交互原型，浏览器直接打开）
- 状态：待评审
- 日期：2026-08-13
- 涉及模块：`ChangesView`（面板）、`DiffDisplay`（diff 渲染）、`ChangesTitlebarActions`（标题栏）、`wordDiff`（行内 diff）、`fsActions`/sidecar（仅复用现有 `context` 参数，无协议改动）
- 基线：`DESIGN.md`（视觉令牌）、`docs/design/table-right-panel/`（系列格式）

---

## 1. 根因：diff 存在，但"读不出来"

"更改"面板能正确渲染 diff（hunk、行号、word diff、上下文行都有），但**视觉上变更不突出**：浅色下扫一眼难以分辨哪几行变了、变在哪一块、每块改了多严重。逐项代码证据：

| # | 现象 | 代码证据 | 根因 |
|---|---|---|---|
| K1 | 变更行底色只有 **7%** 透明度，浅色主题下几乎看不出；深色主题下也仅靠微弱的 tint 区分 | `DiffDisplay.tsx` `lineStyle()`：`bg-success/[0.07]` / `bg-danger/[0.07]` | 行级强度过低；且无任何"色条 rail"（GitHub / VS Code 均用左侧竖条锚定变更区） |
| K2 | 上下文行与变更行**等宽等距**，无块状分组；连续变更"粘"在普通行里，视觉噪音大 | 每个 diff 行渲染为独立 `div`，ctx/add/del 只差一个 7% 底色 | 缺"变更块"轮廓：连续 add/del 应成组（圆角 + 内描边 + 色条连续） |
| K3 | 行号列与内容列无分隔、无底纹；变更行的行号与普通行同色，**"第几行变了"无法从行号侧定位** | `HunkLines`/`SplitCell`：行号 span 仅 `text-ink-tertiary/80`，无背景、无边界、无变色 | 行号列应承担"变更位置坐标"职责（GitHub 行号随行变色） |
| K4 | word diff 强度 25% 且**仅 unified 视图有**；split 视图配对行完全无行内高亮 | `HunkLines` 用 `computeHunkWordDiffs`，`SplitCell` 只渲染 `line.content` | 行内 diff 语义在 split 下缺失；25% 在暗色下偏弱 |
| K5 | 每个 hunk 只显示 `@@ -a,b +c,d @@` 范围，**没有"这块改了多少"的量化徽标** | `HunkHeader` 渲染范围文本 + 函数名，无 `+N −M` | 变更严重程度只能靠肉眼数行 |
| K6 | 文件多时只有 accordion 列表，**无汇总条**（文件数/总增删只在标题栏小字）；无文件筛选；全部折叠/展开埋在 ⋯ 菜单 | `ChangesTitlebarActions` 的 label 小字 + `DiffDisplay` 纯列表 | 面板缺"总览 → 定位 → 细读"的导航结构 |
| K7 | 点击刷新无任何进行中反馈（requestDiff 异步）；hunk 间无法键盘跳转；变更行无行级操作（复制/引用只能整块） | `requestDiff` 无 pending 态渲染；键盘仅 j/k 移动文件行 | 长 diff 下的定位与操作成本高 |
| K8 | 大文件 diff 默认全量展开（truncated 机制只在超限时兜底），上下文行全部渲染，稀释变更密度 | `fs:diffFile` 已有 `context?: number` 参数，前端默认未用 | 缺"紧凑上下文"档位（GitHub 默认折叠上下文） |

### 1.1 用户感知

> 打开更改面板，扫一眼：满屏灰色代码行里零星浮着几乎看不见的浅色底纹。要回答"agent 改了什么"，得逐行瞪着眼找；文件一多，先看哪个文件、改了多少、哪块最关键，全都没有快速答案。

---

## 2. 基线：专业工具怎么做 diff 可见性

| 工具 | 变更行标识 | 行内高亮 | 块/导航 | 总览 |
|---|---|---|---|---|
| GitHub PR | 左侧 3px 色条 + 底色（约 10-14%）；行号随行变色 | word 级，add 橙底/del 红底；split 与 unified 都有 | 上下文折叠"…展开 N 行"；hunk 间快捷键跳转 | 文件树筛选框 + 文件级 +/− 统计 |
| VS Code 编辑器内 diff | 编辑器 gutter 色条 + 行底色 + 块标记（editorOverviewRuler） | word 级，unified 无 strikethrough 歧义 | minimap 预览块；⌘+↓ 跳下一个变更 | 变更文件列表 + 展开/折叠全部 |
| JetBrains | 左 gutter 色块 + 行底；对比面板上下分栏 | word 级双侧 | hunk 间 F7/Shift+F7 跳转 | 文件树 + 变更计数徽标 |

共同点：**色条锚定（不只靠底色）、行号参与变色、行内高亮双侧一致、有"总览→定位"结构、有上下文折叠**。hip 现状五项全缺或偏弱。

---

## 3. 改进项

### P0 — Diff 可见性（核心诉求）

#### T1 变更行强化：色条 rail + 强度提升（P0）

- add 行：`box-shadow: inset 2px 0 0 0 var(--success)`（**inset 阴影而非 border**，不挤占内容宽度，长行滚动不破）；底色 `bg-success/[0.07]` → `success/12`；hover 加深到 `success/18`。
- del 行同规则用 `--danger`。
- unified / split 共用同一套行样式（`lineStyle()` 内统一修改，SplitCell 同步受益）。
- 实现点：`lineStyle(t, hover)` 改为返回 `bg + inset shadow` 组合类；`SplitCell` 行沿用。

#### T2 变更块分组：连续变更成"块"（P0）

- 连续 add/del 行（无 ctx 隔断）构成一个变更块：首行 `rounded-t-[4px]`、末行 `rounded-b-[4px]`，块内每行带 1px 内描边 `inset 0 0 0 1px color-mix(success 20%)`（相邻行描边自然连续成完整轮廓）；块与相邻 ctx 行之间留 1px 空隙（`margin: 1px 0`）。
- 块首行内描边**不盖掉**色条：`inset 3px 0 0 0 var(--success), inset 0 0 0 1px mix(...)` 顺序组合。
- 视觉结果：一行行浅底 → **一块块矩形**，变更密度一眼可数。
- 实现点：`HunkLines` 渲染时按 `line.type` 连续段分组，首/末行追加圆角与边距类。

#### T3 行号列：定位坐标化（P0）

- 行号列加右边界 `border-r border-border/60` + 底纹 `bg-surface-subtle/60`（与内容列分层）；
- 变更行的行号着色：add 行行号 `text-success/80`、del 行行号 `text-danger/80`，普通行保持 tertiary——"第几行变了"从左侧即可扫出；
- unified 双列行号（oldNo/newNo）规则相同；split 各侧只染自己那侧。

#### T4 word diff 增强（P0）

- 强度统一视图 `success/25` → `success/35`（`del` 用 `danger/35`），加 `rounded-[2px]` 内衬（避免长词高亮贴边）；
- **split 视图补齐 word diff**：`SplitCell` 增加行配对——`buildSplitRows` 已产出 `{left, right}` 配对，对 `left.type==='del' && right.type==='add'` 的配对行用 `wordDiff()` 生成双侧 span（与 unified 同语义）。超长行（>2000 字符）跳过计算。

#### T5 Hunk 量化徽标（P0）

- hunk header `@@ -a,b +c,d @@` 之后追加 `+N −M` 徽标（add/del 行计数，从 `hunk.lines` 派生，无协议改动）；徽标样式复用 STATUS_CHIP 的 success/danger 小 chip。
- 函数名（`hunk.header`）截断规则不变；徽标始终可见（hover 操作按钮保持 hover 显隐）。

#### T6 紧凑上下文档位（P0，复用现有协议）

- `fs:diffFile` 已支持 `context?: number`；前端新增菜单档位「上下文行数：全部 / 5 行 / 2 行」（默认保持现状"全部"，不改变默认行为——T6 为**可选档位**，P0 只做菜单 + 请求参数透传）。
- 折叠后 hunk 底部显示「展开 ↑N 行 / ↓N 行」按钮（T11 同一通道）。

### P1 — 面板级体验

#### T7 变更汇总条（P1）

- 文件列表顶部 sticky 条（`DiffDisplay` 内，scrollRef 之上）：`N 个文件 · +A −D` 左对齐；右侧「全部折叠 / 全部展开 / 刷新」按钮（从 ⋯ 菜单**上浮**，菜单保留入口不冲突）；`>6` 个文件时显示。
- 汇总数字与 `sumDiffStats(diff.files)` 一致（复用）。

#### T8 文件筛选（P1）

- 汇总条右侧 filter 输入：按路径子串过滤文件行（实时，`useMemo`）；`⌘F`/`Ctrl+F` 聚焦、`Esc` 清空并还原；无匹配显示空态文案；聚焦时 j/k 键盘守卫（现有 INPUT 判定已覆盖）。
- >8 个文件时自动展开输入框，否则图标按钮展开（窄面板图标态）。

#### T9 刷新反馈（P1）

- `requestDiff` 请求期间：标题栏刷新按钮（⋯ 菜单 + 汇总条）显示转圈；文件列表保持旧数据（不闪空），行首加 12px spinner 指示"刷新中"。
- 数据源：`diff.status !== 'ready'` 已有状态字段，补一个 `refreshing` 位（store 最小改动）。

#### T10 Hunk 键盘导航（P1）

- `⌥⌘↓/⌥⌘↑`（面板聚焦时）：在**当前展开文件**的 hunk 间跳转；目标 hunk header 加 accent 高亮（`bg-accent/10`）1.2s 淡出，`scrollIntoView({block:'nearest'})`。
- 与现有 j/k 文件行导航共存（j/k 管文件、⌥⌘↑↓ 管 hunk）；空态无 hunk 时忽略。

#### T11 上下文展开/收起（P1）

- hunk header hover 显示「展开 ↑5 行」「展开 ↓5 行」；点击请求 `fs:diffFile`（`context` 增量），替换该文件 hunks（现有 `fs:diffFile:result` 通道已按 path 替换）。
- 与 T6 档位联动：折叠档下"展开 N 行"按钮替代整段 ctx 渲染。

#### T12 行级操作（P1）

- 变更行（add/del）hover 时行尾浮出两个 icon 按钮：「复制行」「引用到对话」（quote 复用 `setComposerQuote` 通道，降级为单行文本）；行右键菜单同两项。
- 与 hunk 级「复制 / 标注 / 引用」按钮并存，形成行/块两级粒度。

#### T13 复制 diff（P1）

- 文件行 ⋯ 菜单加「复制此文件 diff」（`git diff` 文本，复用 `formatHunkText` 拼接）；标题栏 ⋯ 菜单加「复制全部 diff」（全部文件拼接）。

### P2 — 语义与无障碍（独立验证，可后置）

#### T14 审查范围化（P2）

- 现有三级：标题栏「审查」（全部）→ 文件 ⋯「审查此文件」→ **新增** hunk header 菜单「请 agent 解释此改动」（quote + 指令模板注入 composer）。三级粒度闭环。

#### T15 色盲安全与 aria（P2）

- 变更标识已含 +/− 符号与字母 chip；补 hunk 徽标用 `+N −M` 符号前缀（非仅颜色）；diff 行加 `role="row"` + `aria-label="新增行/删除行/上下文行"`（轻量，无测试破坏）。

#### T16 Diff minimap（P2，可选）

- 文件 >400 行且 hunk ≥3 时，文件行右侧 6px 细条渲染变更分布（add/del 色点），hover 显示 hunk 位置、点击跳转；窄面板（<420px）自动隐藏。

#### T17 状态分组排序（P2，可选）

- 文件列表菜单「按状态分组」开关：A/M/D/R 分组头（默认路径排序，与现状一致）。

---

## 4. 交互序列（P0 关键路径）

### 4.1 打开更改面板

```
激活更改 tab → requestDiff
→ 文件列表 + 汇总条（>6 文件）
→ 展开第一个文件（≤3 文件全开，现状规则不变）
→ diff 渲染：变更行成块（色条 + 内描边 + 圆角）、行号列着色 + 分隔、
   word diff 双侧高亮、hunk 徽标 +N −M
```

### 4.2 定位一个变更

```
⌘F → 输入路径子串 → 列表过滤（匹配行保留）
→ ⌥⌘↓ → 跳下一个 hunk（header 高亮 1.2s）
→ 鼠标悬停变更行 → 「复制行 / 引用到对话」
→ 需要更多上下文 → hunk header「展开 ↑5 行」→ 局部刷新该文件
```

### 4.3 审查/提交

```
标题栏「审查」→ 注入全部文件 prompt（现状不变）
文件 ⋯「审查此文件」→ 注入单文件（现状不变）
hunk「请 agent 解释此改动」→ 注入单块（新增）
```

### 4.4 窄面板（<420px）

```
汇总条压缩为数字 + 图标按钮；筛选图标化；hunk 徽标保留；
split 菜单禁用（现状规则不变）；色条/块/行号不受宽度影响
```

---

## 5. 验收清单

| # | 验收点 | 关联 |
|---|---|---|
| 1 | 亮/暗主题下变更行 = 色条(2px) + 底色(12%)，hover 加深；上下文行无任何装饰 | T1 |
| 2 | 连续变更成块：圆角 + 连续内描边；块间有 1px 空隙；unified/split 一致 | T2 |
| 3 | 行号列有分隔与底纹；add/del 行号分别染 success/danger | T3 |
| 4 | word diff 强度提升；split 配对行双侧行内高亮与 unified 语义一致 | T4 |
| 5 | hunk 徽标 +N −M 与行计数一致；函数名截断不回归 | T5 |
| 6 | 上下文档位 全部/5/2 生效；展开 ↑/↓ 请求后该文件 hunks 更新 | T6/T11 |
| 7 | 汇总条数字与文件一致；折叠/展开/刷新可用；刷新有 spinner | T7/T9 |
| 8 | ⌘F 过滤正确、Esc 还原、无匹配空态；与 j/k 无冲突 | T8 |
| 9 | ⌥⌘↑↓ 在 hunk 间跳转、目标高亮淡出、滚动跟随 | T10 |
| 10 | 行级复制/引用正确；文件/全部复制为 git diff 文本 | T12/T13 |
| 11 | i18n 五语言 keys 同步（translation-keys 测试绿）；`DiffDisplay.test.tsx` 等既有测试全绿（data-testid 不变，仅类名/结构增量） | 全部 |
| 12 | 窄面板（<420px）无横向溢出；split 菜单仍禁用 | T1-T7 回归 |

## 6. 非目标

- 不改 git diff 计算与 sidecar 协议（仅复用已有 `context?: number` 参数）；
- 不做行内评论/多行注释（hunk 级标注 `diffAnnotationStore` 已存在，不扩展粒度）；
- 不做 split 左右行的对齐连线（word diff 已覆盖配对语义）；
- 不改提交记录（commitLog）区视觉——本系列只动 uncommitted diff 区与面板 chrome；
- 不注册窗口级全局快捷键（hunk 导航仅面板挂载时生效，沿用现有 keydown 挂载模式）；
- 不引入虚拟滚动（truncated + 展开机制已控行数；T6 档位进一步压缩，够用）。

## 7. 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| inset 阴影 + 圆角改动影响 sticky header 偏移计算（`DiffDisplay` useLayoutEffect 按 header 高度累加） | 低 | 只改行级类，header 高度不变；验收 5/12 覆盖 |
| word diff 在 split 引入计算开销（超长行） | 低 | 沿用 O(n) 公共前后缀；>2000 字符行跳过（T4 已定） |
| T6/T11 上下文请求频繁（每次点击一次 fs:diffFile） | 低 | 该文件请求 pending 期间禁用按钮；结果按 path 替换（现有通道语义） |
| 筛选输入与现有 j/k/space 键盘冲突 | 低 | 现有 keydown 已对 INPUT/TEXTAREA 提前返回（ChangesView 已有守卫） |
| 新增 i18n keys 五语言漏同步 | 低 | `translation-keys.test.ts` 门禁 |
| 色条用 inset shadow 在 `overflow-x-auto` 长行横向滚动时贴边 | 低 | inset 随内容滚动，语义即"行首标记"，符合 GitHub 行为 |

## 8. 交付物

- [ ] `DiffDisplay.tsx`：T1/T2/T3/T4 行级视觉 + `HunkLines` 块分组 + `SplitCell` word diff + T5 徽标 + T7 汇总条 + T8 筛选 + T10 hunk 导航高亮 + T11 展开按钮 + T12 行级操作 + T13 复制 diff
- [ ] `ChangesView.tsx`：汇总条/筛选/键盘状态接线（若不在 DiffDisplay 内自持）
- [ ] `ChangesTitlebarActions.tsx`：T9 刷新 spinner + T13 复制全部 + T6 上下文档位菜单
- [ ] `wordDiff.ts`：暴露 `wordDiff` 供 SplitCell 复用（已有导出，零改动或仅文档）
- [ ] `diffStore`：`refreshing` 位（最小面）
- [ ] i18n 五语言 `artifact.changesView.*` / `artifact.diffView.*` 新增 keys
- [ ] 测试：`DiffDisplay.test.tsx` 增量（块分组类、徽标计数、行级按钮、筛选、hunk 导航）；`ChangesView.test.tsx` 回归
- [ ] 预览：`docs/design/changes-diff-stage/changes-diff-clarity-preview.html`（现状/方案对照 + 全交互）
