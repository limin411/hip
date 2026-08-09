# 文档管理 × 操作交互与视觉体验第二弹 · 执行计划（Plan）

> 依据：`docs/design/knowledge/polish/doc-ux-polish-2-spec.md`（V1.0）+ 高保真预览 `docs/design/knowledge/polish/doc-ux-polish-2-preview.html`（视觉基准，浏览器打开对照）
> 目标分支：`feature/doc-ux-polish-2`（从 trunk 切出，按 PR 拆分合入）
> 规模估算：**P0 2–3 人日 + P1 2.5–3.5 人日 + P2 0.5–1 人日 ≈ 5–7.5 人日**（单人 1–2 周）
> 范围护栏（spec §5 非目标，本计划不包含）：AI 接入、嵌套层级、数据库/元数据、导入导出、新依赖；**侧边栏拖拽排序与移动、页面 emoji 图标（v1.1 裁剪）**。

---

## 1. 计划总览

| PR | 阶段 | 主题 | spec 项 | 依赖 | 估算 | 状态 |
|---|---|---|---|---|---|---|
| **PR-1** | P0 | 斜杠菜单尺寸达标（V3 T8 收尾） | X1 | 无 | 0.5–1 人日 | ⬜ |
| **PR-2** | P0 | 手柄拖拽连续多选 + 多选工具条补批量删除 | X2 | 无 | 1.5–2 人日 | ⬜ |
| **PR-3** | P1 | 浏览视图拖拽排序/移动（含面包屑 drop 目标） | X3 | 无 | 1.5–2 人日 | ⬜ |
| **PR-4** | P1 | 浏览批量操作（Shift/⌘ 多选 → 批量删除/移动） | X4 | PR-3（同一 `DocManagerBrowse.tsx` 域） | 1–1.5 人日 | ⬜ |
| **PR-5** | P2 | 暗色与微视觉一致性抽查 | X5 | 无 | 0.5–1 人日 | ⬜ |

> **v1.1 范围裁剪**：不做「侧边栏拖拽排序与移动」「页面 emoji 图标」（见 spec §5 非目标）。

**并行策略**：PR-1 / PR-2 / PR-3 互相独立可并行（文件域不重叠：`BlockNoteHipSlashMenu.tsx` / `DocBlockNoteEditor.tsx` / `DocManagerBrowse.tsx`）；PR-4 在 PR-3 后启动（同一 `DocManagerBrowse.tsx` 域，且批量条与拖拽行结构互扰）。PR-5 任意时间。

---

## 2. PR-1 — 斜杠菜单尺寸达标（X1，0.5–1 人日）

**目标**：V3 遗留的 T8 尺寸项收尾（V3 遗留项中唯一未完成项）。改 `BlockNoteHipSlashMenu.tsx` + `knowledge-blocknote.css` 单域。

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| PR1-1 | 斜杠菜单：宽 18rem → 22.25rem（356px）；图标列固定 46px（图标居中 30px 圆角块）；项高 40px；选中项暖灰底 + 右侧箭头淡显；分组标题 padding 微调 | `BlockNoteHipSlashMenu.tsx`、`knowledge-blocknote.css` | 与 preview.html §X1 一致；键盘导航（上下/Enter/Escape）回归 |

**测试**：`BlockNoteHipSlashMenu.test.tsx`（新尺寸选择器）；`knowledge-live*.spec.ts` 斜杠相关用例回归。

---

## 3. PR-2 — 手柄拖拽连续多选 + 批量删除（X2，1.5–2 人日）

**目标**：Notion 核心手势落地；多选工具条补批量删除。改 `DocBlockNoteEditor.tsx` + `knowledge-blocknote.css` 单域。

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| PR2-1 | `kb-drag-handle` 加 `mousedown` 拖拽多选：位移 >4px 判定进入拖拽（否则保持点击块菜单语义）；跨行拖动 = 连续多选，选区暖灰高亮（复用 `kb-multiselect`）；拖影 = 半透明行；mouseup 结束；Shift+点击与块菜单多选入口保留 | `DocBlockNoteEditor.tsx`、`knowledge-blocknote.css` | 拖拽跨 3 行选中 3 块；拖影跟随；松开结束；点击（无位移）仍弹块菜单 |
| PR2-2 | 多选工具条（`kb-multiselect-bar`）补「批量删除」按钮：复用现有删除确认流程；删除后清空选区 | `DocBlockNoteEditor.tsx`、i18n 5 语言 | 工具条 = 计数 + 转段落/转标题 + 删除；删除确认后块消失 |

