# 文档管理 × Notion 细节整改 · 执行计划（Plan）

> 依据：`docs/design/doc-notion-polish/doc-notion-polish-spec.md`（v3.0）+ 高保真预览 `docs/design/doc-notion-polish/doc-notion-polish-preview.html`（视觉基准，浏览器打开对照）
> 目标分支：`feature/doc-notion-polish`（从 trunk 切出，按 PR 拆分合入）
> 规模估算：**P0 6–8 人日 + P1 2.5–3.5 人日 + P2 3–5 人日 ≈ 12–17 人日**（单人 3 周；如与 V2 遗留并行，P0 的 PR-1/PR-2 可穿插）
> 范围护栏（spec §5 非目标，本计划不包含）：全局设计语言改造、嵌套树侧边栏/文档层级拖拽、数据库/元数据 UI、Notion 导入导出。

---

## 1. 计划总览

| PR | 阶段 | 主题 | spec 项 | 依赖 | 估算 | 状态 |
|---|---|---|---|---|---|---|
| **PR-1** | P0 | 页面骨架：删 48px 工具栏、面包屑移入标题上方、页面 ⋯ 移入标题 hover、保存状态静默化 | T1/T10 | 无 | 2 人日 | ⬜ |
| **PR-2** | P0 | 排版参数：16px/1.5、块距 4px、h1 30/h2 24/h3 20、默认页宽 708px | T2/T3 | 无 | 1 人日 | ⬜ |
| **PR-3** | P0 | 块级视觉：待办自绘 + 删除线、引用不降灰、表格/选区/菜单 hover 中性化 | T5/T6/T8 | PR-2（同一 CSS 域） | 1.5 人日 | ⬜ |
| **PR-4** | P0 | 编辑器交互：六点手柄 + 块菜单、气泡精简 6 按钮、代码块「纸张」主题 | T4/T7/T9 | PR-3 | 2.5–3.5 人日 | ⬜ |
| **PR-5** | P1 | 浏览视图：默认紧凑列表行 + hover ⋯、工具栏瘦身、空态大标题 | T11/T13 | 无 | 1.5–2 人日 | ⬜ |
| **PR-6** | P1 | 侧边栏目录行 hover ＋/⋯、选中态整行暖灰 | T12 | 无 | 1 人日 | ⬜ |
| **PR-7** | P2 | 交互补齐：手柄拖拽多选、块菜单重构；emoji 页面图标（需裁决） | T13–T15 | P0 全部 | 3–5 人日 | ⬜ |

**并行策略**：PR-1/PR-2/PR-5/PR-6 互相独立可并行（文件域不重叠：`KnowledgeWorkspace.tsx` / `knowledge-doc-typography.css` / `DocManagerBrowse.tsx` / `DirNavList.tsx`）；PR-3 → PR-4 串行（同一 `knowledge-blocknote.css` + `DocBlockNoteEditor.tsx` 域，避免冲突）。P2 在 P0 合入后启动（手柄交互依赖 T4 的侧边菜单重构）。

---

## 2. PR-1 — 页面骨架整改（T1/T10，2 人日）

**目标**：文档打开后顶部无 48px 常驻条；保存状态静默化。改 `KnowledgeWorkspace.tsx` 单一文件域 + `PageHeader.tsx`。

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| PR1-1 | 删除主区顶部 `h-12` 工具栏条；面包屑（`crumbItems` 逻辑保留）移入 `PageHeader`，渲染为标题上方 12px 小字路径（hover 项才显灰底，`.knowledge-doc-inline-pad` 对齐正文列） | `KnowledgeWorkspace.tsx`、`PageHeader.tsx` | 无 48px 条；crumb 点击/折叠行为与现状等价（复用 `onCrumbClick`） |
| PR1-2 | 页面 ⋯ 菜单（版本/导出/模板）移入标题行：标题 hover 时标题左侧出现 ⋯（`doc-title-row` 结构），菜单内容与 testid 不变 | `KnowledgeWorkspace.tsx`、`PageHeader.tsx` | hover 显示、点击弹出原菜单；`knowledge-doc-menu` testid 保留 |
| PR1-3 | 保存状态移入底部状态栏（新增 26px 状态条）：`saved` 静默不渲染、`saving` >800ms 才显示、`error` 必须显示 + 重试按钮；状态条其他区域留空 | `KnowledgeWorkspace.tsx` | 编辑 10s 无「已保存」出现；error 场景状态条可见（可注入测试） |

