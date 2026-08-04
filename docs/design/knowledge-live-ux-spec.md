# 知识库 Live 编辑体验 Spec v1.0

> 状态：**superseded · Live 引擎切换为 BlockNote** · 2026-08-04  
> 说明：自研 Milkdown chrome（A–D）体感仍不足；产品改用成熟开源 **BlockNote**（TipTap/PM）作为 Live。MD+FM 仍为磁盘真源（lossy 往返，产品接受）。Source CM6 仍为逃生。  


> 范围：知识库文档 **Live 编辑器**（Milkdown kit / ProseMirror）的交互手感、嵌套块模型、wiki/embed 一等公民、打开/切换性能；以及与 Source 模式、存储协议的边界。  
> 对标：Notion / 飞书文档 / FlowUS 的**日常写作手感**（非协作、非云数据库）。  
> 本文为知识库 Live UX 改进的**现行唯一 spec**。

---

## 0. 已确认决策

| # | 决策 | 选择 |
|---|------|------|
| D1 | 编辑引擎 | **BlockNote 0.52**（`@blocknote/core` + `react` + `mantine`）；Live host = `DocBlockNoteEditor`；Milkdown Live 降级为遗留代码（可删） |
| D2 | 存储真源 | **Markdown + YAML frontmatter**（`~/.hip/knowledge/`）；Live 为可视化层，序列化后写回 MD |
| D3 | Frontmatter | **进入 Live 前剥离，serialize 时回前缀**（既有策略，禁止改坏） |
| D4 | 问题定性 | 体感落后主因是 **块模型浅 + chrome/手感 MVP + wiki 非实体**，不是「选错了 Milkdown」 |
| D5 | 引擎替换门槛 | 仅当独立 spike 证明 **同一套 MD fixture round-trip ≥ 现状** 且有明确生态收益时，才重新评估；默认不做 |
| D6 | Source 定位 | Source（CM6）为 **大文档 / parse 失败 / 显式逃生**；日常写作默认 Live，弱化双模式心智 |
| D7 | 协作 | **不做** 多人实时、CRDT、评论云同步、分享 ACL（本版） |
| D8 | 数据库 | Collection 维持 frontmatter 表/看板；**不做** Notion 级 relation/rollup（另立项） |
| D9 | 多列布局 | **本版不做**（MD 表达差、成本高） |
| D10 | 交付节奏 | 分 Phase A→E；**A 可独立合并**；B/C 可并行准备 domain，但 UI 合入顺序 A→B→C；D 与 A 可部分并行 |
| D11 | 测试纪律 | domain 纯函数单测优先；关键路径扩 e2e（`knowledge-live*` / `knowledge-editor` / `knowledge-wiki`）；禁止只改 DOM 无序列化回归 |
| D12 | 包体 | 禁止引入 Crepe / `@milkdown/react`；Live 保持 lazy chunk；新增依赖需过 gzip 预算（软目标 Live 相关增量谨慎） |

本地桌面、单用户、可 grep/git 的 MD 文件，是产品约束，不是临时实现细节。

---

## 1. 问题摘要

| # | 问题 | 代码侧根因 | 用户体感 |
|---|------|------------|----------|
| P1 | 块操作只认顶层 | `blockOps.topLevelBlockAt` / `blockDrag` 仅 depth-1 | 列表项、引用内拖不动；不像飞书「万物皆块」 |
| P2 | 拖拽反馈简陋 | `opacity: 0.4` + `h-0.5` drop line；无 ghost / into | 落点飘、不自信 |
| P3 | Gutter 布局抢边 | gutter `left:0` + paper `px-8…16`；字符 `⋮⋮`/`+` | 握把抖、挡字、不精致 |
| P4 | Chrome 两套语言 | Bubble 手写 DOM glyph；Slash 为 React | 浮层风格不统一、缺 icon 体系 |
| P5 | Wiki 在 Live 是纯文本 | `[[` picker 有；无 mark/node + 点击跳转 | 写时像源码，读时才像链接 |
| P6 | Embed 读写分裂 | Reader 有 `KnowledgeEmbedCard`；Live 无对等 NodeView | `![[` 在 Live 难用 |
| P7 | 打开/切换成本 | `key={docId}-live` 整编辑器 destroy/create；Suspense 白块 | 闪一下、丢心流 |
| P8 | 大文档硬切 Source | `KNOWLEDGE_LARGE_DOC_CHARS = 512_000` | 突然变成源码编辑器 |
| P9 | 列表/缩进只补一点 | `listKeymap` 仅空 item Enter lift | Tab/整块缩进不如飞书 |
| P10 | Typography 难维护 | `DocLiveEditor` 超长 Tailwind class | 间距/字阶难对齐飞书阅读节奏 |
| P11 | Slash 能力够用但浅 | MD snippet `insert`；目录小于对标 | 插入后偶发结构怪、扩展靠字符串 |
| P12 | 无多块选择 | 仅单块 NodeSelection / 文本选区 | 不能一次挪多段 |

