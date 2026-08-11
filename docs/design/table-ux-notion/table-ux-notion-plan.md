# 文档管理 · 表格交互 Notion 化整改 — 执行计划

- 系列：`docs/design/table-ux-notion/`
- 配套：`table-ux-notion-spec.md`（规格，含 §8 工具栏专项）；`table-ux-notion-preview.html`（问题对照 + 全交互原型，已实现：焦点闭环/选区/粘贴/浮层 portal/工具栏三段式/浏览页/侧边栏树/右键菜单/日期控件/统计逐列模式）
- 状态：待评审
- 日期：2026-08-11
- 前置基线：`docs/design/knowledge-table/knowledge-table-*`（表格功能已落地 PR-3..6）；`doc-notion-polish`（文档域 S4/S5 子语言裁决）

---

## 1. 总体策略

1. **纯函数先行**：选区、剪贴板 TSV、视图序号等一律先落 `tableModel.ts` + 单测，组件只做编排（沿用仓库"domain 层纯函数 + 组件测试"纪律）。
2. **P0 交互正确性优先**：焦点/键盘/选区/粘贴/浮层是"怪"的来源，先于视觉；视觉整改（PR-10）最后做，避免返工。
3. **每 PR 独立提交**：门禁 `yarn tsc` + `yarn test` 全绿才可合；e2e 选择器随对应 PR 同步更新（`e2e/specs/knowledge-table.spec.ts`）。
4. **不删语义只改交互**：既有 27 个 TableEditor 组件测试按新交互矩阵更新断言，不删场景。
5. **i18n 五语言同步**（zh-CN/en/ja/ko/zh-TW）：每 PR 引入新 key 时一次补齐，`translation-keys.test.ts` 自动守护。

## 2. PR 依赖图

```
PR-1 domain 纯函数 ──→ PR-3 选区模型 ──→ PR-4 复制粘贴
                          └─────────→ PR-5 行号视图一致性
PR-2 焦点闭环 + 编辑态键盘（独立）
PR-6 浮层 Portal 化（独立）──→ PR-8 工具栏结构（TB1-3）
PR-7 类型化单元格补齐（独立）      └────→ PR-9 筛选 popover / 统计闭环 / 保存静默（TB4-8）
PR-10 呈现与入口（T8-10，依赖 PR-3 / PR-6 的视觉与菜单结构）
```

并行轨道：`PR-2 ∥ PR-6 ∥ PR-7` 可并行；`PR-1 → PR-3 → PR-4 → PR-5` 串行；`PR-6 → PR-8 → PR-9` 串行。P0 = PR-1..9，P1 = PR-10。

---

## 3. PR 明细

### PR-1 domain 纯函数层（地基，0.5-1 天）

**目标**：为选区/剪贴板/视图序提供可单测的纯函数。

**文件**：
- `src/domain/knowledge/tableModel.ts`（新增）＋ `tableModel.test.ts`（新增用例）
- 不改 UI

**任务**：
1. `TableSelection` 类型：`{ anchor: CellPos; focus: CellPos; mode: 'cell'|'row'|'column' }` + `selectionCells(sel, rows, cols)`（视图坐标）与 `selectionDataCells(sel, viewOrder, rows, cols)`（数据坐标，供写入）。
2. `expandSelection(sel, dr, dc, rows, cols)`（Shift+方向键）；`selectAll(rows, cols)`；`clampSelection(sel, rows, cols)`。
3. 剪贴板：`serializeClipboard(sel, viewOrder, table)`（TSV，含 `\t`/`\n` 转义）与 `parseClipboardText(text)` → `{ isTable, rows: string[][] }`（规则：含 `\t` 视为表格；仅 `\n` 无 `\t` 为单格多行文本）；`PasteLimit = { rows: 200, cols: 50 }`。
4. 视图序号：`viewIndexes(table, sort, filters)` 抽出（现 `visibleIndices` 逻辑上移，返回数据行索引数组，供行号/选区/统计共用）。
5. 统计模式：`statsValue(colType, values, mode)` 纯函数（sum/avg/count/off）。