**测试**：`DocBlockNoteEditor.test.tsx` 扩展（拖拽多选逻辑、位移阈值、批量删除）；`knowledge-multiselect.spec.ts` 适配（拖拽手势用例 + 既有入口回归）。

---

## 4. PR-3 — 浏览视图拖拽排序与移动（X3，1.5–2 人日）

**目标**：浏览视图结构操作。**数据层零改动**（`moveNodePure`/`moveNode(id, parentId, toIndex?)` 已支持全部语义）。改 `DocManagerBrowse.tsx` 单域（v1.1 裁剪：不做侧边栏拖拽）。

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| PR3-1 | 浏览列表行/网格 tile `draggable`（编辑态/`data-no-drag` 子树除外）：`onDragStart` 记录节点 + 置 `data-dragging`；`onDragOver` 计算目标位置（行上半/下半/文件夹行内）显示 2px 指示线（`--border-strong`）或文件夹行暖灰高亮；`onDrop` → `moveNode(id, parentId, toIndex)` | `DocManagerBrowse.tsx` | 同层排序持久化；拖入文件夹行 = 移入末尾；刷新保持 |
| PR3-2 | 面包屑行（`browse-crumb-*`）作为 drop 目标 = 移入该祖先文件夹 | `DocManagerBrowse.tsx` | 拖到 crumb 移入祖先，持久化 |
| PR3-3 | 全局文件拖放兼容：窗口级 drop 处理器检测 `data-dragging` 后忽略（内部拖拽不触发资产导入）；行内交互元素保持 `data-no-drag` | `DocManagerBrowse.tsx`、相关 drop 入口 | 拖入外部文件仍导入资产；内部拖拽不误触发 |
| PR3-4 | e2e 适配：拖拽断言用 Playwright dragTo（或 mousedown/move/up 序列）；`knowledge-phase1.spec.ts` 扩展排序用例 | `e2e/helpers/knowledge.ts`、`e2e/*knowledge*.spec.ts` | 排序/移入 e2e 绿 |

**测试**：`tree.test.ts` 扩展（toIndex 边界：拖到行首/行尾/空层）；`DocManagerSort.test.tsx`（drop 后顺序）。

---

## 5. PR-4 — 浏览批量操作（X4，1–1.5 人日）

**目标**：批量删除/移动。改 `DocManagerBrowse.tsx` + `knowledgeStore.ts`（仅薄封装）。**依赖 PR-3**。

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| PR4-1 | 列表行多选：Shift 连选 / ⌘ 点选；选中态 = 行左侧复选框 + 整行暖灰；非批量态默认无复选框（hover 行尾 ⋯ 不变） | `DocManagerBrowse.tsx` | 单选打开文档不受影响；Shift/⌘ 行为正确 |
| PR4-2 | 底部浮动批量条：N 项计数 + 「删除」（确认弹层，复用现有确认组件）/「移动」（文件夹选择弹层，复用目录结构）；批量删除 = 循环 `removeNodeSubtree`，批量移动 = 循环 `moveNode`（同目标 parent 一次调用 + 依次 toIndex，或逐节点调用） | `DocManagerBrowse.tsx`、`knowledgeStore.ts`、i18n 5 语言 | 批量删除 3 篇 + 确认；批量移动跨目录；索引/搜索缓存同步（复用现有清理路径） |
| PR4-3 | 退出批量态：Esc / 点击内容空白 / 全取消 | `DocManagerBrowse.tsx` | 三路径均清空选区与批量条 |

**测试**：`DocManagerSort.test.tsx` 扩展（多选状态、批量条渲染、Esc 退出）；新增批量删除/移动 store 单测（mock IPC）；e2e 适配。

---

