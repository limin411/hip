# 文档管理 · 新建表格（Table）— 规格方案

- 系列：`docs/design/knowledge-table/`
- 配套：`knowledge-table-preview.html`（高保真交互原型，浏览器直接打开）；`scripts/verify-kb-table-preview.cjs`（CDP 驱动 Chrome 的 29 项交互链路回归验证：`node scripts/verify-kb-table-preview.cjs`）
- 状态：待评审
- 日期：2026-08-11

---

## 1. 背景与目标

### 1.1 当前产品现状

知识库（文档管理）现有能力：

| 维度 | 现状 | 相关代码 |
|---|---|---|
| 节点类型 | `folder`（文件夹）/ `doc`（文档）；`board` 为历史遗留，**已移除**（"Boards / collection views removed — docs + folders only"） | `src/domain/knowledge/types.ts`、`src/components/knowledge/KnowledgeWorkspace.tsx:286` |
| 文件存储 | 文档 = Markdown（`docs/doc_*.md`），版本快照 `versions/` 按天归档 | `src-tauri/src/knowledge.rs`（`doc_path` 强制 `doc_` 前缀，line 74） |
| 新建入口 | 浏览页「新建」下拉仅两项：**新建文件夹 / 新建文档**；右键菜单（`knowledgeTree`/`knowledgeNode` provider）同样两项；空文件夹空态只有一个「新建文档」主按钮 | `src/components/knowledge/DocManagerBrowse.tsx`、`src/components/context-menu/catalog.ts:394-432` |
| 新建交互 | 下拉选择 → 列表内联命名行（Enter 确认 / Esc 取消）→ 创建并打开；文档空间有模板时先弹 `TemplatePickerModal` | `DocManagerBrowse.tsx`（`startNew`/`confirmNew`）、`src/store/knowledgeStore.ts:1409`（`requestCreateDoc`） |
| 浏览能力 | 列表/网格视图、面包屑、搜索、拖拽排序/移入、批量选择（⌘/Shift）+ 批量条、行尾 ⋯ 菜单 | `DocManagerBrowse.tsx` |
| 编辑能力 | BlockNote 块编辑器（Live/Source 双模式）、大纲、版本、回收站 | `src/components/knowledge/DocEditor.tsx` |

### 1.2 问题

1. **结构化数据无处落地**：清单、排期、进度跟踪、统计类内容只能挤进 Markdown 表格或自由文本，无法排序、筛选、按类型约束，也无法被 AI 智能体结构化读写。
2. **入口不对称**：新建下拉只有「文件夹/文档」，用户没有"建一张表"的心智入口。
3. **与 AI 工作台定位的缺口**：hip 的核心能力是驱动智能体产出；表格是智能体产出（排期、清单、数据整理）最自然的载体，但当前产出的表格只能以文本形式贴在文档里。

### 1.3 目标与非目标

**目标（P0）**：新增独立节点类型「表格」（`table`），用户可在文档管理中一键新建、并在一张**轻量表格**里完成录入、类型化、排序、筛选与统计；与现有树、搜索、拖拽、批量操作、回收站、版本、i18n 体系完全一致。

**非目标（P0 明确不做）**：

- ❌ 数据库化：多视图（看板/日历/画廊）、表间关联（Relation/Rollup）、每行展开为独立页面 —— 心智负担大（飞书多维表格改版的最大教训就是"新手无法理解数据表/视图"），列为 P2 演进。
- ❌ 复杂公式引擎 / 宏 / 透视表（Excel 场景）。
- ❌ 多人实时协同、权限。
- ❌ 附件、人员、进度等重型字段类型。

---

## 2. 行业参照（Best Practices 调研）