**测试**：矩阵用例——选区矩形/整行/整列/全选/越界钳制；TSV round-trip（含引号、换行、尾空行）；嗅探边界（纯文本段落 vs TSV）；粘贴上限拒绝；statsValue 数字/勾选/文本。

**验收**：spec §5.1（选区纯函数先测）就绪；`yarn test` 新增用例全绿。

---

### PR-2 焦点闭环 + 编辑态键盘（T1/T2，1-1.5 天）

**目标**：修掉"键盘时灵时不灵"（K1-K5）。

**文件**：`TableEditor.tsx`、`TableEditor.test.tsx`、`src/i18n/*.ts`（数字校验/日期相关提示）

**任务**：
1. T1 `gridRef` + `focusGrid()`：单元格点击、`commitEdit`、Tab 提交、Esc 取消后强制焦点回 `<table>`；`focus-visible` 焦点环（蓝灰，对齐选区色）。
2. T2 编辑控件按列类型：
   - 文本 → `<textarea rows=1>`：Shift+Enter 换行、Enter 提交并**下移一格**（末可见行自动加行）、行高随内容自适应（提交后 `line-clamp-2` 显示）；Tab/Shift+Tab 提交并换位（**末列换到下一行首列**，末行末列加行）。
   - 数字 → 提交校验（非数字标红 + 状态栏提示，不落盘不移动）。
   - 日期 → `<input type=date>`（非法值回退文本编辑）。
   - 勾选/单选 → 交 PR-7，本 PR 保持现状。
3. Esc 分级：编辑态取消 → 选中态；选中态再 Esc 清选区（并入 PR-3 的选区态）。
4. i18n：`knowledge.table.edit.numberOnly` 等新 key 五语言补齐。

**测试**：键盘矩阵组件测试（Tab 末列换行/Enter 提交下移+末行加行/Shift+Enter 换行/Esc 取消/焦点断言 `document.activeElement`）；`knowledge-table.spec.ts` 补编辑后连续键盘用例。

**验收**：spec §5.1/§5.2。

---

### PR-3 选区模型（T4，1.5-2 天）

**目标**：⌘A / Shift 扩展 / 整行整列选择 / 批量清空（K6/K7、R1 的一半）。

**文件**：`TableEditor.tsx`、`TableEditor.test.tsx`、`src/domain/knowledge/tableModel.ts`（已就绪）

**任务**：
1. 状态升级：`sel` → `TableSelection`（anchor/focus/mode）；`moveSel` 支持 extend；单击=锚定、Shift+点击=扩展、Shift+方向键=扩展、⌘A=全选。
2. 单击行号=整行（再 Shift+点击=连续多行）；单击列头=**选中整列**（列菜单改为 hover ⋯/右键进入，见 PR-8/PR-10）；行号/列头选中时同步高亮。
3. 选区渲染：矩形内单元格**整格底色**（蓝灰 `--tbl-sel`），anchor 格加深 + 1.5px 描边；替换现有单格描边。
4. Delete/Backspace/直接输入作用于全部选中格（输入字符=替换首格、其余清空——Notion 语义）。
5. 勾选列：单击=先选中该格（键盘可达），空格/再单击=切换（与 Notion 对齐，替代现"点击即切换"）。

**测试**：选区矩阵（单格/多格/整行/整列/全选/Shift 扩展/钳制/批量清空）；既有单格交互用例迁移到新选择模型。

**验收**：spec §5.4；预览场景二选区行为一致。

---

### PR-4 复制 / 粘贴（T3，1.5 天）

**目标**：跨应用断桥（K5/K6 的数据面）。

**文件**：`TableEditor.tsx`、`TableEditor.test.tsx`、`tableModel.ts`（已就绪）、`knowledge-table.spec.ts`（e2e 粘贴链路）

