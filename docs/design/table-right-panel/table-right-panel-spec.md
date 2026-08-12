# 文档管理 · 表格 × 右侧面板 关联性整改 Spec

- 系列：`docs/design/table-right-panel/`
- 配套：`docs/design/table-right-panel/table-right-panel-preview.html`（问题对照 + 右侧 rail 联动交互原型，浏览器直接打开）；`docs/design/table-right-panel/table-right-panel-plan.md`（执行计划：PR-1..5 拆解、文件级任务、测试与验收、节奏与风险）
- 状态：待评审
- 日期：2026-08-11
- 前置基线：`docs/design/table-ux-notion/table-ux-notion-spec.md`（表格编辑器交互整改，本版不重复表格域设计）；`docs/design/knowledge-table/knowledge-table-spec.md`（表格功能模型）
- 涉及模块：`KnowledgeOutlinePanel`（右侧 rail）、`KnowledgeWorkspace`（大纲跳转）、`knowledgeStore`（表格打开路径）

---

## 1. 根因：右侧面板把「表格」当「文档」渲染

文档管理打开任意叶子后，右侧 rail（大纲 + 反向链接 + 字数统计）应展示与**当前内容**相关的信息。表格（`tbl_*`）打开时，rail 却渲染成一个"内容恒空的文档面板"：空大纲、0 字统计、三组空链接——与表格内容**完全无关联**。同一页面里表格有 6 列 30 行数据，右侧却显示"大纲 (0) / 暂无入链 / 0 字词"。

### 1.1 根因 A：类型判定只排除画板，遗漏表格

| # | 现象 | 代码证据 | 根因 |
|---|---|---|---|
| K1 | 表格打开时右侧面板走**文档分支**（显示大纲区块、字数统计、链接刷新按钮），而不是像画板那样显示"该叶子没有大纲"占位 | `KnowledgeOutlinePanel.tsx` L52-55：`const isDoc = activeDocId != null && activeNode?.kind !== 'board' && ...`——只排除 `board`；`kind === 'table'`（id 以 `tbl_` 开头）被判为文档 | 面板的类型判定漏了表格。同仓库 `KnowledgeWorkspace.tsx` L287 已有共识式判定：`isTable = activeNode?.kind === 'table' && (activeDocId ?? '').startsWith('tbl_')`，面板未对齐 |
| K2 | 表格打开时 `docBody` 被 store **清空**，rail 从空正文提取大纲 → 「大纲 (0)」；字数统计 0 | `knowledgeStore.ts` L1938-1952（打开表格分支）：`docBody: ''`、`draftBody: ''`，表格内容在 `tableDraft.csv`；`KnowledgeOutlinePanel.tsx` L73 `extractDocOutline(content)`、L92-97 `wordCount` 均基于 `docBody` | rail 的数据源对表格不适用：表格没有 markdown 正文，内容在 `tableDraft.csv/meta` |
| K3 | 反向链接三组恒空：「暂无入链 / 暂无出链 / 没有断链 🎉」；刷新按钮点了无意义 | `knowledgeStore.ts` 打开表格分支 `backlinks: [], outboundLinks: [], brokenLinks: []`（L1946-1948）；`refreshLinkPanel`（L1132）按 docId 走正文索引接口 | 表格叶子没有正文可扫描，入链语义应基于**其他文档对表格标题的 `[[引用]]`**（表格可被引用），现状未接通 |
| K4 | 表格下点击大纲残留项（从文档切到表格的瞬间）→ 跳转请求空转，无任何反馈 | `KnowledgeWorkspace.tsx` L194-229：`pendingOutlineJump` effect 只对 `leaf?.kind === 'board'` 提前返回（L197），表格落入文档分支去 DOM 里找 heading → 找不到 | 与 K1 同一处遗漏的连锁反应 |

### 1.2 根因 B：画板有占位、表格没有——同为非文档叶子，待遇不一致

| # | 现象 | 代码证据 | 根因 |
|---|---|---|---|
| K5 | 画板打开 → rail 显示「画板没有大纲」占位（`knowledge.outline.noBoard`）；表格打开 → 显示空文档面板 | `KnowledgeOutlinePanel.tsx` L159-168：`!isDoc` 分支渲染 `knowledge-doc-outline-no-doc` 占位（文案来自 `t('knowledge.outline.noDoc')`）；`outline.noBoard` key 存在（`zh-CN.ts` L2765）但仅 board 路径命中 | 面板曾为画板打过补丁，表格漏了同样的补丁，且补丁形态（占位空态）本身没有提供任何表格相关信息 |

### 1.3 用户感知

> 打开表格 → 右侧面板出现一块"别人的东西"：大纲空、链接空、字数 0，与眼前 6 列 30 行的表格毫无关系。关掉面板反而更干净；保留面板则像两个产品拼在一起。

---

## 2. 基线：Notion 怎么处理「表格 + 侧栏信息」

Notion 打开 Database（表格视图）时不显示文档大纲；数据库的**结构信息**（属性列、类型、行数）内嵌在表格自身，且任何时刻用户都能从表格上下文直接看到：

