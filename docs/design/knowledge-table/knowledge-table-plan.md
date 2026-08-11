# 文档管理 · 新建表格（Table）· 执行计划（Plan）

> 依据：`docs/design/knowledge-table/knowledge-table-spec.md` + 高保真交互原型 `docs/design/knowledge-table/knowledge-table-preview.html`（交互基准，浏览器打开对照；回归脚本 `scripts/verify-kb-table-preview.cjs` 已覆盖 29 条交互链路）
> 目标分支：`feature/knowledge-table`（自 `dev.1.0.1` 切出，按 PR 拆分合入）
> 规模估算：**P0 9.5–12.5 人日 + P1 4–5 人日 ≈ 14–17 人日**（单人 3–3.5 周）
> 范围护栏（spec §1.3/§5 非目标，本计划不包含）：数据库化（视图/关联/每行独立页）、公式引擎、多人协同、附件/人员字段、表格模板、Markdown ⇄ 表格互转、合并单元格、虚拟滚动。

---

## 1. 计划总览

| PR | 阶段 | 主题 | spec 项 | 依赖 | 估算 | 状态 |
|---|---|---|---|---|---|---|
| **PR-1** | P0 | 存储与域层：`tbl_` 节点 + csv/meta 双文件读写（Rust）+ `tableModel` 纯函数库 | §3.1、§5-P0-1 | 无 | 2–2.5 人日 | ⬜ |
| **PR-2** | P0 | 创建入口：新建下拉 / 右键 / 空态三入口 + 内联命名 + 目录图标 | §3.2、§5-P0-2 | PR-1 | 1–1.5 人日 | ⬜ |
| **PR-3** | P0 | 编辑器骨架：网格渲染 + 5 种列类型 + 键盘导航 | §3.3.1–3.3.3 | PR-1 | 3–3.5 人日 | ⬜ |
| **PR-4** | P0 | 编辑器进阶：行列操作 / 拖拽 / 列宽 / 冻结 + 撤销重做 + 防抖保存 + 状态栏 | §3.3.4、§3.3.6 | PR-3 | 2–2.5 人日 | ⬜ |
| **PR-5** | P0 | 数据能力：排序 / 筛选 / 统计行 + CSV 导出 | §3.3.5、§3.3.7、§5-P0-4/5 | PR-4 | 1.5–2 人日 | ⬜ |
| **PR-6** | P0 | 集成收尾：浏览/侧栏/搜索/最近/回收站 + 上下文菜单 + i18n 五语言 + e2e | §3.4、§7、§8、§5-P0-6/7 | PR-2 + PR-5 | 1.5–2 人日 | ⬜ |
| **P1** | P1 | 导入 CSV 预览、Markdown ⇄ 表格、合并单元格、公式子集、模板、虚拟滚动 | §5-P1 | P0 全部 | 4–5 人日 | ⬜ |

**并行策略**：PR-1 先行（域层，无 UI 冲突）；PR-2 与 PR-3 在 PR-1 合入后可并行（文件域不重叠：`DocManagerBrowse.tsx`+`knowledgeStore.ts` vs `KnowledgeWorkspace.tsx`+`components/knowledge/table/*`）；PR-4 → PR-5 串行（同一 `TableEditor.tsx` 域）；PR-6 依赖 PR-2/PR-5，收尾合入。P1 全部在 P0 合入后启动。

---

## 2. PR-1 — 存储与域层（§3.1，2–2.5 人日）