**任务**：
1. ⌘C：选区（单格/矩形/整行/整列）→ `serializeClipboard` → `navigator.clipboard.writeText`（降级 textarea+execCommand）。
2. ⌘V：`parseClipboardText` 嗅探 → 单格=向右下展开粘贴、多格选区且尺寸匹配=逐格填充；超界自动扩列/扩行（上限 200×50，超限 toast 拒绝）；一步历史；防抖落盘。
3. 编辑态内 ⌘C/⌘V 走原生输入框行为（不拦截）。
4. 右键菜单"复制/粘贴"入口随 PR-10 提供，本 PR 仅键盘链路。
5. 粘贴后选区=粘贴区域（可见反馈）。

**测试**：组件测试 mock clipboard（3×4 TSV 扩表、2×2 格内复制、纯文本单格、超限拒绝）；e2e 用真实 clipboard 权限位（Tauri webview 允许时）或注入 mock。

**验收**：spec §5.3；预览"模拟粘贴"行为一致。

---

### PR-5 行号视图一致性 + 视图态拖拽禁令（T5，1 天）

**目标**：排序/筛选下"行号乱序、加行消失、拖拽错乱"（R3/R4/R5）。

**文件**：`TableEditor.tsx`、`TableEditor.test.tsx`、`tableModel.ts`（`viewIndexes` 已就绪）

**任务**：
1. 行号列显示**视图序号**（`viewIndexes` 中的位置，排序/筛选后仍 1..n 连续）。
2. 筛选态末可见行 Enter/Tab 追加新行：数据尾部插入；新行被筛选隐藏 → 状态栏闪现"已添加行（可能被筛选隐藏）"；判断基于**可见行数**而非数据行数。
3. 排序/筛选态：行拖拽手柄禁用（置灰 + title 提示），行菜单保留；列拖拽在排序态同样禁用。
4. 状态栏：显示「可见 x/y 行」+ 选区信息（已选 n 格，PR-3 后）。

**测试**：降序后行号 1..n；筛选 3 行末行 Enter 新增+提示；视图态拖拽 disabled 断言。

**验收**：spec §5.5；预览 R3/R5 行为一致。

---

### PR-6 浮层 Portal 化（T6，1.5 天）

**目标**：列菜单/选项弹层/行菜单不再被滚动容器裁剪（P1）。

**文件**：`TableEditor.tsx`（新增 `TableMenuPortal` 小组件或 util）、`TableEditor.test.tsx`、`knowledge-table.spec.ts`（滚动后菜单可见性 e2e）

**任务**：
1. 三处浮层统一 `createPortal` 到 body 级 overlay：定位=触发元素 `getBoundingClientRect()`；视口右/下边缘自动向左/上翻转；`max-height: min(60vh, 420px)` 内部滚动。
2. 打开期间：Esc 关闭、点击外部关闭（透明 scrim）、网格滚动容器 scroll 即关闭（简单方案，spec T6）。
3. 复用：筛选 popover（PR-9）、右键菜单（PR-10）同一套机制。
4. testid 全部保留在浮层内（`table-col-menu`/`table-select-popup`/`table-row-menu`）。

**测试**：jsdom 断言 portal 挂载点；e2e：横向滚动到最右列、纵向到底部，菜单全项可见（对比修复前被裁剪）。

**验收**：spec §5.6；预览浮层行为一致。

---

### PR-7 类型化单元格补齐（T7，1 天）

**目标**：勾选先选中、单选彩色 chip、类型化呈现（P2/P3 的一半）。

**文件**：`TableEditor.tsx`、`TableEditor.test.tsx`、`knowledge-doc-typography.css`（chip 色板 token，对齐 preview `--chip0..5`）

**任务**：
1. 勾选列：选中态与切换分离（配合 PR-3 完成）。
2. 单选列：渲染**彩色 chip**（色板按 options 索引取，`--chip0..5`）；chip 悬停显示小箭头；选项弹层 portal 化（PR-6 后）。
3. 数字列：右对齐 + `tabular-nums`（已有）+ 空值占位。
4. 日期列：非空渲染 `YYYY-MM-DD` 等宽；编辑控件已由 PR-2 提供。
5. i18n：chip 无新 key；`selectNewOption` 已有。

