# 表格 × 右侧面板 关联性整改 执行计划

- 系列：`docs/design/table-right-panel/`
- 配套：`docs/design/table-right-panel/table-right-panel-spec.md`（根因 K1-K5 + 改进 T1-T8 + 验收 8 项）；`table-right-panel-preview.html`（问题对照 + rail 联动原型，已通过 30/30 CDP 验证）
- 状态：执行中
- 日期：2026-08-11
- 前置：`table-ux-notion` 系列已落地（表格编辑器交互整改完成，本系列只动 rail 侧 + 一个跳转请求通道）

---

## 1. 策略

1. **最小正确性先行**：PR-1 先修"表格被当文档渲染"的判定/数据源错位（用户感知最强的 bug），信息面板随后补上——不出现中间态"表格下无大纲=信息面板空白"的长时间悬挂。
2. **rail 只发请求、编辑器执行定位**：列定位的坐标知识（sticky 行号列、列宽、scrollLeft）都在 `TableEditor` 内部，rail 侧只暴露 `colId`，由 `TableEditor` 订阅后滚动 + flash——避免坐标逻辑跨组件复制。
3. **数据同源**：信息面板直接订阅 `tableDraft`（与编辑器同一草稿），保存/撤销/编辑即时同步，不新增数据接口。
4. **P0 / P1 分层**：P0 = 判定修复 + 信息面板 + 定位联动 + 反链 UI 就绪；P1 = 反链数据索引验证（Rust 侧）+ 滚动 scrollspy 反向。
5. **门禁**：每 PR `yarn tsc` + `npx vitest run`（相关文件 + 全量回归）+ i18n `translation-keys.test.ts` 五语言一致 + e2e 选择器同步 + 与 preview 场景 2 人工对照。

## 2. 依赖图

```
PR-1 类型感知/防护/头部联动 ──▶ PR-2 表格信息面板 ──▶ PR-3 列定位联动 ──▶ PR-5(P1) 滚动 scrollspy
        │                                                        ▲
        └────────────── PR-4 反链语义（P0 UI ∥）──────────────────┘
```

- 串行：PR-1 → PR-2 → PR-3（信息面板需要先有类型分支；定位需要面板的列清单）
- 并行：PR-4 可在 PR-1 后随时插队（只动 BacklinkPanel 语义验证 + 文案）
- PR-5（P1）依赖 PR-3 的滚动通道

## 3. PR 明细

### PR-1 类型感知 + 头部联动 + 跳转防护 + 字数收敛（T1/T4/T5/T6，0.5 天）

**目标**：表格打开时 rail 不再渲染文档语义（大纲/字数/跳转），画板行为不变。

文件级任务：
- `src/components/knowledge/KnowledgeOutlinePanel.tsx`：
  - 新增 `isTable = activeDocId != null && activeNode?.kind === 'table' && activeDocId.startsWith('tbl_')`（对齐 `KnowledgeWorkspace.tsx` L287 同式）
  - `isDoc` 判定排除 table；大纲区块、字数统计仅 `isDoc` 渲染
  - 头部：`isTable` 时标题「表格信息」、刷新按钮显示；`isDoc` 不变；board/noDoc 隐藏刷新
  - `isTable` 分支内容：临时占位（`knowledge.tableInfo.empty` 文案），PR-2 替换为信息面板
  - 内容防抖 effect 的 `isDoc` 守卫同步（表格下 content 不更新）
- `src/components/knowledge/KnowledgeWorkspace.tsx`：`pendingOutlineJump` effect 对 `leaf?.kind === 'table'` 与 board 同分支提前 `clear()`（L194-229）
- `src/i18n/{zh-CN,zh-TW,en,ja,ko}.ts`：`knowledge.tableInfo.title/rowsCols/column/width/empty` 五语言（类型名复用 `knowledge.table.types.*` 不新增）

测试：
- `KnowledgeOutlinePanel.test.tsx` +5：表格节点 → 标题「表格信息」+ 无大纲区块 + 无字数 + 刷新按钮在；board → 占位不变；doc → 全量回归（现有 7 用例保持绿）
- `KnowledgeWorkspace` 相关（如存在 outline jump 测试）：表格下跳转请求被清空