| Notion 行为 | 对应到 hip 右侧 rail 的映射 |
|---|---|
| 表格视图没有"目录/大纲"概念 | 表格打开时隐藏大纲区块（不是显示空大纲） |
| 表格的属性列清单 + 类型 + 行数是稳定上下文 | rail 展示**表格信息**：行数/列数、列结构清单（列名 + 类型 + 宽度）、列类型分布 |
| 点击/聚焦某列时列上下文立即可见 | 列清单点击 → 表格滚动到该列并高亮列头；表格滚动 → 清单滚动高亮当前可见列（scrollspy 反向） |
| 表格可以被文档引用（`[[表格名]]`），反链仍有效 | rail 保留反向链接区块（入链语义：其他文档引用本表格） |
| 画板/非文档叶子不展示大纲 | 画板保持 `noBoard` 占位；表格不再落入文档分支 |

原则：**右侧 rail 永远展示与当前叶子匹配的信息**——文档→大纲+链接+字数；表格→表格信息+链接；画板→占位。信息宁缺毋假。

---

## 3. 改进项

### T1 类型感知：面板对齐表格判定（P0）

`KnowledgeOutlinePanel.tsx` 新增与 `KnowledgeWorkspace.tsx` L287 同式的判定：

```
const isTable = activeDocId != null && activeNode?.kind === 'table' && activeDocId.startsWith('tbl_')
const isDoc = activeDocId != null && !isTable && activeNode?.kind !== 'board' && ...
```

- 大纲区块、字数统计只在 `isDoc` 时渲染；
- 大纲跳转（`KnowledgeWorkspace` L194）同步对 `table` 提前 `clearPendingOutlineJump()` 返回（与 board 相同分支）。

### T2 表格信息面板 TableInfoPanel（P0 核心）

表格打开时，rail 大纲位置渲染 `<TableInfoPanel />`（新建 `src/components/knowledge/table/TableInfoPanel.tsx`，挂在 `KnowledgeOutlinePanel` 内）：

1. **统计行**：`行数 × 列数`（`tableDraft.csv` 解析行数、`tableDraft.meta` 解析列数，实时跟随草稿）；
2. **列结构清单**：每列一行 —— 类型 chip（复用 `TableEditor` 现有 `CHIP_STYLES` 6 色板与 select 选项 chip 视觉）+ 列名 + 列宽 px；
   - 点击列 → 请求定位：scroll 表格使该列可见（`scrollIntoView` 级语义，水平滚动到列头），列头高亮 1.2s 淡出（`table-col-flash` 动画类）；
3. **类型分布**：`文本 3 · 数字 1 · 多选 1 …` 单行汇总（chips 计数）；
4. **空表态**：0 行 / 0 列时显示"空表格"文案而非空白。

数据源：直接订阅 `useKnowledgeStore.tableDraft`（与编辑器同一草稿，保存/撤销即时同步，无需新接口）。

### T3 反向链接保留 + 语义接通（P0 UI / P1 数据）

- 表格打开时 rail 仍渲染 `BacklinkPanel`（区块语义不变：显示引用本表格的文档）；
- 空态文案改为表格语境提示（复用现有 `emptyInbound` 即可，正文说明"被文档引用后显示在此"）——P0 不加新文案 key；
- **数据层**（P0 已确认链路）：`wikiDocsFromNodes` = `listDocsInTreeOrder(nodes)` 已含表格节点（`linkIndex.ts` L59），其他文档 `[[表格标题]]` 可 resolve 到 `tbl_*` docId；反链查询按 `target_doc_id` 匹配（`knowledge_link_index.rs` L312）——数据层天然支持表格入链。PR-4 补上打开表格时自动 upsert 标题索引 + `refreshLinkPanel`（与 openDoc 同构，原缺口：表格打开后反链恒空直到手动刷新）。
- **P1 跟随项**（独立验证）：全量索引重建（`knowledgeLinkIndexReplaceAll`）在表格 rename 后是否需要重写引用方 raw（现 `rewriteWikiLinksAfterRename` 只扫 doc 正文）——若表格被引用且重命名，引用方 `[[旧标题]]` 将断链，需 P1 评估把表格标题纳入重写范围。

### T4 面板头部联动（P0）

- rail 标题：`isDoc` → 现有「目录」；`isTable` → 「表格信息」（新 i18n key）；
- 刷新按钮：`isDoc || isTable` 时显示（表格下点击 = 重新扫描入链），`noDoc`/画板隐藏（现状保留）。

### T5 大纲跳转防护（P0，见 T1）

### T6 字数统计（P0）

- 只在 `isDoc` 渲染（表格下不显示「0 字词」）。

### T7 i18n 五语言（P0）

新增 keys（`knowledge.tableInfo.*`，五语言同步，`translation-keys.test.ts` 强制）：

```
tableInfo.title      '表格信息'
tableInfo.rowsCols   '{{rows}} 行 · {{cols}} 列'
tableInfo.column     '列'
tableInfo.width      '{{width}}px'
tableInfo.empty      '空表格：点击下方「＋ 添加行」开始'
tableInfo.typeText/typeNumber/...（类型名复用 knowledge.table.types.*，不新增）
```