**测试**：
- `KnowledgeWorkspace.paper.test.tsx`：paper 溢出契约不受影响；新增保存状态静默断言
- **e2e 适配（重点）**：`e2e/helpers/knowledge.ts:595` 的 `waitForSave` 依赖 `knowledge-save-status`——改为轮询 `docBody` 落盘（`flushSave` 语义）或状态条 `saving` 消失；`knowledge-live*.spec.ts` / `knowledge-phase1.spec.ts` 中所有保存等待点回归
- `AppSidebar.test.tsx`：无直接依赖，回归即可

---

## 3. PR-2 — 排版参数整改（T2/T3，1 人日）

**目标**：正文节奏从「文章体」切到「块笔记」。纯 CSS + token，风险最低，先行合入供 PR-3 视觉对照。

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| PR2-1 | `--kb-font-body: 16px`、`--kb-line-body: 1.5`、`--kb-block-gap: 4px`、`--kb-para-gap: 4px`；h1/h2/h3 改固定 px（30/24/20）并收敛 margin（`0.9em 0 0.3em`） | `knowledge-doc-typography.css`（Live/Source/prose 共用变量源） | 与 preview.html §T3 视觉一致；导出 HTML 自动继承 |
| PR2-2 | 默认页宽 `46rem` → `min(100%, 44.25rem)`（708px）；wide/full 设置项保留 | `domain/knowledge/docWidth.ts` + 单测 | `normalizeDocWidthId` 回归；设置页选项不变 |
| PR2-3 | 标题区：`text-page` 28px → 32px；标题下留白 `pb-4`；空文档斜体占位「输入 / 或输入文字开始」（复用 `placeholder` prop，仅空文档显示，首键消失） | `InlineDocTitle.tsx`、`PageHeader.tsx` | 空文档 = 标题 + 斜体占位；输入首字符占位消失 |
| PR2-4 | i18n：占位文案 5 语言 | `src/i18n/*.ts` | `yarn test` i18n key 校验通过 |

**测试**：`InlineDocTitle.test.tsx` 扩展（占位显示/消失、Enter/blur 提交回归）；`docWidth` 单测更新；`htmlExport` 相关测试回归（排版变量共享）。

---

## 4. PR-3 — 块级视觉整改（T5/T6/T8，1.5 人日）

**目标**：块内细节中性化 + 自绘控件。全部 CSS 层（`knowledge-blocknote.css`），**不触碰 md 序列化**。

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| PR3-1 | 待办 checkbox 自绘：`appearance:none` + 16px 方块（1.2px 暖黑边框、圆角 3px）；勾选态深灰填充白勾 + 文字删除线变暖灰（CSS `:checked ~` 选择器，对齐 BlockNote checkbox DOM 结构） | `knowledge-blocknote.css` | 与 preview.html §T5 一致；空格键可切换；**md round-trip 不变**（纯视觉层，`mdTasks`/`dialectRoundTrip` 零改动） |
| PR3-2 | 引用块：边框 `currentColor`、移除 `text-secondary` 降灰；分割线微调 | `knowledge-blocknote.css` | 引用文字 = 正文色 |
| PR3-3 | 表格行 hover 改中性暖灰（新增 `--kb-hover` token，亮 `#f7f6f3`/暗 `#2f2f2f`）；`--kb-selection` 改中性蓝灰（亮 `rgba(45,110,220,.18)`）；斜杠菜单/手柄/气泡 hover 全部换 `--kb-hover`（替换现有 accent-tint 选择器） | `knowledge-blocknote.css` | 文档内 hover 无橙色 tint；选区非橙色 |

**测试**：`DocBlockNoteEditor.test.tsx` 回归（checkbox 切换逻辑不变）；`knowledge-live-r5.spec.ts` / `knowledge-multiselect.spec.ts` 中待办勾选 e2e 回归（选择器不变，仅样式）。

---

## 5. PR-4 — 编辑器交互整改（T4/T7/T9，2.5–3.5 人日）