| 产品 | 表格形态 | 创建流程 | 可借鉴 | 应避免 |
|---|---|---|---|---|
| **Notion** | 双轨：简易表格（纯文本） vs 数据库表格视图（类型化属性） | `/table` 内联创建，拖拽扩列；数据库可从简易表格 **"Turn into database"** 升级 | ① 简易表格起步、按需升级的心智，不强迫用户先学数据库；② 创建即进入编辑 + 内联命名；③ 行/列手柄悬停插入、拖拽移动、列宽拖拽、冻结表头；④ 列菜单内嵌排序/筛选/统计（`Σ`） | 简易表格无类型约束，数据一多就失控 |
| **飞书多维表格** | 字段 = 列（类型化）、记录 = 行；视图（表格/看板/日历/甘特/画册/表单） | 云文档左上「新建 → 多维表格」，可选空白或模板 | ① **类型第一性**：新建字段即选类型（单选/多选/数字/日期/复选框）；② 双击列名改类型；③ 列尾 `+` 新增字段、行尾 `+` 新增记录；④ 排序/筛选视图内生效；⑤ 统计条 | ① 创建流程复杂、字段配置弹层 3 层交叉（改版报告明确点名）；② 直接上数据库/视图概念，新手被"教育" |
| **Airtable** | 同多维表格（Grid 为主） | 新建 Base → 模板或空表 | 空表默认给一列"标题"主字段 + 示例行，引导录入；键盘上下左右 + Tab 全键盘操作 | 模板库过重，新手选择困难 |
| **Google Sheets / Excel** | 电子表格（行列公式） | 新建空白工作簿 | ① Tab 右移 / Enter 下移 / Esc 退出的键盘导航；② 状态栏实时显示"行数/求和/平均"；③ CSV 互通是硬需求 | 公式门槛高，不适合知识库场景 |
| **Obsidian / 语雀** | Markdown 表格 / 数据表 | 文档内嵌 | 本地优先、纯文本文件可 diff 可备份（与我们一致） | 纯 Markdown 表格无法排序/筛选/类型化 |

### 2.1 结论（定位）

> **做"轻表格"：Notion 简易表格的轻量 + 飞书字段类型的子集 + Sheets 的键盘导航与 CSV 互通。**
> 不复制数据库心智；保留 P2 从表格升级为数据库的演进位（Notion "Turn into database" 心智），但 P0 绝不在 UI 上出现"视图/数据库"字样。

具体落到三个设计决策：

1. **创建**：与「新建文档」完全同构的内联命名行，零学习成本；不做模板选择弹层（文档模板系统 P1 再扩展）。
2. **列 = 类型化字段**（文本/数字/勾选/日期/单选 5 种起步），双击列名即可改类型 —— 飞书"类型第一性"，但交互收敛为列菜单一项，避免多层弹窗。
3. **键盘优先**：单击选中、双击/Enter 编辑、Tab/Enter/Esc/Delete 全键盘导航 —— Sheets 肌肉记忆直接迁移。

---

## 3. 功能设计

### 3.1 节点与存储

#### 节点模型

```ts
// src/domain/knowledge/types.ts
export type KnowledgeNodeKind = 'folder' | 'doc' | 'table'   // board 移除后仅新增 table
```

- 新 kind：`table`，id 前缀 `tbl_`（`src/domain/knowledge/ids.ts` 新增 `newTableId()`；`src/domain/knowledge/ids.ts` 与 Rust 共享的 `KNOWLEDGE_ID_RE` 同步加入 `tbl`）。
- 树/最近/回收站/搜索的叶子判断统一从 `doc`/`board` 扩展为 `doc`/`table`（`src/domain/knowledge/tree.ts` 的 `leafKind` 与 `kindPrefix` 映射各加一条）。

#### 文件格式：CSV + 元数据双文件

| 文件 | 内容 | 说明 |
|---|---|---|
| `docs/tbl_*.csv` | 数据主体。RFC 4180、UTF-8、`\n` 换行、首行为列名；勾选列存 `1/0`，日期列存 `YYYY-MM-DD`，单选列存选项文本 | **与 Markdown 同一哲学：纯文本、人类可读、git diff 友好、Excel/WPS 可直接打开、AI 智能体可直接读写**（hip 是 AI 工作台，智能体产出表格 → 直接落盘，这是相对 JSON 存储的关键优势） |
| `docs/tbl_*.meta.json` | 表结构。列定义（id/name/type/width/options）、冻结首行、统计开关、每列是否换行 | CSV 承载不了的信息放这里；**丢失可重建**（回退为全"文本"类型 + 默认宽度，数据零损失） |