**目标**：`table` 成为一等节点类型，数据可落盘、可版本化、可回收。纯域 + Rust，无 UI 变更，先行合入供 PR-2/PR-3 依赖。

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| PR1-1 | `KnowledgeNodeKind` 增 `'table'`；`ids.ts` 增 `newTableId()`（`tbl_`）并同步 `KNOWLEDGE_ID_RE`；`tree.ts` 叶子判断/`kindPrefix`/图标映射从 `doc/board` 泛化为 `doc/table` | `domain/knowledge/types.ts`、`ids.ts`、`tree.ts` | 单测：table 节点参与 `listChildren`/叶子统计/前缀映射；id 正则放行 `tbl_` |
| PR1-2 | Rust：`require_id` 类型映射加 `table→tbl_`；新增 `table_path`（`tbl_*.csv`）与 `table_meta_path`（`tbl_*.meta.json`）；新命令 `knowledge_read_table`（返回 `{csv, meta}`，meta 缺失回退默认结构）与 `knowledge_write_table`（**写序固定 csv→meta**） | `src-tauri/src/knowledge.rs` | cargo 单测：读写 round-trip、meta 缺失回退、非法 id 拒绝、写序异常路径（meta 写失败不丢 csv） |
| PR1-3 | 版本快照泛化：`knowledge_write_table` 走与 doc 相同的 `versions/` 日归档（快照对象为 csv 内容）；`knowledge_list_versions` 按文件 stem 泛化（doc/tbl 共用） | `src-tauri/src/knowledge.rs` | 表格编辑产生版本条目；列表/恢复与 doc 行为一致 |
| PR1-4 | 回收站兼容：`knowledge_delete_doc_file`/恢复路径按 id 前缀分派 `tbl_` → 删除/恢复 csv+meta 双文件 | `src-tauri/src/knowledge.rs` | 删除表格节点后 csv/meta 均入回收站，恢复后双文件齐全 |
| PR1-5 | `tableModel.ts` 纯函数库：CSV 解析/序列化（RFC 4180 含引号/逗号/换行转义）、meta 合并与缺失回退、排序比较器（数字/日期/文本 locale/勾选）、筛选条件求值、统计聚合（sum/avg/count，可见行）、撤销栈（snapshot 上限 50） | `domain/knowledge/tableModel.ts`（新增） | Vitest：round-trip 边界（`\r\n`、CR 内嵌、引号转义）；meta 回退不丢数据；比较器/筛选/聚合表驱动用例 |

**测试**：`tree.test.ts`/`ids.test.ts` 扩展；`knowledge.rs` cargo 用例；`tableModel.test.ts` 新增（spec §8 单测层全部落在此 PR）。

---

## 3. PR-2 — 创建入口（§3.2，1–1.5 人日）

**目标**：三入口一致 + 内联命名，交互与「新建文档」完全同构（spec 场景一）。

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| PR2-1 | 新建下拉第三项「新建表格」（`Table` 图标，与文件夹/文档同组）→ 内联命名行（placeholder「未命名表格」）；Enter 确认创建并打开编辑器 / Esc 取消 / 空标题用默认名 | `DocManagerBrowse.tsx` | 交互与 preview 场景一一致；`browse-inline-new` 复用 |
| PR2-2 | store：`createTable`（写空表 3×3 默认模板 + tree.json 节点）与 `requestCreateTable`（**跳过模板选择**，与 `requestCreateDoc` 的模板分支区分）；打开路由复用 `openDoc` | `knowledgeStore.ts` | `knowledgeStore.test.ts`：创建后节点入树、文件落盘、`templatePicker` 不触发 |
| PR2-3 | 空文件夹/空空间空态：主按钮「新建文档」旁加次级按钮「新建表格」 | `DocManagerBrowse.tsx` | 空态两按钮渲染（preview 场景一 C） |
| PR2-4 | 上下文菜单：`catalog.ts` 新增 `knowledgeTree.newTable` / `knowledgeNode.newTable`（group 与 `newDoc` 相同）；`providers/knowledgeNode.ts`/`knowledgeTree.ts` 载荷加 `onNewTable`（`newIn` 规则复用，文件夹内/同级） | `context-menu/catalog.ts`、`providers/*.ts` | 空白右键/行右键/行尾 ⋯ 均有「新建表格」；`catalog.test.ts` 注册断言 |
| PR2-5 | 侧边栏 `DirNavList` 行图标映射加 `table`；行 hover ＋ 菜单自动获得「新建表格」 | `DirNavList.tsx` | 树中表格行显示 `Table` 图标 |
| PR2-6 | i18n 基础 key：`knowledge.tree.newTable`、`knowledge.table.untitled`（spec §7 顶部两条），五语言 | `src/i18n/*.ts` | `translation-keys.test.ts` 通过 |

**测试**：`DocManagerSort.test.tsx` 扩展（下拉第三项、内联命名 Enter/Esc/空标题）；`knowledgeStore.test.ts`；`catalog.test.ts`；右键菜单渲染断言。**e2e**：`knowledge-tree-crud.spec.ts` 扩展新建表格链路（桌面端执行，见 §8 备注）。

---

## 4. PR-3 — 编辑器骨架：网格 + 类型 + 键盘（§3.3.1–3.3.3，3–3.5 人日）