**目标**：行首手柄 Notion 化 + 气泡精简 + 代码块纸面主题。这是 P0 中唯一动组件结构的 PR。

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| PR4-1 | `KnowledgeSideMenu` 重构：4 按钮组 → 「＋」（AddBlockButton）+ 六点手柄（内联 SVG 2×3 点阵）；点击手柄弹块菜单（复制块链接/复制/删除/多选入口）；Shift+点击多选逻辑保留（入口移入手柄菜单，`kb-multiselect-handle` testid 迁移） | `DocBlockNoteEditor.tsx`、`knowledge-blocknote.css` | hover 单行只出现 ＋ 与手柄；手柄菜单项齐全；`knowledge-multiselect.spec.ts` 适配新入口 |
| PR4-2 | 气泡工具栏：移除 `BlockTypeSelect`、删除线、行内码；保留 B/I/U/S + 链接 + 颜色；圆角 8px、选中态 `--kb-hover` | `DocBlockNoteEditor.tsx`（FormattingToolbar 组装） | 选区弹出 6 按钮；无块类型下拉 |
| PR4-3 | 代码块「纸张」主题：新增主题 id（设置项「文档代码块风格：纸张/深色」，默认纸张），`--kb-code-bg/fg` 由主题驱动；深色保留为选项 | `domain/knowledge/codeBlockTheme.ts`、`knowledge-blocknote.css`、设置页 | 浅色主题下代码块 = `#f7f6f3` 纸面 + 语言徽标；切换设置生效并持久化 |
| PR4-4 | 斜杠菜单尺寸：宽 356px、图标列 46px、分组标题 12px 大写灰字、项高 40px、选中项暖灰 | `BlockNoteHipSlashMenu.tsx` | 与 preview.html §D7 一致；键盘导航回归 |

**测试**：`DocBlockNoteEditor.test.tsx` / `BlockNoteHipSlashMenu.test.tsx` 更新（新结构选择器）；`knowledge-live.spec.ts` / `knowledge-live-r5.spec.ts` e2e 适配手柄与气泡；`codeBlockTheme` 单测扩展。

---

## 6. PR-5 — 浏览视图整改（T11/T13，1.5–2 人日）

**目标**：默认视图从网格改为紧凑列表，工具栏瘦身。

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| PR5-1 | 默认视图改 list：40px 行（类型图标 + 标题 + 「上次编辑」12px 灰字），行 hover 暖灰 + 行尾 ⋯（菜单 payload 复用右键）；移除「类型」列徽标 | `DocManagerBrowse.tsx` | 打开浏览页默认列表；行 hover 出现 ⋯ |
| PR5-2 | 工具栏瘦身：移除「↑ 返回」按钮（面包屑承担）；搜索框保留、收窄为 180px；视图切换保留（网格/列表）但仅网格非默认；「新建」改为实底主按钮 + 下拉（文档/文件夹） | `DocManagerBrowse.tsx` | 工具栏 ≤3 个元素 + 新建 |
| PR5-3 | 空态：大标题（24px）+ 灰字说明 + 实底主按钮「新建文档」；网格 tile 缩为 40px 图标 + 两行标题 | `DocManagerBrowse.tsx` | 空文件夹/空搜索态样式对齐 preview.html |
| PR5-4 | i18n 新增文案（「上次编辑」、空态）5 语言 | `src/i18n/*.ts` | key 校验通过 |

**测试**：`DocManagerSort.test.tsx` 适配——默认视图改 list 后 `browse-tile-*` 断言需先切 grid 或改行断言（`browse-row-*`）；新增：列表行 hover ⋯、空态渲染、工具栏元素断言。

---

## 7. PR-6 — 侧边栏目录行整改（T12，1 人日）

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| PR6-1 | 行 hover 出现「＋」（新建子项，`newIn` 规则复用）与「⋯」（菜单，payload 复用右键）；按钮 18px、hover 灰底 | `DirNavList.tsx` | hover 行出现两按钮；点击行为与菜单等价 |
| PR6-2 | 选中态：`accent/10` 底 + 橙色左条 → 整行 `--state-hover` 底 + 中性深灰左条（2px，`--border-strong`） | `DirNavList.tsx` | 选中行 = 灰底无橙色；chrome 其他区域不变 |

**测试**：`AppSidebar.test.tsx` 扩展（hover 操作按钮渲染、选中态 class）；`knowledge-tree-crud.spec.ts` e2e 回归（`dir-row-*` testid 不变）。