**备选方案对比**：

- ❌ 单文件 `tbl_*.json`：结构全、但智能体读写/外部工具打开都需要专用解析；git diff 不可读；与"本地优先纯文本"的产品哲学背离。
- ❌ 仅 CSV：无类型/宽度信息，列拖拽排序、类型化全部丢失。
- ✅ CSV + meta 双文件：数据与结构分离，写序固定为 **先写 csv、再写 meta**（meta 失败只损失结构不损失数据）；版本快照只追踪 csv（数据主体），meta 变更（如改列类型）不产生版本 —— 与"版本 = 内容快照"的既有语义一致。

#### 版本 / 回收站

- 版本：复用 `versions/` 日快照机制，快照对象为 `tbl_*.csv`（新命令 `knowledge_write_table` 写盘时走与 `knowledge_write_doc` 相同的归档路径；`knowledge_list_versions` 按文件 stem 泛化即可）。
- 回收站/恢复：`deleteNode`/`restoreNode` 按节点 id 删除/恢复，表文件按 `tbl_` 前缀定位，与 doc 同一套逻辑。

### 3.2 创建入口（三处一致 + 侧边栏）

> 原则：**所有入口行为完全一致** —— 点击后立即进入内联命名行（不弹窗），Enter 确认创建并打开编辑器，Esc 取消。

| 入口 | 位置 | 说明 |
|---|---|---|
| ① 新建下拉 | 浏览页工具栏「新建」主按钮下拉，第三项「新建表格」 | 图标 `Table`（lucide），与「文件夹/文档」同组；`DocManagerBrowse.tsx` 的 `menuOpen` 面板加一项 |
| ② 右键菜单 | 空白区右键（`knowledgeTree` provider）、任意行/文件夹右键（`knowledgeNode` provider） | `catalog.ts` 新增 `knowledgeTree.newTable` / `knowledgeNode.newTable`，group 与 `newDoc` 相同 |
| ③ 空态 | 空文件夹/空空间空态 | 主按钮保持「新建文档」，旁边新增次级按钮「新建表格」（原型见 preview 场景一 C） |
| ④ 侧边栏 | `DirNavList` 文件夹行悬停 `+` 菜单 | 与右键 provider 同源，自动获得该项 |

**交互时序（F1）**：

```
点击「新建表格」
  → 列表末尾插入内联命名行（Table 图标 + 输入框，placeholder「未命名表格」）
  → Enter / 失焦非空：创建节点（tbl_*，默认 3 列 × 3 行空表）→ 打开表格编辑器
  → Esc：取消，不留残影
  → 空标题 Enter：用默认名「未命名表格」创建（与新建文档行为一致）
```

### 3.3 表格编辑器（核心）

#### 3.3.1 布局

```
┌ 标题栏：← 返回（面包屑） │ ✎ 表格标题（内联可改，复用 InlineDocTitle 模式） │ ⋯ 节点菜单
├ 工具栏：↶ 撤销 ↷ 重做 ｜ 排序 ⤓ 筛选 Σ 统计 ｜ ⇩ 导入 CSV  ⤓ 导出 CSV ｜ ⧉ 更多(冻结首行/换行)
├ 网格区（冻结首行，横向溢出滚动）：
│   ┌ 行号列 │ 列1(文本) │ 列2(数字) │ 列3(勾选) │ 列4(日期) │ 列5(单选) │ ＋
│   │  1     │ …        │ …        │ ☑        │ …        │ chip      │
│   │  …     │          │          │          │          │           │
│   │  Σ统计 │          │ 求和     │          │          │ 计数      │   ← 统计行（可关）
│   ＋ 添加行（左下角）
├ 状态栏：n 行 · m 列 ｜ 保存状态（已保存 / 保存中…） ｜ 就绪
```