**非问题（本版不修）**：多人协作、云同步、完整数据库、移动端多端、换 TipTap 本身。

---

## 2. 产品定位

**本地优先的 Markdown 知识库 · 飞书向 Live 写作手感。**

| 做（本 Spec） | 不做（本 Spec） |
|---------------|-----------------|
| 加深 PM 块模型与 gutter/drag | 换编辑引擎（TipTap 等） |
| 统一 Live chrome（gutter / bubble / slash 视觉） | Crepe 全家桶 |
| Wiki / Embed 在 Live 一等公民 | 多列、同步块、完整 Notion DB |
| 打开路径与大文档策略改善 | 多人 CRDT / 在线评论 |
| Source 降为逃生舱 | 废弃 MD 真源或上 block-id 数据库替换全部文档 |

成功一句话：用户日常写笔记时，**不必想「这是 Markdown」**，也**不必切 Source**；文件落盘仍是干净 MD。

---

## 3. 现状架构（基线，勿无故推翻）

```
KnowledgeWorkspace
  ├─ SpaceTree
  ├─ Live → DocLiveEditor (Milkdown kit, lazy)
  │         ├─ commonmark + gfm + history
  │         ├─ liveBlockGutter / bubble / placeholder
  │         ├─ listItem / callout / code / table / image chrome
  │         ├─ slash + wiki picker (React overlay)
  │         └─ draft throttle 100ms → setDraftBody → autosave 500ms
  ├─ Source → DocEditor (CM6) + MarkdownToolbar
  └─ Board → HipBoardCanvas

真源: docs/*.md + tree.json + assets/  (Rust FS IPC)
```

关键路径（实现时保持契约）：

| 契约 | 说明 |
|------|------|
| FM strip/join | `splitYamlFrontmatter` / `joinYamlFrontmatter` |
| Draft 带 `docId` | 防切文档串写 |
| `flushDraft` | 切文档 / blur / Mod-s 前同步 serialize |
| Parse 失败 | `onParseError` → 本会话强制 Source，不写坏盘 |
| Round-trip | `mdRoundTrip` / `normalizeMd` 基线测试必须绿 |

参考：`src/components/knowledge/DocLiveEditor.spike.md`（kit GO、Crepe NO-GO、TipTap 曾因 MD 往返 Fair–poor 跳过）。

---

## 4. 目标体验（验收叙事）

相对 v1.0 实施前，用户应感到：

1. 鼠标移到段落，左侧握把稳定出现，不挡字、不抖。  
2. 拖块有影子与清晰落点；列表内外可放（Phase B）。  
3. `[[标题]]` 在 Live 是可点芯片，不是源码（Phase C）。  
4. 打开/切换文档无明显整页白屏与模式跳变（Phase A/D）。  
5. 日常长文尽量留在 Live；Source 是主动选择或故障逃生（Phase D）。

对标锚点（手感，非功能清单抄袭）：

| 场景 | 飞书/Notion 期望 | hip 目标 |
|------|------------------|----------|
| Hover 块 | 左侧 + / ⋮⋮ | 同左，固定 gutter 槽 |
| 拖块 | ghost + 蓝线/嵌套条 | ghost + drop 线 + into 竖条（B） |
| `/` | 分组菜单 + 图标 | 保持现有分组，icon 对齐 |
| 双链 | 实体 mention | wiki mark/node 芯片（C） |
| 选字 | 精致 bubble | icon bubble，统一浮层 |

---

## 5. 信息架构与布局

### 5.1 Live 文档列（Phase A 后）