验收：spec §5 项 1/6/7/8。

### PR-2 表格信息面板 TableInfoPanel（T2 核心，1 天）

**目标**：rail 展示表格结构信息，与编辑器同一草稿实时同步。

文件级任务：
- 新建 `src/components/knowledge/table/TableInfoPanel.tsx`：
  - 订阅 `useKnowledgeStore((s) => s.tableDraft)`；`csvToTable(draft.csv, draft.meta)`（`tableModel` 已有）→ cols/rows
  - 统计：`rows × cols`（行数 = rows.length；空表格 = 0 行仍显示结构）
  - 类型分布：按 `col.type` 计数 chips（本地色板副本，对齐 `CHIP_STYLES` 6 组 rgba 值，不跨文件导出）
  - 列清单：每行 = 类型色块 + 列名 + `{{width}}px`；`data-testid="table-info-col-{i}"`、`data-col-id`；点击 → `useKnowledgeStore.getState().requestTableColumnJump(colId)`（PR-3 接消费方）
  - 空态：`tableInfo.empty` 文案
  - 防抖 200ms（对齐 `OUTLINE_BODY_DEBOUNCE_MS`）避免 keystroke 级重渲染；全 `useMemo` 派生
- `KnowledgeOutlinePanel.tsx`：`isTable` 分支渲染 `<TableInfoPanel />` + `<BacklinkPanel />`（替换 PR-1 占位）
- 样式：rail 内联类（对齐 preview `.ti-*` 视觉），不引入全局样式文件

测试（`TableInfoPanel.test.tsx` 新建）：
- 统计行数×列数正确；类型分布 chips 计数正确
- 列清单渲染 6 列（名称/宽度/色块）
- 空表格（csv 空）→ empty 文案
- 草稿更新（addRow 后 csv 变化）→ 统计跟随（防抖内 advanceTimers）
- 点击列 → `requestTableColumnJump` 被调用（store spy）

验收：spec §5 项 2/3/8。

### PR-3 列定位联动（T2 定位 + T8 通道，1 天）

**目标**：点击 rail 列清单 → 表格滚动到该列 + 列头闪烁 + 清单项高亮。

文件级任务：
- `src/store/knowledgeStore.ts`：新增 `pendingTableColumnJump: { colId: string } | null` + `requestTableColumnJump(colId)` / `clearTableColumnJump()`（最小面，与 pendingOutlineJump 同构）
- `src/components/knowledge/table/TableEditor.tsx`：
  - 订阅 `pendingTableColumnJump`；effect：找到列 index → `wrapRef.scrollLeft = 44 + Σ(前序列宽) - 16`（对齐 preview `colOffsetX` 算法）→ `setFlashCol(ci)` → 列头加 `table-col-flash` 类 1.2s 后移除（CSS 动画类，`@keyframes` 淡出）→ `clearTableColumnJump()`
  - 列头 `data-testid` 已存在（`th[data-col]`）；flash 类加在 th 上
- `TableInfoPanel.tsx`：本地高亮态——点击后该项短暂高亮 0.6s（class 切换）
- e2e `knowledge-table.spec.ts`：打开表格 → rail 标题断言；点击列清单 → `table-col-flash` 出现（选择器随本 PR 同步）

测试：
- store：request/clear 状态流转
- TableEditor：模拟 jump → wrapRef.scrollLeft 变化 + flash 类出现与清除（fake timers）
- TableInfoPanel：点击后高亮类

验收：spec §5 项 4。

### PR-4 反链语义确认（T3 P0 部分，0.5 天，可与 PR-2 并行）

**目标**：表格下反链区块语义成立（其他文档引用本表格标题），刷新按钮可用。

文件级任务：
- `KnowledgeOutlinePanel.tsx` 已含 `<BacklinkPanel />`（PR-2 带入）——本 PR 验证 + 补齐：
  - 表格下刷新按钮点击 → `refreshLinkPanel()` 正常调用（复用现有通道）
  - 空态文案核对：`emptyInbound` 通用文案可接受（P0 不加新 key）