**目标**：打开表格即见可编辑网格，键盘导航全通。这是 P0 最大 PR，动组件结构。

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| PR3-1 | `KnowledgeWorkspace` 路由：`isTable` 分支挂载 `TableEditor`（复用 `DocManagerBrowse` 无活动节点分支模式） | `KnowledgeWorkspace.tsx` | 打开表格节点进入编辑器；返回浏览正常 |
| PR3-2 | 编辑器布局：标题栏（返回 + `InlineDocTitle` 模式内联命名 + 节点 ⋯）+ 工具栏骨架（撤销/重做占位 + 排序/筛选/统计占位 + 导入/导出占位）+ 网格区 + 底部状态栏（行数/列数/保存状态） | `components/knowledge/table/TableEditor.tsx`（新增）+ `table/` 组件族 | 布局对齐 preview 场景二 |
| PR3-3 | 网格渲染：冻结首行（`thead` sticky）、行号列 sticky、列宽由 meta 驱动、悬停行尾 ⋯ 菜单；空表格首格「双击输入」引导 | `TableEditor.tsx` | 滚动后表头/行号列不位移（对照 preview 滚动行为） |
| PR3-4 | 单元格编辑：单击选中（accent 描边）、双击/Enter/F2 进入、输入框内联；键盘导航矩阵：Tab/Shift+Tab 换列（行尾自动换行）、Enter 下移（最后一行自动加行）、Esc 取消、Delete 清空、↑↓←→ 移动焦点、直接输入字符进入编辑 | `TableEditor.tsx` | 键盘矩阵组件测试全覆盖（spec §4 F2 时序） |
| PR3-5 | 5 种列类型：文本（可换行开关）、数字（右对齐/千分位/非法值保留原文本 + toast）、勾选（单击切换）、日期（date 输入）、单选（点击弹选项列表 + 新建选项）；类型图标随列头 | `TableEditor.tsx` | 各类型渲染与编辑行为对照 preview；非法数字值不静默丢失 |
| PR3-6 | 列菜单 v1：重命名（内联输入）/ 类型切换 / 插入左/右列 / 删除列（可撤销 toast）；行菜单 v1：插入上/下、复制行、删除行 | `TableEditor.tsx`、`table/ColumnMenu.tsx`（新增） | 菜单项齐全；删除后 ⌘Z 可恢复（依赖 PR-4 撤销栈，先落菜单交互） |
| PR3-7 | i18n：`knowledge.table.types.*`、`columnMenu/rowMenu` 组 key（spec §7） | `src/i18n/*.ts` | `translation-keys.test.ts` 通过 |

**测试**：`TableEditor.test.tsx` 新增——渲染（行列数/类型图标/统计行占位）、键盘矩阵（tab/enter/esc/delete/方向键）、类型切换与非法值、菜单打开与项渲染；`KnowledgeWorkspace.paper.test.tsx` 回归（isTable 分支不破坏既有契约）。

---

## 5. PR-4 — 编辑器进阶：行列操作 + 撤销 + 保存（§3.3.4/§3.3.6，2–2.5 人日）

**目标**：结构化操作全可撤销，编辑防抖落盘，状态栏实时反馈。

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| PR4-1 | 行拖拽移动（手柄 pointer 拖拽 + 插入线，与浏览页拖拽同视觉语言）；列头拖拽重排（列数据随动）；列宽拖拽调整（最小 48px）+ 双击列边自适应 | `TableEditor.tsx` | 拖拽后数据/表头一致；插入线指示正确（preview F4） |
| PR4-2 | 撤销/重做：历史栈（结构化快照上限 50，含排序状态）；工具栏按钮启用态；⌘Z / ⇧⌘Z（macOS 与 Windows 双修饰键） | `TableEditor.tsx`、`table/tableHistory.ts`（或并入 tableModel） | 覆盖单元格编辑/类型切换/行列增删移动/列宽/排序；撤销后重做完整 |
| PR4-3 | 防抖保存（~800ms）走 `knowledge_write_table`；状态栏「保存中… → 已保存」；失败 toast 并保留本地状态 | `TableEditor.tsx`、`ipc/knowledge.ts`（封装 read/write table） | 编辑后落盘 csv+meta；重开文件数据不丢（e2e） |
| PR4-4 | 冻结首行开关（工具栏「冻结首行」/ 更多菜单，默认开） | `TableEditor.tsx` | 关闭后表头随滚动；开启后 sticky 恢复 |

**测试**：`TableEditor.test.tsx` 扩展（拖拽重排结果断言、撤销栈 push/undo/redo/上限、保存防抖 fake timers、写盘调用参数含 csv+meta）；`tableModel.test.ts` 撤销栈边界补用例。

---