```
┌─ KnowledgeDocCanvas (paper) ─────────────────────────────┐
│  InlineDocTitle                                            │
│  DocPropertiesRow                                          │
│  ┌─ gutter槽(~28–32px) ─┬─ ProseMirror content ─────────┐ │
│  │  [⋮⋮][+] on hover    │  blocks…                      │ │
│  │  (absolute in slot)  │  padding 与槽对齐，不重叠正文   │ │
│  └──────────────────────┴───────────────────────────────┘ │
│  浮层: slash / wiki / bubble / block menu / drop UI         │
└────────────────────────────────────────────────────────────┘
```

规则：

- Gutter **不**占用正文选区；hit 区在槽内。  
- Paper 水平 padding 调整为：`gutterSlot + contentPad`（替代「内容 padding 大、gutter 贴 0」）。  
- 滚动容器仍由 Workspace / Live scroller 所有（既有 scroll ownership 不改）。

### 5.2 浮层层级（z-index）

| 层 | 用途 | 既有/目标 class |
|----|------|-----------------|
| 40 | gutter、table/image chrome | `knowledge-live-block-gutter` 等 |
| 50 | drop line / into indicator | `knowledge-live-drop-line` |
| 60 | bubble | `knowledge-live-bubble` |
| 70 | block menu、slash、wiki | `knowledge-live-block-menu` 等 |

同时最多一个「主导菜单」（slash | wiki | block menu）；bubble 在菜单开时 `shouldShow=false`（既有 `menusOpenRef` 契约保留）。

---

## 6. Phase 划分

### Phase A — 手感补齐（优先合入）

**目标**：不改变块模型深度，把现有 top-level 能力做到「敢天天用」。

| ID | 项 | 要求 |
|----|-----|------|
| A1 | Gutter 槽位 | 固定左侧槽宽；hover 当前 top-level 块时握把垂直对齐块顶；离开块+菜单关则隐藏 |
| A2 | Hover 块底 | 扩展 `knowledge-live-block-selected` 或新增 `…-hover`：淡底，不影响选区颜色 |
| A3 | Grip/Plus 图标 | 替换纯文字 `⋮⋮`/`+` 为与 app 一致的 SVG/lucide 风格（尺寸 h-6 w-6） |
| A4 | Drag ghost | 超过 threshold 后：源块降透明 + 跟随指针的 ghost（可用 clone 截断宽度） |
| A5 | Drop 线 | 加粗/加长 inset；禁止 source 内部 gap；边缘自动滚动 scroller |
| A6 | Live 样式表 | 抽出 `knowledge-live.css`（或 module）：h1–h3/p/li/blockquote/code/table 间距与字阶；删 `DocLiveEditor` 巨型 class 串中的排版部分 |
| A7 | Bubble 视觉 | 统一 SVG icon、分隔线、active 态；link/turn 面板视觉与 slash 对齐 |
| A8 | 打开 skeleton | Suspense fallback 与标题行同结构高度，避免布局跳变 |
| A9 | Chunk 预热 | 进入知识库 surface 时预取 `DocLiveEditor` dynamic import（失败忽略） |

**A 明确不做**：嵌套拖、多选、wiki node、改 512k 阈值、换 serialize 策略。

**A 验收**：

- [ ] 连续 hover 20 个不同块，gutter 无错位、无残留 opacity  
- [ ] 顶层块上下拖 20 次，落点与 drop 线一致，无自重叠 no-op 误报为成功  
- [ ] 选中文字出现 bubble；开 slash 时 bubble 消失  
- [ ] 视觉：暗色/亮色主题下 icon 与 border 可读  
- [ ] 既有 `DocLiveEditor` / `knowledge-live*` 单测与 e2e 绿  
- [ ] MD round-trip 基线绿（A 不应改 serialize）

**主要改动面**：

- `blocks/liveBlockGutter.ts`、`domain/knowledge/blockDrag.ts`（仅反馈，算法可小改）  
- `blocks/liveBubblePlugins.ts`  
- `DocLiveEditor.tsx`、`KnowledgeDocCanvas.tsx` / Workspace 预热  
- 新建 live 样式资源  

---

### Phase B — 嵌套块与多选

**目标**：列表 / callout 等内部也可作为操作单元；支持多块批量操作。