## 6. PR-5 — 暗色与微视觉一致性（X5，0.5–1 人日）

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| PR5-1 | 暗色抽查：滚动条（细/低对比）、选区中性蓝灰、`--kb-*` 对比度、代码块纸面调色板、多选高亮；发现问题按 V3 纪律修（复用 `--kb-*`/`--state-*`，不新增 token 域） | `knowledge-blocknote.css`、`knowledge-doc-typography.css` | 暗色下无对比度 <4.5:1 的正文文本；与 preview.html §X5 一致 |
| PR5-2 | 标题 hover ⋯ 入口延迟 ≤100ms（防误触）；空态/占位排版与 V3 空态一致 | `KnowledgeWorkspace.tsx`、`PageHeader.tsx` | hover 即显，无 300ms 级延迟 |

**测试**：相关组件单测回归；人工暗色对照截图（Playwright `--channel=chrome`）。

---

## 7. 测试与验收（对应 spec §4 验收清单）

| 验收项 | 对应 PR | 验证方式 |
|---|---|---|
| 斜杠菜单 356px/46px 图标列/40px 项高/选中暖灰 + 箭头 | PR-1 | `BlockNoteHipSlashMenu.test.tsx` + preview.html §X1 对照 |
| 手柄拖拽连续多选；拖影；Shift+点击保留 | PR-2 | `DocBlockNoteEditor.test.tsx` + `knowledge-multiselect.spec.ts` |
| 多选条批量删除，计数正确 | PR-2 | 组件测试 + e2e |
| 浏览拖拽排序与移入持久化；面包屑 drop 目标 | PR-3 | `tree.test.ts` 边界 + `DocManagerSort.test.tsx` + e2e dragTo |
| 内部拖拽不触发资产导入 | PR-3 | 手动 + drop 处理器单测 |
| 批量删除（确认）/移动；Esc 退出 | PR-4 | `DocManagerSort.test.tsx` + store 单测 |
| 暗色抽查无问题；hover 时机 ≤100ms | PR-5 | 人工暗色对照 + 组件测试 |
| **回归门禁（每个 PR）** | 全部 | `yarn tsc` + `yarn test` 全绿 + 受影响 e2e 通过 + preview.html 对照截图 |

---

## 8. 风险与对策

| 风险 | 等级 | 对策 | 阶段 |
|---|---|---|---|
| native DnD 与全局文件拖放冲突 | 高 | `data-dragging` 标记 + 既有 `data-no-drag` 模式；drop 处理器按标记分流 | PR-3 |
| 手柄 mousedown 与点击菜单/Shift+点击冲突 | 中 | 位移 >4px 阈值；PR-2 与 e2e 适配同 PR 提交 | PR-2 |
| 拖拽排序与保存并发 | 低 | 复用现有 `moveNode`（含持久化与回滚），不新增写入通道 | PR-3 |
| 批量删除误操作 | 低 | 确认弹层强制 + Esc 取消 | PR-4 |
| 暗色 token 泄漏到 chrome | 低 | 沿用 V3 作用域纪律，全部复用现有变量 | PR-5 |
| 基线既有失败干扰（sidecar plugin-install/ACP/workflow + terminals） | 低 | 与 V3 同一基线（stash 验证），knowledge 域全绿即视为通过 | 全部 |

---

## 9. 提交/评审节奏

- 每个 PR 独立合入，标题前缀 `doc-ux-polish-2/PR-N`；合入门禁：**`yarn tsc` + `yarn test` 全绿 + 受影响 e2e 通过 + 与 `doc-ux-polish-2-preview.html` 对照截图**
- **评审重点**：
  - PR-1：斜杠菜单尺寸与键盘导航回归
  - PR-2：拖拽阈值与点击语义分离；批量删除确认流程
  - PR-3：drop 位置计算（toIndex 边界）与 `data-dragging` 分流；数据层零改动确认
  - PR-4：批量操作与索引/搜索缓存同步；批量移动的 toIndex 语义
  - PR-5：暗色改动无全局选择器泄漏
- 每阶段合入后：更新本 plan 勾选状态、spec.md §4 验收清单打勾

---

## 10. 实施记录（随执行更新）

- [ ] **PR-1 斜杠菜单尺寸（X1）** — 待启动
- [ ] **PR-2 手柄拖拽多选（X2）** — 待启动
- [ ] **PR-3 浏览拖拽排序与移动（X3）** — 待启动
- [ ] **PR-4 批量操作（X4）** — 待启动（依赖 PR-3）
- [ ] **PR-5 暗色与微视觉（X5）** — 待启动