### T8 滚动联动 scrollspy 反向（P1 增强，预览已含）

- 表格水平滚动时，rail 列清单高亮**当前可见的第一列**（滚动超过列宽一半判定）；
- 与 T2 点击定位互逆，形成闭环；P1 排期，预览原型先行验证手感。

---

## 4. 交互序列（P0 关键路径）

### 4.1 打开表格

```
树中点击表格节点
→ openTable 成功（docBody 清空、tableDraft 装载）
→ KnowledgeOutlinePanel 重渲染：
   isDoc=false, isTable=true
→ rail 显示：标题「表格信息」| 刷新按钮
   区块① 表格信息：行数×列数 / 类型分布 / 列清单（chip+列名+宽度）
   区块② 反向链接（入链/出链/断链空态）
   （无大纲区块、无字数统计）
```

### 4.2 列清单定位

```
点击「预算 | 数字 | 150px」
→ requestTableColumnJump(colId)
→ KnowledgeWorkspace 定位表格 scroller，水平滚动到该列 x
→ 列头加 table-col-flash 类，1.2s 后移除（CSS transition 淡出）
→ 右侧清单该项短暂高亮（0.6s）
```

### 4.3 切换叶子（表格 → 文档）

```
打开文档 doc_2
→ isDoc=true, isTable=false
→ rail 恢复：标题「目录」| 大纲区块 + 反向链接 + 字数统计（现状不变）
```

---

## 5. 验收清单

| # | 验收点 | 关联 |
|---|---|---|
| 1 | 打开表格：rail 标题为「表格信息」，**无**大纲区块、**无**字数统计 | T1/T4/T6 |
| 2 | 表格信息区块显示：行数×列数 与编辑器一致；列清单每条含类型 chip + 列名 + 宽度；类型分布行存在 | T2 |
| 3 | 表格内编辑（加行/删行/改列名）→ rail 统计与列清单**实时同步**（同一 tableDraft） | T2 |
| 4 | 点击列清单某列 → 表格水平滚动到该列、列头高亮闪烁、清单项短暂高亮 | T2/T8 |
| 5 | 表格下反向链接区块仍渲染；刷新按钮点击触发 refreshLinkPanel | T3/T4 |
| 6 | 打开文档：rail 行为与现状**完全一致**（大纲+链接+字数+滚动联动） | T1 |
| 7 | 打开画板：仍显示 noBoard 占位；无刷新按钮 | T1 |
| 8 | i18n 五语言 keys 一致（translation-keys 测试绿）；新组件测试覆盖 1-5 | T7 |

## 6. 非目标

- 不新增表格功能（列公式、关系列、多视图）——沿用 table-ux-notion 系列非目标；
- 不改反向链接的索引算法（P1 数据跟随项仅验证，不重写 Rust 索引）；
- 不做 rail 宽度的表格专属适配（复用 PanelToggle）；
- 不改表格编辑器本体（本系列只改 rail 侧 + 一个跳转请求通道）。

## 7. 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| `tableDraft` 高频变更（编辑中）导致 rail 每次 keystroke 重渲染 | 中 | 统计/列清单为轻量派生；防抖 200ms（对齐 OUTLINE_BODY_DEBOUNCE_MS）；行数/列数/列清单均为 `useMemo` |
| 列定位滚动与编辑器自身的水平滚动（sticky 列）冲突 | 中 | 定位走 `wrapRef.scrollLeft = colOffsetX - 边界`，预览先验证坐标；P0 冒烟用例覆盖 |
| `refreshLinkPanel` 对表格叶子的索引行为未验证 | 低 | T3 已降级为"P1 数据跟随项"，P0 不阻塞；失败时仅空态 |
| 新增 key 五语言漏同步 | 低 | `translation-keys.test.ts` 门禁 + 本系列提交前全量跑 |
| rail 与编辑器复用 `CHIP_STYLES` 产生跨文件耦合 | 低 | 仅复制色板常量（6 组）至面板，不导出内部实现 |

---

## 8. 交付物

- [ ] `src/components/knowledge/table/TableInfoPanel.tsx`（新）+ `TableInfoPanel.test.tsx`
- [ ] `KnowledgeOutlinePanel.tsx`：isDoc/isTable 判定、区块条件渲染、标题/刷新联动
- [ ] `KnowledgeWorkspace.tsx`：pendingOutlineJump 对 table 提前清空；新增 `requestTableColumnJump` 通道（store action + 定位逻辑）
- [ ] `knowledgeStore.ts`：`tableColumnJump` 状态或 action（最小面）
- [ ] i18n 五语言 `knowledge.tableInfo.*`
- [ ] 测试：`KnowledgeOutlinePanel.test.tsx` +5 用例（表格分支 × 4、画板回归 × 1）；跳转定位 1 用例
- [ ] e2e `knowledge-table.spec.ts`：打开表格 → rail 标题断言 + 列清单点击 → 列头 flash 断言（选择器 `table-col-flash`）