| ID | 项 | 要求 |
|----|-----|------|
| B1 | `blockAt(pos, opts)` | 可解析「最近可操作块」：默认 prefer list_item → 否则 depth-1；单测覆盖嵌套 |
| B2 | Gutter 跟块 | hover 使用 B1；嵌套块 gutter 水平可轻微缩进指示 depth（可选 +4px/级，上限 2 级视觉） |
| B3 | Drop target v2 | `before` / `after` / **`into`**（合法父：list、blockquote/callout 等 schema 允许处） |
| B4 | Into 指示 | into 时左侧竖条（非仅 Y 横线） |
| B5 | `moveBlock` | 替换/扩展 `moveTopLevelBlock`；映射位置正确；undo 一次回退整次移动 |
| B6 | 多块选择 | grip 单击 = 该块选中高亮；Shift+click 扩展连续 top-level 范围；Delete/Backspace 删选区；拖 grip 移动整段 |
| B7 | Indent / Outdent | Tab / Shift-Tab：在 list 内走 schema lift/sink；非 list 的「变成子块」若 MD 无法表达则 **仅 list 路径**（禁止发明无法序列化的 indent attr） |
| B8 | Turn-into 对齐 | gutter 菜单与 bubble **同一** `TurnIntoTarget` 全集（含 list/task/code） |
| B9 | 菜单能力 | 保持 delete / duplicate / insert above|below；duplicate 多选时逐块 |

**B 序列化约束**：

- 任何 move/indent 结果必须能 `getMarkdown()` 且再 parse 结构等价（`normalizeMd`）。  
- 禁止引入无法表达为 GFM/现有 callout 约定的节点。

**B 验收**：

- [ ] 嵌套 list item 可拖到另一 list 的 before/after/into  
- [ ] callout 内段落可拖出为 top-level  
- [ ] 多选 3 个 top-level 一次下移  
- [ ] Tab 在 list 内缩进；非法位置不破坏文档  
- [ ] domain：`blockOps` / `blockDrag` 单测充足  
- [ ] e2e：新增或扩展 live 拖拽与多选用例  

**主要改动面**：

- `domain/knowledge/blockOps.ts`、`blockDrag.ts`、`turnInto.ts`  
- `blocks/liveBlockGutter.ts`  
- 必要时 list keymap 扩展（仍避免与 Milkdown 默认 Tab 双重绑定冲突）  

---

### Phase C — Live Wiki / Embed 一等公民

**目标**：写时的双链/嵌入与读时一致。

| ID | 项 | 要求 |
|----|-----|------|
| C1 | Wiki schema | PM **mark 或 atom/inline node**（二选一在实现前 spike 定案，见 §8） |
| C2 | Parse/serialize | `[[title]]`、`[[title\|alias]]`、可选 `[[#heading]]` 与现有 `wikiLink.ts` 语义对齐 |
| C3 | Wiki NodeView/MarkView | 芯片样式；未解析/坏链视觉区分；Cmd/Ctrl+click（及可发现的 click）导航 |
| C4 | 创建坏链 | 点击坏链 → 既有 `WikiCreateModal` 流 |
| C5 | Picker 写入 | `[[` 与 slash `wiki` 插入实体，而非仅裸文本（serialize 仍为 MD） |
| C6 | Bubble 链文档 | 链到空间文档时优先 wiki 语法，避免劣质 `wiki://` 残留（清理/收敛 `liveBubblePlugins` 现路径） |
| C7 | Embed | `![[target]]` Live NodeView：复用/抽取 `KnowledgeEmbedCard` 只读预览；深度上限与 Reader 一致 |
| C8 | 源码往返 | Source 编辑 wiki/embed 文本 → 切回 Live 正确实体化；Live 编辑 → Source 见标准 MD |

**C 验收**：

- [ ] fixture：wiki 各形式 round-trip  
- [ ] Live 点击已解析芯片触发导航（与 outline/backlink 同源 resolve）  
- [ ] 坏链可创建  
- [ ] embed 卡片在 Live 可见且不把嵌套 embed 递归炸深  
- [ ] e2e：`knowledge-wiki` 扩 Live 路径  

**主要改动面**：

- 新：`domain/knowledge/wikiPm.*` 或 milkdown `$node`/`$mark` 插件  
- `DocLiveEditor.tsx`、`WikiLinkPicker.tsx`、`blocks/*`  
- 共享 resolve：`wikiLink.ts`  

---

### Phase D — 性能与模式统一（可与 A 部分并行）