---

## 8. PR-7 — P2 交互补齐（T13–T15，3–5 人日，按需）

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| PR7-1 | 手柄拖拽多选：按住手柄拖动跨行 = 连续多选（Notion 手势）；现有 Shift+点击保留 | `DocBlockNoteEditor.tsx` | 拖拽选择多块；选区高亮暖灰 |
| PR7-2 | 块菜单重构：手柄菜单 = 复制块链接/复制/删除/多选/拖拽排序入口（对齐 Notion 块菜单结构） | `DocBlockNoteEditor.tsx` | 菜单结构与 preview.html 一致 |
| PR7-3 | ⚠️ **需产品裁决**：标题左侧 emoji 页面图标（悬停可换、随机兜底）。与 v2.1「文档不承载元数据」决策冲突——裁决通过才实施 | `PageHeader.tsx`、frontmatter 存储 | 若裁决不通过：跳过并在 spec 记录 |

---

## 9. 测试与验收（对应 spec §4 验收清单）

| 验收项 | 对应 PR | 验证方式 |
|---|---|---|
| 无 48px 常驻工具栏；crumb 移入标题上方；页面 ⋯ 在标题 hover | PR-1 | 单测 + preview.html §T1 对照截图 |
| 保存状态仅 saving>800ms/error 出现（底部状态栏） | PR-1 | 单测注入 saving/error；e2e `waitForSave` 适配 |
| 标题 32px + 空文档斜体占位；标题-正文间距 16px | PR-2 | `InlineDocTitle.test.tsx` + 截图 |
| 正文 16px/1.5、块距 4px、h1 30/h2 24/h3 20、默认页宽 708px | PR-2 | 计算样式断言 + `docWidth` 单测 |
| 行首 = ＋ + 六点手柄；手柄弹块菜单 | PR-4 | `DocBlockNoteEditor.test.tsx` + e2e multiselect |
| 待办自绘 + 勾选删除线；引用不降灰；表格/选区/菜单 hover 中性灰 | PR-3 | CSS 回归 + e2e checkbox 勾选 |
| 气泡 6 按钮无块类型；斜杠 356px/46px 图标列/40px 项高 | PR-4 | 组件测试 + 截图 |
| 浏览默认列表 40px 行 + hover ⋯；工具栏瘦身；空态大标题 | PR-5 | `DocManagerSort.test.tsx` 适配 + 截图 |
| 侧边栏行 hover ＋/⋯；选中态整行暖灰 | PR-6 | `AppSidebar.test.tsx` + e2e tree-crud |
| 拖拽多选 / 块菜单 / emoji 裁决 | PR-7 | 按裁决推进 |
| **回归门禁（每个 PR）** | 全部 | `yarn tsc` + `yarn test` 全绿 + 受影响 e2e 通过 + preview.html 对照截图（Playwright `--channel=chrome` 流程） |

---

## 10. 风险与对策

| 风险 | 等级 | 对策 | 阶段 |
|---|---|---|---|
| e2e 保存等待点全面失效（`knowledge-save-status` 静默化） | 高 | PR-1 先行排查 `e2e/helpers/knowledge.ts` 及全部 `knowledge-*.spec.ts` 的保存等待调用点，统一改为轮询 `docBody`/`flushSave` 语义 | PR-1 |
| BlockNote checkbox DOM 结构与 `appearance:none` 冲突（框架升级后） | 中 | 纯 CSS 方案不动框架；若冲突，回退为原生 input + 柔和 accent，删除线逻辑单独保留 | PR-3 |
| 侧边菜单重构导致多选 e2e 大面积失败（`kb-multiselect-handle` 迁移） | 中 | PR-4 与 e2e 适配同一 PR 提交；迁移映射表写进 commit message | PR-4 |
| 文档域「纸张」token 泄漏到 chrome | 中 | `--kb-*`/`--doc-*` 仅挂载 `[data-testid=knowledge-doc-paper]` 作用域；review 检查无全局选择器（spec S4/S5） | PR-2/PR-3 |
| 默认视图改 list 破坏既有排序测试/用户习惯 | 低 | `DocManagerSort.test.tsx` 同步适配；视图偏好持久化，老用户可一键切回网格 | PR-5 |
| 排版参数影响导出 HTML 视觉（`htmlExport`） | 低 | 同一变量源自动继承；发布前跑 `htmlExport` 相关测试并人工抽查一份导出文件 | PR-2 |
| emoji 页面图标与 v2.1 元数据决策冲突 | 中 | 启动前产品裁决（spec T14 已标注）；不通过则砍掉，不影响 P0/P1 | PR-7 |