#### 3.3.2 列类型（P0 五种）

| 类型 | 编辑交互 | 渲染 | 统计（Σ） |
|---|---|---|---|
| 文本 | 双击/Enter 进入输入 | 纯文本（可换行，列菜单开关） | 计数 |
| 数字 | 进入输入，校验数字 | 右对齐、等宽数字 | **求和 / 均值 / 计数**（列菜单切换） |
| 勾选 | 单击切换 | 复选框 | 勾选数 |
| 日期 | 进入编辑显示 date 输入 | `YYYY-MM-DD` | 计数 |
| 单选 | 点击弹出选项列表（+ 新建选项） | 彩色 chip（色板按索引取） | 计数 |

#### 3.3.3 单元格编辑与键盘导航（F2）

| 按键 | 行为 |
|---|---|
| 单击 | 选中单元格（accent 描边） |
| 双击 / Enter / F2 | 进入编辑；勾选/单选列见上表 |
| Tab / Shift+Tab | 提交并右移 / 左移（末尾自动换行；行尾 Tab 聚焦"添加行"） |
| Enter | 提交并下移；**最后一行 Enter = 自动添加新行** |
| Esc | 取消编辑，恢复原值 |
| Delete / Backspace | 清空选中单元格（进入编辑态时退格正常删字） |
| ↑ ↓ ← → | 选中态移动焦点；编辑态提交并移动（仅 ↑↓） |
| Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z | 撤销 / 重做（工具栏按钮同） |

#### 3.3.4 行列操作（F3/F4）

- **列头**：单击列名弹列菜单；菜单项 = 重命名（内联）/ 类型（5 项）/ 插入左列 / 插入右列 / 删除列（⚠ 确认 toast：可撤销）/ 排序（升序/降序/清除，选中打勾）/ 统计（Σ 求和/均值/计数 三选 + 关闭）/ 换行文本开关。
- **行手柄**：悬停行左侧显示 `⋮⋮` 手柄 + 下拉（插入上方 / 插入下方 / 删除行）；手柄可按住**拖拽移动行**（插入线指示，与浏览页拖拽同视觉语言）。
- **列宽**：列头右边线拖拽调整；双击右边线自适应内容宽度。
- **拖拽移动列**：按住列头（避开菜单区）拖拽，插入线指示。
- **新增**：行尾「添加行」按钮（始终可见，进入新行自动聚焦第一个单元格）；列尾 `＋` 按钮；空表默认 3 行 × 3 列并给首单元格引导提示（"双击开始输入"）。

#### 3.3.5 排序 / 筛选 / 统计（F5）

- **排序**：单列排序（升序/降序/清除），表头显示 `↑/↓` 指示；类型感知（数字按数值、日期按时间、文本按 locale 比较、勾选 0<1）；数据行排序，新增行追加到末尾。
- **筛选**：工具栏「筛选」开合右侧面板（或下拉面板）：条件 = 列 + 操作符（包含/等于/不为空/大于/小于，按类型裁剪）+ 值；多条件叠加；实时生效；工具栏显示 `筛选 n` 徽标；一键清除。**仅影响当前查看，不写回文件**（Notion/飞书一致语义）。
- **统计行**：工具栏 Σ 总开关 + 列菜单逐列选择；数字列默认求和；实时计算（排序/筛选后仅统计可见行 —— 与 Sheets 一致）。

#### 3.3.6 撤销重做 / 保存（F6）

- 撤销栈：结构化操作快照（上限 50 步），覆盖编辑、行列增删移动、类型切换、排序。
- 保存：与文档一致 —— 编辑防抖 ~800ms 写盘（`knowledge_write_table`），状态栏显示「保存中… → 已保存」；失败 toast 并保留本地状态。

#### 3.3.7 CSV 互通（P0 只做导出，P1 补导入）