| ID | 项 | 要求 |
|----|-----|------|
| D1 | 预加载 | 见 A9；Workspace mount 知识库时触发 |
| D2 | Skeleton | 见 A8 |
| D3 | Draft 路径 | 保持 dirty + throttle；禁止恢复「每 tx 全量 markdownUpdated 无节流」 |
| D4 | 大文档策略 | 评估：提高阈值 **或** 分区/延迟 parse **或** 仍 Source 但 UI 说明更友好；改阈值需测 perf（`knowledge-perf`） |
| D5 | 模式 UI | 默认隐藏 Live/Source 切换；入口放到溢出菜单/设置；parse fail 时明确 toast + 一键 Source |
| D6 | Editor 复用（可选） | spike：`setContent`/replaceAll 切 doc 是否优于 remount；**必须**无泄漏、FM 正确、flush 不丢字；NO-GO 则保持 key remount |
| D7 | 序列化缓存（可选） | blur/save 全量 MD；输入路径可短缓存 PM 未变则跳过（已有 doc.eq 可加强） |

**D 验收**：

- [ ] 冷进知识库后首次打开文档的 Live 可交互时间不劣于基线（记录 `knowledgePerf`）  
- [ ] 切文档无草稿串写（docId 守卫单测）  
- [ ] 大文档行为有产品文案，非静默硬切  

---

### Phase E — 产品原语（按需立项，非本 v1.0 必达）

| 优先级 | 能力 | 备注 |
|--------|------|------|
| P1 | Toggle / 折叠标题 | 需 MD 约定（HTML comment / details）+ round-trip spike |
| P1 | `/` 最近使用 + Cmd+/ | 增强 slash，不改引擎 |
| P2 | 页面 icon / cover | frontmatter + 标题行 UI |
| P2 | 本地高亮/批注 mark | 无协作也可；序列化约定另写 |
| P3 | 多列 | 默认不做（D9） |
| P3 | 真数据库 | 另 spec |

E 任一能力开工前：补 **子 spec 或本文件修订** + fixture，禁止无协议上节点。

---

## 7. 交互详细规格

### 7.1 Gutter

| 输入 | 行为 |
|------|------|
| Pointer 在块行（内容或槽） | 显示该块 grip + plus |
| Click plus | 块后插入空段并打开 slash（既有 `openSlashAtTopLevelBlock` 语义扩展到当前块） |
| Click grip（未拖） | 打开 block 菜单；块高亮 |
| Drag grip > 4px | 进入拖拽；关菜单；ghost + drop 指示 |
| Escape | 关菜单、清块高亮 |
| 菜单外 mousedown | 关菜单 |

### 7.2 拖拽

| 规则 | 说明 |
|------|------|
| Threshold | 4px（既有） |
| Top-level only（A） | 与现网一致 |
| Nested（B） | `findDropTarget` 返回 `{ kind: 'before'\|'after'\|'into', pos, clientPoint }` |
| 非法 into | 不显示 into；可回退 before/after |
| Drop 完成 | 单 transaction；`scrollIntoView`；focus 保持 |
| Undo | 一次 undo 恢复移动前 |

### 7.3 多选（B）

| 规则 | 说明 |
|------|------|
| 范围 | 仅连续 depth-1 兄弟（v1）；嵌套多选可后续 |
| 与文本选区 | 开始块多选时取消文本选区；输入键取消多选并交还 PM |
| 批量拖 | 以选区最上块为源范围整体 move |

### 7.4 Bubble

| 规则 | 说明 |
|------|------|
| 显示 | 非空文本选区且菜单未开（既有 `knowledgeBubbleShouldShow`） |
| 工具 | bold/italic/strike/code、H1–3、link、turn-into、lists、fence、clear（可分组） |
| Link | URL + 空间文档搜索；文档命中写入 wiki 形式（C） |
| Escape | 隐藏 bubble |

### 7.5 Slash / Wiki picker

- 目录仍以 `slashMenu.ts` 为唯一源；A 只改呈现。  
- Wiki 查询优先级：既有「`[[` 胜于 `/`」。  
- IME composing 时不删 token、不强制 insert（既有）。

### 7.6 键盘（增量）

| 键 | 行为 | Phase |
|----|------|-------|
| Mod-s | flush + save | 已有 |
| Enter 空 list item | lift | 已有 |
| Tab / S-Tab | list sink/lift | B 对齐/加固 |
| Mod-Alt-1..3 | 标题（若 Live 未绑则补到与 Source 对称） | A/B |
| Escape | 层叠关闭：menu → picker → bubble | 已有，回归 |

---

## 8. Wiki schema 选型（C 前必做微型 spike）

时间盒：≤1 天。输出写回本小节「结论」行。