## 6. PR-5 — 数据能力：排序 / 筛选 / 统计 + CSV 导出（§3.3.5/§3.3.7，1.5–2 人日）

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| PR5-1 | 排序：单列升/降/清除（列菜单 + 工具栏「排序」面板两入口同源）；表头 `↑/↓` 指示 + 排序列底色；类型感知比较器（复用 PR-1 纯函数）；数据行排序、新增行追加末尾 | `TableEditor.tsx` | 各类型排序结果正确；指示器与底色对齐 preview |
| PR5-2 | 筛选：工具栏「筛选」开合面板——条件 = 列 + 操作符（按类型裁剪）+ 值；多条件叠加；实时生效；徽标计数；一键清除；**仅影响当前查看，不写回文件** | `TableEditor.tsx`、`table/FilterPanel.tsx`（新增） | 筛选行数与徽标正确；清空后恢复；导出不受筛选影响 |
| PR5-3 | 统计行：工具栏 Σ 总开关 + 列菜单逐列选择（数字=求和/均值/计数，其余=计数，可关闭）；**仅统计可见行**（排序/筛选后联动） | `TableEditor.tsx` | 与 preview §F5 一致（预算表 Σ 求和样例） |
| PR5-4 | 导出 CSV：RFC 4180 序列化（含 BOM 供 Excel 识别），下载 `tbl_*.csv`，导出**全量数据**不随筛选 | `TableEditor.tsx` | 导出文件与表格数据一致（e2e 比对文件内容） |
| PR5-5 | i18n：`filter.*`、`sort/stats` 组 key（spec §7） | `src/i18n/*.ts` | `translation-keys.test.ts` 通过 |

**测试**：`TableEditor.test.tsx`（排序/筛选/统计联动、徽标、清除）；`tableModel.test.ts`（比较器/筛选/聚合已随 PR-1，此处补联动回归）；e2e：导出 CSV 内容比对。

---

## 7. PR-6 — 集成收尾（§3.4/§7/§8，1.5–2 人日）

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| PR6-1 | 浏览列表/网格：表格行与 tile 用 `Table` 图标（中性灰，与 doc 同级；文件夹保持 accent）+「上次编辑」时间；拖拽排序/移入、批量选择（⌘/Shift）、批量条、行尾 ⋯ 菜单全复用（kind 泛化验证） | `DocManagerBrowse.tsx` | 表格节点参与全部浏览操作；图标正确 |
| PR6-2 | 搜索/最近：叶子判断已随 PR-1 泛化，验证搜索命中表格、最近列表图标与打开行为 | 验证 + 必要微调 | 搜索/最近/回收站恢复表格节点行为正确 |
| PR6-3 | 表格标题内联编辑（`InlineDocTitle` 模式）写回 `tree.json` 标题 | `TableEditor.tsx` | 改名后树/浏览/列表同步 |
| PR6-4 | i18n 补齐：`grid.*`、`status.*`、`toasts.*`、`table.toolbar.*` 全部 key 五语言（spec §7 清单） | `src/i18n/*.ts` | `translation-keys.test.ts` 通过 |
| PR6-5 | e2e 全链路（spec §8 e2e 层）：新建表格 → 编辑多单元格 → 保存 → 重开数据不丢；导出 CSV 与文件一致；表格参与搜索/批量删除/回收站恢复 | `e2e/knowledge-*.spec.ts`（新增/扩展） | 桌面端（wdio）全绿 |

**测试**：`DocManagerSort.test.tsx`（表格行渲染/批量选择/拖拽）；`AppSidebar.test.tsx`（目录图标）；e2e 如上。**全量回归**：`yarn tsc` + `yarn test` + 受影响 e2e + 与 `knowledge-table-preview.html` 对照截图（Playwright `--channel=chrome` 流程）。

---

## 8. 测试与验收（对应 spec §9 验收清单）

| 验收项 | 对应 PR | 验证方式 |
|---|---|---|
| `table` 节点可建可存：`tbl_*.csv` + `meta.json` 落盘、版本快照、回收站恢复 | PR-1 | cargo + Vitest 单测；e2e 重开不丢数据 |
| 三入口均可创建表格，内联命名与新建文档同构 | PR-2 | 组件测试 + e2e + preview 对照 |
| 新建后直接进入编辑器；默认空表可编辑；键盘导航全通 | PR-3 | `TableEditor.test.tsx` 键盘矩阵 |
| 5 种列类型可切换，非法值不静默丢失 | PR-3 | 组件测试（非法数字保留 + toast） |
| 行列增删/拖拽/列宽/冻结；撤销重做覆盖全部结构化操作 | PR-4 | 组件测试 + 手动对照 preview |
| 排序、筛选、统计行实时生效且互不污染文件 | PR-5 | 组件测试 + e2e 导出比对 |
| 防抖保存后文件正确，重开不丢数据 | PR-4 | e2e（fake timers 单测 + 桌面端链路） |
| 表格节点在列表/网格/侧边栏/搜索/最近/回收站中图标与行为正确 | PR-6 | 组件测试 + e2e |
| 五语言 key 齐全 | PR-2/3/5/6 | `translation-keys.test.ts`（自动覆盖） |
| **回归门禁（每个 PR）** | 全部 | `yarn tsc` + `yarn test` 全绿 + 受影响 e2e 通过 + preview 对照截图 |