- 导出：工具栏「导出 CSV」→ 按 RFC 4180 序列化当前数据（含筛选？—— 导出**全量数据**，不随筛选），系统下载 `tbl_*.csv`。
- P1 导入：文件选择 → 首行作列名 → 类型推断（全数字→数字，匹配 YYYY-MM-DD→日期，否则文本）→ 预览确认 → 覆盖/追加。

### 3.4 与现有系统集成

| 系统 | 改动 |
|---|---|
| 浏览列表/网格 | 行与 tile 图标换 `Table`（中性灰，与 doc 同级；文件夹保持 accent）；更新时间/拖拽/批量/⋯ 菜单全复用（kind 泛化） |
| 上下文菜单 | `catalog.ts` 新增 2 项 + `providers/knowledgeNode.ts`/`knowledgeTree.ts` 载荷加 `onNewTable` |
| 侧边栏树 | `DirNavList` 图标映射加 `table`（tree.ts `kindIcon` 级） |
| 搜索/最近 | 叶子判断扩展；最近列表图标同左 |
| 模板 | P0 不介入（表格无模板）；P1 扩展 `templates/` 支持 `tpl_*.csv` |
| i18n | zh-CN / en / zh-TW / ja / ko 五语言全量补 key（见 §7 清单） |

---

## 4. 关键交互时序

**F1 新建表格（浏览页）**
```
新建下拉 → [新建表格] → 内联命名行（Table 图标）→ Enter
  → knowledgeStore.createTable(parentId, title)
  → Rust: 写空表（3×3 默认模板 csv + meta）→ 树节点写入 tree.json
  → openDoc(tableId) → KnowledgeWorkspace 按 kind==='table' 挂载 TableEditor
```

**F2 键盘编辑**
```
单击 C1 → Enter → 输入 → Tab → C2 编辑态 → Esc → 值不变
行尾 Enter → 自动新增行 → 聚焦新行首格
```

**F3 类型切换**
```
列菜单 → 类型 → 单选
  → 已有值校验：非法值保留原文本但标警告（不静默丢弃）；勾选列：非 0/1 转 0
```

**F5 筛选统计**
```
筛选面板：[列: 状态] [等于] [进行中] → 可见行收敛 → Σ 行仅统计可见行 → 徽标「筛选 1」
```

---

## 5. 实施拆分（P0 / P1 / P2）

### P0（MVP，本次交付）
1. 节点/存储：`tbl_` id、csv+meta 读写命令（Rust `knowledge_read_table` / `knowledge_write_table`）、版本快照泛化、回收站兼容。
2. 入口：新建下拉 / 右键 / 空态三入口 + 内联命名。
3. 编辑器：网格渲染、5 种列类型、键盘导航、行列增删/拖拽/列宽、撤销重做、防抖保存、状态栏。
4. 排序 / 筛选 / 统计行。
5. 导出 CSV。
6. 集成：列表/网格图标、批量、拖拽、i18n 五语言。
7. 测试（见 §8）。

### P1
- 导入 CSV（类型推断 + 预览）、Markdown 表格 ⇄ 表格节点互转、粘贴（表格/CSV 文本 → 自动扩列）、合并单元格、公式子集（`=SUM/AVERAGE/COUNT` 引用单元格）、表格模板（`tpl_*.csv`）、大表格虚拟滚动（>500 行）。

### P2（数据库化演进位，不承诺排期）
- 「升级为数据库」：多视图（看板/日历/画廊）、表间关联、每行展开独立页面、AI 字段（智能打标/分类）。
- 设计上 P0 即预留：csv 首列可作为未来"标题主字段"（飞书/Notion 均以首列为主锚点），meta 版本号字段已含 `version` 供 schema 升级。

---

## 6. 影响面与风险

### 6.1 影响面