| 方案 | 优点 | 风险 |
|------|------|------|
| **Inline atom node** | 点击/样式干净；不可部分编辑坏芯片 | 输入法/光标在边界需小心；serialize 自定义 |
| **Mark** | 更接近 link；编辑 alias 自然 | 坏链与部分选中复杂 |

**通过标准**：

1. 十组 wiki fixture round-trip（含 alias、CJK、坏链、标题锚点若支持）。  
2. 与 FM strip 共存。  
3. 不把 `[[` 误吃进 code fence。  
4. gzip/行为不引入 Vue/Crepe。

**结论**：**Decoration 方案（非 mark/atom node）** — Live 保留 `[[…]]` 纯文本 PM 内容，用 `Decoration.inline` 绘制芯片并处理 click 导航（`liveWikiDecorations.ts` + `wikiPm.ts`）。  
理由：MD round-trip 零 serializer 风险；与 FM strip 共存；不引入自定义 schema 节点；坏链/已解析样式与 Reader 语义对齐。若后续需要芯片内编辑 alias，可再评估 mark。

---

## 9. 非目标与反模式

| 禁止 | 原因 |
|------|------|
| 一步迁移 TipTap/BlockNote/Lexical | 换壳不解决 P1–P6；MD 往返重验证成本高 |
| 引入 Crepe / `@milkdown/react` | 包体 spike 已 NO-GO |
| 静默「normalize」用户 MD 后写盘改变原意 | 仅允许 Live 路径已知 canonical 化；Source 用户内容尊重 |
| 为 Notion 对齐引入全局 block id 库替换 MD | 破坏 local MD 工作流；若需要则新叶子类型另立 |
| 无 fixture 的自定义节点 | 必挂 parse/serialize 测试 |
| 在 Agent/Chat 面塞完整文档编辑 | 范围外 |

---

## 10. 测试计划

### 10.1 单测（Vitest）

| 区域 | 文件（现有/新增） |
|------|-------------------|
| 块解析/移动 | `blockOps*.ts`、`blockDrag*.ts` |
| Turn-into | `turnInto` 相关 |
| List exit / indent | `listKeymap*.ts` |
| Wiki PM | 新 `wikiPm*.test.ts` + 扩 `wikiLink` |
| Round-trip | `mdRoundTrip*.ts` 增 wiki/embed/nested move 后再 serialize |
| Draft/docId | `knowledgeStore` / `DocLiveEditor` 既有守卫 |
| 选择/bubble | `liveSelection*.ts` |

### 10.2 E2E

| 场景 | 建议 |
|------|------|
| Gutter hover + menu | 扩 `knowledge-live*.spec.ts` |
| Top-level drag | 新或扩 live-r5 |
| Nested drag / multi-select | B 交付时新 spec |
| Wiki chip 导航 | 扩 `knowledge-wiki.spec.ts` |
| Perf 冒烟 | `knowledge-perf.spec.ts` 对比不劣化 |

### 10.3 手工狗粮清单（每 Phase 合并前）

- [ ] 中文 IME 下 slash / wiki  
- [ ] 暗色主题 chrome  
- [ ] 快速连点切换 5 篇文档无串内容  
- [ ] 含 table / task / mermaid 的旧文档打开不炸  
- [ ] parse 失败文档 → Source → 修好 → 可回 Live  

---

## 11. 实施顺序与 PR 切片建议

```
PR-A1  gutter 槽 + hover 底 + icon          (A1–A3, A6 可拆)
PR-A2  drag ghost + drop + autoscroll       (A4–A5)
PR-A3  bubble icon + 浮层视觉               (A7)
PR-A4  skeleton + preload                   (A8–A9, D1–D2)
PR-B1  blockAt + 单测                       (B1)
PR-B2  gutter 跟嵌套 + drop v2 + move       (B2–B5)
PR-B3  multi-select + indent                (B6–B7)
PR-B4  turn-into 对齐 + e2e                 (B8–B9)
PR-C0  wiki schema spike 结论               (§8)
PR-C1  wiki mark/node + serialize           (C1–C2, C5)
PR-C2  chip UI + 导航 + 坏链                (C3–C4, C6)
PR-C3  embed Live + e2e                     (C7–C8)
PR-D*  大文档/模式/复用 spike 按需          (D3–D7)
```

合并门禁：类型检查 + 相关 vitest + 触及 e2e 绿；不强制一次跑全量付费 eval。

---