- 数据层跟随项（**P1 独立验证**，本 PR 只记录）：`knowledgeLinkIndexBacklinks` 对表格叶子（无正文、仅标题）是否命中其他文档的 `[[表格标题]]`；不命中则 Rust 侧补充标题匹配——验证脚本/结论写入本系列 README 或注释
- 文档：spec §3 T3 标注 P1 交付条件

测试：
- KnowledgeOutlinePanel：表格分支 + 反链区块存在 + 刷新按钮点击触发 `refreshLinkPanel`（现有 spy 模式）

验收：spec §5 项 5。

### PR-5（P1）滚动 scrollspy 反向（T8，1 天）

**目标**：表格水平滚动时 rail 列清单高亮当前可见第一列（对齐 preview 已实现的行为）。

文件级任务：
- `TableEditor.tsx`：wrapRef `onScroll`（已有）→ 节流（rAF）→ 计算当前可见列 index → `useKnowledgeStore.setState({ visibleTableCol: ci })`（或自定义事件）
- `TableInfoPanel.tsx`：订阅可见列 → 清单项 `.on` 高亮（滚动超过列宽一半判定，对齐 preview）
- 注意：不把高频 scroll 状态放全局 store 引发全树重渲染——优先局部事件（`CustomEvent` on wrapRef 或 store + 选择器订阅），plan 阶段倾向 store 最小字段 + 订阅者仅 TableInfoPanel

测试：模拟滚动 → 可见列高亮切换；滚动停止无泄漏

验收：spec §5 项 4（滚动侧）。

## 4. 里程碑

| 里程碑 | 内容 | 估算 |
|---|---|---|
| M1 | PR-1 + PR-2：表格不再被当文档渲染；rail 显示表格信息面板（统计/分布/列清单） | 1.5 天 |
| M2 | PR-3：列清单 ↔ 表格定位联动（滚动 + 双端 flash） | 1 天 |
| M3 | PR-4：反链语义确认 + 刷新通道 | 0.5 天 |
| M4（P1） | PR-5：滚动 scrollspy 反向 | 1 天 |

P0（M1-M3）≈ 3 人日；P1（M4）≈ 1 人日。每 PR 独立提交，提交信息含 `table-right-panel PR-N` 与 spec 条目。

## 5. 回归门禁清单

1. `yarn tsc --noEmit` 零错误
2. `npx vitest run`：KnowledgeOutlinePanel / TableInfoPanel / TableEditor / tableModel / translation-keys 相关全绿 + 全量回归
3. `e2e/specs/knowledge-table.spec.ts`：新增 rail 断言段落（打开表格 → rail 标题 / 列清单点击 → flash），选择器随 PR 同步
4. i18n 五语言 `knowledge.tableInfo.*` key 一致（translation-keys 测试强制）
5. 与 `table-right-panel-preview.html` 场景 2 人工对照：统计、分布、列清单、点击定位、滚动联动手感一致

## 6. 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| `tableDraft` 每 keystroke 变更 → rail 全量重渲染 | 中 | TableInfoPanel 防抖 200ms + useMemo 派生；测试覆盖防抖窗口 |
| 列定位坐标与 sticky 行号列/横向滚动冲突 | 中 | 坐标计算收敛在 TableEditor（有布局真值）；PR-3 单测断言 scrollLeft 终值；e2e 冒烟 |
| `refreshLinkPanel` 对表格叶子的索引行为未验证（Rust 侧按标题匹配） | 低 | T3 数据层降级 P1；P0 仅 UI 就绪 + 手动刷新可用 |
| 五语言 key 漏同步 | 低 | translation-keys 门禁 + 每 PR 提交前全量跑 |
| PR-2 与 PR-1 同改 KnowledgeOutlinePanel 的合并冲突 | 低 | 串行执行（PR-2 基于 PR-1 提交） |
| 高频 scroll 状态入全局 store 引发重渲染风暴（PR-5） | 中 | 优先局部 CustomEvent；入 store 则只让 TableInfoPanel 订阅 |