**测试**：chip 颜色索引断言；勾选/单选键盘可达链路。

**验收**：spec §5.8（类型化呈现部分）；预览 chip 一致。

---

### PR-8 工具栏结构（TB1/TB2/TB3，1.5 天）

**目标**：三段式布局 + 文字按钮 + 实底激活（O1/O2/O3/O8/O11 + V1/V2/V3）。

**文件**：`TableEditor.tsx`（标题栏区重排）、`TableEditor.test.tsx`、`src/i18n/*.ts`、`knowledge-table.spec.ts`（testid 更新）

**任务**：
1. TB1 布局：面包屑小字行（替代"← 我的空间"按钮，`backToBrowse` 改挂面包屑）→ 标题行（双击改名已有，hover 出现页面 ⋯）→ 工具栏行（36px）。
2. TB2 文字按钮：筛选/统计/导出 = 图标+文案（`h-7` 28px、`px-2.5`、圆角 6px）；撤销/重做图标按钮放大到 28px 命中区；冻结首行移入 ⋯ 菜单（TB3 一并做 ⋯ 菜单：冻结表头/重置视图）。
3. TB3 激活态实底：`aria-pressed` 激活 = `bg-btn-primary text-on-btn-primary`；视图状态（排序/筛选）统一为右侧 chip 组（同一样式，筛选 chip 带条件数「筛选 · 2」）。
4. 移除标题栏「6行·7列」pill（行数列数归底部状态栏）。
5. i18n：`toolbar.more`、`toolbar.resetView`、`columnMenu.statsShow` 复用等新 key 补齐。

**测试**：布局断言（面包屑存在/返回按钮移除）；激活态样式断言；chip 组可见性。

**验收**：spec §8.3-10（结构/文字/实底/状态区）；与预览场景二工具栏一致。

---

### PR-9 筛选 Popover + 统计闭环 + 保存静默 + 导出提示（TB4-TB8，1.5 天）

**目标**：筛选浮层化、统计入口闭环、保存静默、导出语义（O4/O5/O6/O7/O10/O12 + V4/V6）。

**文件**：`TableEditor.tsx`、`TableEditor.test.tsx`、`src/i18n/*.ts`、`knowledge-table.spec.ts`

**任务**：
1. TB4 筛选：工具栏按钮 → portal popover（复用 PR-6）：条件行（列选择器+操作符+值，行式布局）+ 「添加条件」「清除全部」+ ×；Esc/外点/滚动关闭；移除嵌入式 `table-filter-panel`（testid 迁移）。
2. TB5 统计闭环：列菜单"统计"区块**不再依赖 statsOn**（常驻显示，逐列 sum/avg/count/off）；Σ 激活时统计行渲染（PR-1 `statsValue`）；配置模式自动开启 Σ。
3. TB6 排序/筛选不进撤销栈：移除 `pushHistoryStep`（排序）；`applySnapshot` 保留选区（越界钳制）。
4. TB7 保存静默：saved 静默（仅 saving>800ms/error 显示，error 必显+重试）；对齐文档页。
5. TB8 导出：筛选激活时按钮 tooltip + toast 明示"导出全量数据（不含筛选）"。
6. i18n：`filter` 现有 key 复用 + `toolbar.exportFullNote` 等新 key。

**测试**：popover 开合/条件增删/实时生效/关闭三通道；排序后 ⌘Z 撤销内容而非排序；saved 静默断言（模拟 store 状态流转）。

**验收**：spec §8.3-10（popover/统计/撤销/静默/导出）。

---

### PR-10 呈现与入口（T8/T9/T10，2-3 天）

**目标**：添加行常驻、视觉 Notion 化、菜单收敛（R2/P2 收尾）。

**文件**：`TableEditor.tsx`、`TableEditor.test.tsx`、`knowledge-doc-typography.css`（表格域 token）、`src/i18n/*.ts`、`knowledge-table.spec.ts`