## 12. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 嵌套 move 搞坏 list 结构 | 纯函数先测；e2e；feature 可 transient flag |
| Wiki node 光标陷阱 | spike 选 mark vs node；边界测左右方向键 |
| 样式抽取回归 | 对照截图/手工狗粮；保留 testid |
| 预加载浪费带宽 | 仅 knowledge surface；idle 或 requestIdleCallback |
| Editor 复用泄漏 | D6 默认 NO-GO；有泄漏立即回 remount |
| 范围膨胀到「做 Notion」 | D7–D9；E 必须另批 |

---

## 13. 成功指标

| 指标 | 基线 | 目标（A+B+C 后） |
|------|------|------------------|
| 顶层拖拽可信度 | 能用但糙 | 狗粮「不假想落点」 |
| 嵌套块可操作 | 基本无 | list/callout 内可 gutter+拖 |
| Live 内 wiki | 文本+picker | 芯片+导航+round-trip |
| 切文档丢字 | 有守卫 | 保持 0 事故（单测+e2e） |
| 无意义 Source 切换 | 大文档/双模式显眼 | 日常路径不出现 |
| 引擎迁移 | — | **不发生**（D1） |

主观指标：内部试用对照飞书写一篇同等长度会议纪要，收集「卡点列表」；A 后卡点应显著转向「缺高级块」而非「握把/拖拽/链接难用」。

---

## 14. 关键文件索引

| 路径 | 角色 |
|------|------|
| `src/components/knowledge/DocLiveEditor.tsx` | Live host |
| `src/components/knowledge/blocks/liveBlockGutter.ts` | gutter / drag UI |
| `src/components/knowledge/blocks/liveBubblePlugins.ts` | 选区 bubble |
| `src/components/knowledge/KnowledgeWorkspace.tsx` | 模式/挂载/预热 |
| `src/components/knowledge/KnowledgeDocCanvas.tsx` | paper chrome |
| `src/domain/knowledge/blockOps.ts` | 块 CRUD |
| `src/domain/knowledge/blockDrag.ts` | drop/move |
| `src/domain/knowledge/slashMenu.ts` | slash 目录 |
| `src/domain/knowledge/wikiLink.ts` | wiki 语义 |
| `src/domain/knowledge/turnInto.ts` | turn-into |
| `src/domain/knowledge/listKeymap.ts` | list Enter |
| `src/domain/knowledge/limits.ts` | 大文档阈值等 |
| `src/store/knowledgeStore.ts` | draft/autosave/tree |
| `src/components/knowledge/DocLiveEditor.spike.md` | 引擎选型历史 |
| `e2e/specs/knowledge-live*.spec.ts` 等 | e2e |

---

## 15. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-08-04 | 初稿：确认不换 TipTap；Phase A–E 完整方案；决策 D1–D12 |
| v1.1 | 2026-08-04 | 落地 A–D：gutter/drag/bubble CSS、blockAt/drop into/multi-select、wiki decorations、preload/skeleton/大文档横幅；§8 结论 = Decoration；E 未做；D6 editor 复用保持 remount |
| v2.0 | 2026-08-04 | **引擎切换**：Live → BlockNote（Notion 级 slash/side-menu/bubble 开箱）；D1 修订；host `DocBlockNoteEditor.tsx`；Workspace lazy 指向 BlockNote |

---

## 16. 开放问题

| # | 问题 | 默认倾向 | 关闭条件 |
|---|------|----------|----------|
| Q1 | Wiki 用 mark 还是 atom node？ | **Decorations（已关闭）** | §8 |
| Q2 | 大文档是提高 512k 还是更好降级 UI？ | **横幅 + toast，阈值不动（已关闭）** | D4 |
| Q3 | Editor 是否复用实例？ | **保持 remount（已关闭）** | D6 |
| Q4 | Toggle 标题是否进 v1.1？ | E P1，不进 A–C 必达 | 产品排期 |
| Q5 | 多选是否要支持非连续？ | v1 仅连续 | 有强需求再开 |

---

## 17. 一页纸摘要

- **不换引擎**，在 Milkdown kit 上把 Live 做到飞书向手感。  
- **先 A（手感）→ B（嵌套块/多选）→ C（wiki/embed 实体）**，D 性能并行，E 按需。  
- **MD 仍是真源**；一切新节点必须 round-trip。  
- **Source** 降为逃生；**协作/多列/真 DB** 不在范围。  
- 交付以 **单测 + e2e + 狗粮清单** 门禁，禁止只改皮。