**e2e 备注**：wdio e2e 需桌面端运行，与既有系列一致（参考 doc-notion-polish 执行备注）；原型交互回归用 `node scripts/verify-kb-table-preview.cjs`（headless，无需桌面端），实现阶段作为行为基准持续对照。

---

## 9. 风险与对策

| 风险 | 等级 | 对策 | 阶段 |
|---|---|---|---|
| 双文件一致性（csv/meta） | 高 | 写序固定 csv→meta（spec §6.2）；meta 缺失回退默认结构不丢数据；cargo 单测覆盖写序异常路径 | PR-1 |
| CSV 转义边界（引号/逗号/换行/`\r\n`） | 高 | RFC 4180 序列化/解析单测全覆盖；导出加 BOM 兼容 Excel | PR-1/PR-5 |
| `tree.ts` 叶子判断泛化波及既有 doc/board 行为 | 中 | `tree.test.ts` 既有用例回归 + 新增 table 用例；board 为历史遗留（已移除），不扩展其行为 | PR-1 |
| 键盘导航与原生输入框行为冲突（Tab 焦点/IME） | 中 | 编辑态拦截 Tab/Enter 前先 `commitEdit`；IME 组合键（`isComposing`）放行；键盘矩阵测试覆盖 | PR-3 |
| 编辑器 PR 过大（网格+类型+键盘同 PR） | 中 | 拆 PR-3/PR-4 两刀；PR-3 先合「可编辑但不可撤销」的可用切片，PR-4 补撤销/保存 | 排期 |
| 撤销栈快照体积（大表） | 低 | P0 上限约 2k 行直渲可用；快照上限 50 步；超出走 P1 虚拟滚动 + 增量历史 | PR-4/P1 |
| 与文档编辑器的心智混淆（单元格内想写富文本） | 低 | 单元格仅文本/换行文本；spec 已定非目标，评审确认不放开块编辑 | PR-3 |
| e2e 桌面端执行成本 | 低 | 原型链路由 headless 回归脚本守护；桌面端 e2e 集中在 PR-6 一次收口 | PR-6 |

---

## 10. 提交/评审节奏

- 每个 PR 独立合入，标题前缀 `knowledge-table/PR-N`；合入门禁：**`yarn tsc` + `yarn test` 全绿 + 受影响 e2e 通过 + 与 `knowledge-table-preview.html` 对照（交互基线）**
- **评审重点**：
  - PR-1：Rust 写序契约（csv→meta）与 meta 回退语义；`KNOWLEDGE_ID_RE` 前后端同步；`tableModel` 纯函数边界（无 DOM 依赖）
  - PR-2：三入口交互一致性（与新建文档同构）；`requestCreateTable` 跳过模板分支
  - PR-3：键盘导航契约（IME、Tab 焦点拦截）；列类型非法值策略；路由分支不破坏既有 `isBoard` 遗留逻辑
  - PR-4：撤销栈覆盖范围与快照语义；保存防抖与错误恢复
  - PR-5：筛选「视图内生效不写文件」契约；统计仅可见行；导出全量数据
  - PR-6：kind 泛化影响面（搜索/回收站/批量）；i18n 五语言完整性
- 每阶段合入后：更新本 plan 勾选状态、spec §9 验收清单打勾

---

## 11. 实施记录（随执行更新）

- [ ] **PR-1 存储与域层** —
- [ ] **PR-2 创建入口** —
- [ ] **PR-3 编辑器骨架** —
- [ ] **PR-4 编辑器进阶** —
- [ ] **PR-5 数据能力** —
- [ ] **PR-6 集成收尾** —
- [ ] **P1 清单**（导入 CSV 预览、Markdown ⇄ 表格、合并单元格、公式子集、表格模板、虚拟滚动）—

**执行备注**：待首 PR 合入后补充（基线测试状态、e2e 桌面端执行情况、与 preview 对照截图归档位置）。