---

## 11. 提交/评审节奏

- 每个 PR 独立合入，标题前缀 `doc-notion-polish/PR-N`；合入门禁：**`yarn tsc` + `yarn test` 全绿 + 受影响 e2e 通过 + 与 `doc-notion-polish-preview.html` 对照截图**
- **评审重点**：
  - PR-1：保存状态静默化的契约（error 不变量）+ e2e 适配面
  - PR-2：排版 token 变更面（prose/导出继承）；32px vs 40px 标题裁决定稿
  - PR-3：CSS 作用域隔离（无全局泄漏）；md round-trip 零改动确认
  - PR-4：侧边菜单重构契约 + testid 迁移映射；代码块主题设置项
  - PR-5：默认视图变更 + 测试适配
  - PR-6：选中态视觉契约
- 每阶段合入后：更新本 plan 勾选状态、spec.md §4 验收清单打勾

---

## 12. 实施记录（随执行更新）

- [x] **PR-1 页面骨架整改（T1/T10）** — commit `1b0fa6d1`：删 48px 工具栏、面包屑移入标题上方小字、⋯ 移入标题 hover（PageHeader 新 props）、保存状态移底部状态栏（saved 静默、saving>800ms/error 显示 + 重试）；T10 契约单测（fake timers）；顺带修复 `KnowledgeDocCanvas.test.tsx` 预存窄类型 bug
- [x] **PR-2 排版参数整改（T2/T3）** — commit `0f857bd4`：body 16px/1.5、块/段距 4px、h1 30/h2 24/h3 20 固定 px、标题 margin 收敛、默认页宽 44.25rem（708px）；`--kb-text/--kb-text-muted/--kb-hover/--kb-row` 纸张 token（亮/暗）；标题 32px（`text-page`）+ 标题-正文 16px；BlockNote 空块占位斜体暖灰
- [x] **PR-3 块级视觉整改（T5/T6/T8）** — commit `ce4f48ef`：待办自绘 16px 方块（勾选删除线，纯 CSS 不动 md 序列化）、引用 currentColor 不降灰、表格行 hover/表头/焦点格中性暖灰、选区中性蓝灰（亮/暗）、气泡选中态暖灰
- [x] **PR-4 编辑器交互整改（T4/T7/T9）** — commit `a664c43f`：侧边菜单 4 按钮 → ＋ + 六点手柄（CSS 点阵）；手柄点击弹块菜单（复制块链接/多选切换/删除/颜色）；气泡精简 B/I/U/S+链接+颜色；代码块文档域默认「纸张」调色板（follow+亮色）；i18n 5 键 ×5 语言；e2e multiselect spec 迁移到菜单入口
- [x] **PR-5 浏览视图整改（T11/T13）** — commit `5ab5d9b2`：默认紧凑列表（40px 行：图标+标题+上次编辑，hover 行尾 ⋯，与右键菜单同一 provider）；网格保留（40px tile + hover ⋯）；工具栏瘦身（↑ 移除、新建主按钮）；空态大标题 + 主 CTA；`DocManagerSort` 适配
- [x] **PR-6 侧边栏目录行整改（T12）** — commit `2f632c8d`：行 hover ＋/⋯（18px）；选中态 = 整行灰 + 中性深灰左条（去橙色）；`NodeRowMenu` 抽为共享组件
- [ ] **PR-7 P2 交互补齐（T13–T15）** — 块菜单结构已随 PR-4 完成；**拖拽多选（T13）与 emoji 页面图标（T14，需 v2.1 裁决）暂缓**，按需启动

**执行备注**：全量单测中 16 个失败（sidecar plugin-install/ACP/workflow + terminals localOpenLoop）为**基线既有失败**（stash 验证与本改动无关）；knowledge 域 73 文件 / 759 测试全绿；`yarn tsc` 通过。e2e（wdio）需桌面端运行，未在本轮执行——`knowledge-multiselect.spec.ts` 已按新入口更新。