| 层 | 文件（预估） |
|---|---|
| Rust | `src-tauri/src/knowledge.rs`：`require_id` 类型映射加 `table→tbl_`；新增 `table_path`/`table_meta_path` 与 2 个命令；版本归档泛化 |
| 域逻辑 | `src/domain/knowledge/`：`types.ts`、`ids.ts`、`tree.ts`（leaf/prefix/icon）、新增 `tableModel.ts`（纯函数：csv 解析/序列化、meta 合并、排序/筛选/统计、撤销栈） |
| Store | `src/store/knowledgeStore.ts`：`createTable`、`requestCreateTable`（跳过模板）、编辑器打开路由 |
| UI | `DocManagerBrowse.tsx`（下拉/空态/图标）、`KnowledgeWorkspace.tsx`（`isTable` 分支）、新增 `components/knowledge/table/`（`TableEditor`、`ColumnMenu`、`FilterPanel`、`StatusBar`） |
| 菜单 | `context-menu/catalog.ts` + 两个 provider 载荷 |
| i18n | 5 个语言文件 |

### 6.2 风险与对策

| 风险 | 对策 |
|---|---|
| 双文件一致性 | 写序固定 csv→meta；读时 meta 失败回退默认结构；meta 丢失不丢数据 |
| CSV 转义（含引号/逗号/换行的单元格） | 序列化/解析单测覆盖 RFC 4180 边界（含 `\r\n` 与 CR 内嵌） |
| 大表性能 | P0 上限约 2k 行可用（DOM 表格直渲）；超出走 P1 虚拟滚动；meta 标记 `large` 提示 |
| 删除列误操作 | 可撤销（撤销栈），删除后 toast「已删除列，⌘Z 可撤销」 |
| 与文档编辑心智混淆 | 编辑器只处理表格本身；单元格内不支持块编辑（文本/换行文本已覆盖 95% 场景） |

---

## 7. i18n key 清单（新增）

```
knowledge.tree.newTable         新建表格（en: New table）
knowledge.table.untitled        未命名表格
knowledge.table.*
  toolbar: undo/redo/sort/filter/stats/importCsv/exportCsv/more/freezeHeader/wrapText
  columnMenu: rename/type/insertLeft/insertRight/deleteColumn/deleteHint/sortAsc/sortDesc/
              sortClear/statsShow/statsSum/statsAvg/statsCount/statsOff/wrap
  rowMenu: insertAbove/insertBelow/deleteRow
  types: text/number/checkbox/date/select + selectNewOption
  filter: title/addCondition/column/operator(contains/equals/isNotEmpty/gt/lt)/value/clear/activeCount
  grid: addRow/addColumn/emptyHint/firstCellHint
  status: rowsCols/saved/saving/ready
  toasts: created/exported/imported/columnDeleted/rowDeleted
```

---

## 8. 测试计划

| 层 | 用例 |
|---|---|
| 单测（纯函数） | CSV parse/serialize round-trip（含转义边界）；meta 合并与缺失回退；排序比较器（数字/日期/文本/勾选）；筛选条件求值；统计聚合（可见行）；撤销栈 push/undo/redo/上限 |
| 组件测试 | 新建下拉三入口渲染；内联命名 Enter/Esc/空标题；编辑器键盘导航矩阵（Tab/Enter/Esc/Delete/方向键）；列菜单类型切换与非法值保留；行列增删与拖拽重排；统计行开关 |
| e2e | 新建表格 → 编辑多单元格 → 保存 → 重开文件数据不丢；导出 CSV 与文件一致；表格节点参与搜索/批量删除/回收站恢复；i18n 五语言 key 完整（既有 translation-keys 测试自动覆盖） |

---

## 9. 验收标准（Done 定义）

1. 三入口均可创建表格节点，内联命名交互与新建文档一致；
2. 新建后直接进入编辑器，默认空表可编辑，Tab/Enter/Esc 键盘导航全通；
3. 5 种列类型可切换，非法值不静默丢失；
4. 排序、筛选、统计行实时生效且互不污染文件内容；
5. 撤销/重做覆盖全部结构化操作；防抖保存后 `tbl_*.csv`/`meta.json` 落盘正确，重开不丢数据；
6. 表格节点在列表/网格/侧边栏/搜索/最近/回收站中图标与行为正确；
7. 五语言 key 齐全；`yarn tsc`、`yarn test` 通过。