**任务**：
1. T8 添加行：底部常驻「＋ 添加行」行（点击追加并聚焦首格，testid `table-add-row`）；表头角落 ＋ 加列（已有，保持对称）；空表引导沿用。
2. T9 视觉：行高 34px、表头 32px 强底边；行 hover 暖灰（`--doc-row`）；选中蓝灰整格底（PR-3 已做，补行列头/行号同步淡色）；列头 hover ⋯ + 暖灰；行号列 44px + hover ⋮⋮ 手柄；工具栏 hover 中性灰（PR-8 已做）；表格内无橙色 tint。
3. T10 菜单收敛：重命名改**双击列名内联**（已实现于预览，落地 React）；列菜单分组：类型/排序/插入删除/统计（PR-9）；行菜单保持 4 项。
4. 右键菜单（预览已验证）：单元格/行号/列头上下文（复制/粘贴/清空/插入行/删除行/插入列/删除列），补落地。
5. i18n：右键菜单 copy/paste/clear 等新 key。

**测试**：添加行可见性/点击即输入；视觉用组件快照或样式断言（行高/hover 色）；右键菜单全操作链路；e2e 全量回归。

**验收**：spec §5.7/§5.8/§8.3；与预览场景二视觉逐项比对。

---

## 4. 里程碑与提交节奏

| 里程碑 | 内容 | 依赖 | 预估 |
|---|---|---|---|
| M1 地基 | PR-1 | — | 0.5-1 天 |
| M2 键盘不再断 | PR-2（可并行 PR-6/PR-7） | — | 1-1.5 天 |
| M3 选区与剪贴板 | PR-3 → PR-4 → PR-5 | PR-1 | 4-4.5 天 |
| M4 浮层与工具栏 | PR-6 → PR-8 → PR-9 | PR-6 | 4.5 天 |
| M5 视觉对齐（P1） | PR-10 | PR-3/PR-6 | 2-3 天 |
| **P0 完成** | M1-M4（PR-1..9） | — | ~11-12 人日 |
| **P1 完成** | +PR-10 | — | ~14 人日 |

提交节奏：每个 PR 一个 commit（或 PR 内 2-3 个逻辑 commit），commit message 前缀 `feat(knowledge):`（交互）或 `refactor(knowledge):`（纯函数/结构）；每次提交前跑 `yarn tsc` + `yarn test`（knowledge 相关）；e2e 改动随 PR 同提交。

## 5. 回归门禁清单（每次提交）

1. `yarn tsc` 零错误；
2. `yarn test`：`tableModel.test.ts`（新增）、`TableEditor.test.tsx`（27 用例迁移+新增）、`translation-keys.test.ts`（五语言 key 完整）；
3. `yarn check:store-deps`（若触碰 store 读写路径）；
4. e2e `knowledge-table.spec.ts` 全绿（选择器随 PR 更新）；
5. 预览页人工对照：PR 完成后在 `table-ux-notion-preview.html` 场景二走一遍对应交互（验收锚点）。

## 6. 风险总表

| 风险 | 等级 | 对策 |
|---|---|---|
| 选区模型重构触碰既有 27 个测试用例 | 中 | PR-1 纯函数先行；组件测试增量迁移，语义不删（§1.4） |
| Portal 浮层在 Tauri webview 定位漂移 | 中 | 打开时快照 rect + 滚动关闭；e2e 覆盖横向滚动后可见性（PR-6） |
| 粘贴嗅探误判 | 低 | 规则先行（含 `\t` 才视为表格），单测覆盖边界（PR-1） |
| 文本列 textarea 换行影响大表性能 | 低 | 行高自适应仅编辑态；提交后 `line-clamp-2`（PR-2） |
| 工具栏 testid 变更破坏 e2e | 低 | 保留全部既有 testid；新增 `table-add-row`/`table-col-arrow` 等（PR-8/PR-10） |
| 视觉改动与预览原型不一致 | 低 | 以预览为验收锚点，PR-10 逐项比对 |
| PR 并行轨道冲突（PR-2/6/7 同改 TableEditor.tsx） | 中 | 并行限 2 条轨道；冲突面集中在组件文件时改为串行（P0 总时长 +1-2 天可接受） |
