# Knowledge Base Upgrade Spec（非 AI）

> Status: **approved for implementation**  
> Date: 2026-07-19  
> Plan: [`docs/knowledge-upgrade-plan.md`](./knowledge-upgrade-plan.md)  
> Baseline: hip local-first knowledge (`src/domain/knowledge/*`, `src/store/knowledgeStore.ts`, `src-tauri/src/knowledge.rs`)  
> Comparators (capability only): SiYuan (local PKM), Notion (structured workspace)  
> **Explicit exclusion:** Agent tools、会话沉淀、RAG、@知识库注入、Memory 打通、任何 LLM 读写知识库能力（另立文档，不在本 spec）

---

## 1. Problem

hip 知识库已具备：多 space、树形文件夹/文档、Markdown 真源、Live/Source/Preview、`[[wiki]]`、轻量 frontmatter（tags/status/aliases）、MiniSearch、附件、模板、版本快照、导入导出。

相对成熟 PKM / 笔记工作台，用户侧仍缺：

1. **链接网络不完整** — 只有正向 wiki 解析，无反链、出链诊断、图谱、嵌入。
2. **结构化能力极薄** — 无属性类型扩展、无集合/多视图（表/看板）。
3. **编辑与媒体天花板偏低** — 无公式/图表、callout/toggle 约定、PDF/HTML 导出、嵌套 assets、剪藏。
4. **生命周期与边界能力弱** — 无版本 diff、无外部文件夹挂载/同步友好策略、无加密 space、无发布。

目标：在 **不引入 AI 能力** 的前提下，分阶段把知识库从「本地 Markdown 笔记 + 轻量 wiki」升级为「可链接、可查询、可结构化」的个人知识库，同时保持 **Markdown 文件为真相源（SoT）** 与可移植性。

---

## 2. Goals / Non-goals

### Goals

| ID | Goal |
|----|------|
| G1 | 文档级链接网络：反链、出链、断链、简易图谱 |
| G2 | 渐进式锚点：先标题锚，再可选块锚；支持嵌入预览 |
| G3 | 扩展文档属性 + 集合视图（表/看板），数据仍落在 MD frontmatter |
| G4 | 富媒体与版式约定（math/mermaid/callout/toggle），导出增强 |
| G5 | 资源、历史、导入导出体验补齐到「日常可用」 |
| G6 | 可选：外部目录同步友好、加密 space、静态发布（按里程碑决策） |

### Non-goals（本 spec 全程）

- Agent / sidecar `knowledge_*` 工具、会话写回知识库、@文档注入、embedding/RAG
- Memory 系统与知识库合并或双向自动同步
- 真块编辑器 / 重写为 SiYuan `.sy` AST 存储
- 完整 Notion formula / rollup / relation 数据库
- 实时多人协作、评论、权限、分享链接
- 自建云同步服务 / CRDT
- 闪卡间隔重复、OCR、移动端原生 App（可列 Future，不进里程碑承诺）
- 插件市场式知识库扩展协议（本阶段不做）

---

## 3. Baseline（当前行为，不得无故破坏）

### 3.1 磁盘布局

```
<knowledge_dir>/                    # paths::knowledge_dir
├── index.json                      # spaces[]
└── <spaceId>/
    ├── tree.json                   # nodes: folder | doc
    ├── docs/<docId>.md
    ├── assets/<ast_…_name.ext>     # 当前仅单层文件名
    ├── templates/ + templates.json
    └── versions/<docId>/…
```

### 3.2 已有语义（须保持兼容）

| 能力 | 行为 |
|------|------|
| Wiki | `[[Title]]` / `[[Title\|Disp]]`；title + aliases 解析；断链可创建 |
| Frontmatter | 仅识别 `tags` / `status` / `aliases`；未知 key 的 bare `---` 不视为 FM |
| 搜索 | MiniSearch，CJK 分字，tag/status 过滤 |
| 编辑 | Live / Source / Preview；Live 不吃 FM（strip/join） |
| 导出 | 单 doc MD；space portable zip（tree + docs + assets） |
| 限制 | 大文档 ~512KB 守卫；版本 cap 30；asset 磁盘 25MB / IPC base64 1.5MB |

### 3.3 兼容性承诺

- 旧 space 打开无需用户迁移脚本；新功能以 **派生索引 + 向后兼容语法** 交付。
- Portable zip 导入旧格式仍可用；新字段可选。
- 不强制用户把 wiki 全部改成新语法。

---

## 4. Design principles

1. **Markdown is SoT** — 文档正文与 frontmatter 在磁盘可读；索引/图谱/集合是派生层。
2. **No block engine rewrite** — 不引入 SiYuan 式块库；锚点用 heading / 轻量 ID 约定。
3. **Index on write** — 链接与属性索引在保存/导入/重建时更新，不靠每次冷扫全库作为主路径。
4. **Portable first** — 语法优先选 CommonMark/GFM 或广泛接受的 MD 方言（Obsidian-like）；专有协议仅作内部预览 href。
5. **Phase gates** — 每阶段有可演示验收标准；未验收不启动下一阶段主路径。
6. **Surgical product surface** — UI 优先侧栏/属性行/命令，不做第二套「笔记 OS」。

---

## 5. Capability map by phase

| Phase | Theme | Ships when… |
|-------|--------|-------------|
| **P0** | 持久链接/属性索引（SQLite） | 保存文档后反链查询 O(命中边) 且正确 |
| **P1** | 链接网络 UX | 反链面板 + 出链/断链 + 标题锚 wiki |
| **P2** | 嵌入 + 图谱 | `![[…]]` 只读嵌入 + 简易图谱 |
| **P3** | 属性扩展 | 类型化 FM + 属性编辑 UI |
| **P4** | 集合视图 | 表视图 + 看板（按 status） |
| **P5** | 编辑与媒体 | math/mermaid/callout/toggle + 资源增强 |
| **P6** | 导出与历史 | PDF/HTML、版本 diff |
| **P7** | 边界能力（可选） | 外部文件夹、加密、静态发布 |

P0 是 P1–P2 的硬依赖。P3 是 P4 的硬依赖。P5–P7 可与 P3/P4 部分并行，但不得阻塞 P1 验收。

---

## 6. Phase specs

### P0 — Link & meta index（基础设施）

#### 6.0.1 问题

今日 wiki 解析与搜索元数据主要在渲染/内存 MiniSearch；全库反链需要反复扫 body，规模与正确性不足。

#### 6.0.2 方案

每个 space 维护派生索引文件（推荐）：

```
<spaceId>/
└── .hip/
    ├── index.sqlite        # ★ 派生链接/属性索引（可删可重建）
    ├── schema.json         # P3+ 属性 schema（进 git）
    └── views.json          # P4+ 集合视图（进 git）
```

**已决议：直接 SQLite**（`rusqlite` bundled），不做 JSON 过渡层。解析在 TypeScript；Rust 只负责持久化与查询。

#### 6.0.3 索引内容（逻辑模型）

```sql
-- schema_version = 1
docs(
  doc_id PK, title, aliases_json, tags_json, status,
  props_json, content_hash, updated_at
)
links(
  id PK, from_doc_id, kind, /* wiki|embed|md */
  raw, target_title, target_doc_id NULL, fragment, display
)
CREATE INDEX idx_links_target ON links(target_doc_id);
CREATE INDEX idx_links_from ON links(from_doc_id);
```

```ts
type OutboundLink = {
  kind: 'wiki' | 'md' | 'embed'
  raw: string
  targetTitle: string | null
  targetDocId: string | null
  fragment: string | null
  display: string | null
}
```

**Inbound** 由 `links.target_doc_id` 查询，不单独物化表。

#### 6.0.4 更新时机

| 事件 | 行为 |
|------|------|
| `write_doc` 成功 | 增量更新该 doc 的 meta + outbound |
| rename 文档标题 / 改 aliases | 更新 meta；**不**强制重写其他文件内 wiki 字符串（标题解析仍按当前 title/alias） |
| delete doc | 移除 docs 条目；其他 doc outbound 中指向它的保持 `targetDocId: null` 或悬空直至下次打开重解析 |
| import folder / import portable | 全量 rebuild space |
| 手动「Rebuild index」 | 全量 rebuild |
| 索引缺失或 version mismatch | 打开 space 时后台 rebuild |

#### 6.0.5 API（IPC 或 store 层）

最小查询面（实现可先 store-only，后下沉 Rust）：

- `rebuildLinkIndex(spaceId)`
- `getBacklinks(spaceId, docId) → { fromDocId, raw, kind, fragment }[]`
- `getOutbound(spaceId, docId) → OutboundLink[]`
- `getBrokenLinks(spaceId) → { fromDocId, raw }[]`
- `listDocsMeta(spaceId) →` title/aliases/tags/status/props

#### 6.0.6 验收

- [ ] 保存含 `[[Other]]` 的 A 后，B=Other 的 backlinks 含 A
- [ ] 删除 A 后，B 的 backlinks 不再含 A
- [ ] 断链 `[[Missing]]` 出现在 broken list
- [ ] 删除 `.hip/link-index.json` 后打开 space 自动恢复
- [ ] 旧 space 无 `.hip/` 时行为与今日一致（无反链 UI 前静默建索引）

---

### P1 — Link network UX

#### 6.1.1 反链面板

- 位置：右侧知识库大纲旁 **Backlinks** 段（或 Outline 下折叠区）；文档打开时显示。
- 每条：来源 doc 标题、路径面包屑、可选上下文 snippet（命中行 ±N 字，cap 160 chars）。
- 点击：打开来源文档并滚动到链接位置（能定位则定位；否则打开文档顶部）。
- 空态：文案说明「其他文档用 `[[本标题]]` 引用后会出现在这里」。

#### 6.1.2 出链面板

- 当前文档 outbound 列表：已解析 / 断链分组。
- 断链：一键「创建并链接」（复用现有 WikiCreate 流）或「复制标题」。

#### 6.1.3 标题锚 wiki

扩展 wiki 语法（**加性**）：

| 语法 | 含义 |
|------|------|
| `[[Title]]` | 现有：整文档 |
| `[[Title#Heading text]]` | 文档 + ATX 标题（匹配规则见下） |
| `[[Title#Heading\|Disp]]` | 显示文本 + 标题锚 |
| `[[#Heading]]` | 当前文档内标题（仅预览/Live 跳转） |

**标题匹配规则（规范）：**

1. 对目标文档 body（去 FM）提取 ATX headings（与 `extractDocOutline` 一致，忽略 fenced code 内假标题）。
2. 匹配顺序：精确文本 → trim 后精确 → case-insensitive → slug 相等（`slugifyHeading` 与预览 heading id 同一函数）。
3. 多个同名标题：取文档中 **第一个**（与 wiki 重名 title 策略一致）。

预览 href：可扩展为 `./__wiki__/Title#slug` 或保留内部协议；须仍通过 react-markdown url 规则。

#### 6.1.4 验收

- [ ] 反链面板正确、可导航
- [ ] 出链区分 resolved/broken
- [ ] `[[Doc#H]]` 预览点击落到对应 heading
- [ ] 无 `#` 的旧链接行为不变
- [ ] e2e：至少 KW 扩展用例 + 反链 smoke

---

### P2 — Embeds & graph

#### 6.2.1 嵌入语法

| 语法 | 行为 |
|------|------|
| `![[Title]]` | 只读嵌入目标文档 body（去 FM），外框可折叠 |
| `![[Title#Heading]]` | 嵌入从该 heading 起到下一同级/更高级 heading 前 |
| `![[Title\|Disp]]` | 嵌入标题栏显示 Disp |

**约束：**

- **只读**：嵌入区不可直接编辑被嵌文档（点击标题可打开源文档）。
- **深度**：默认 max depth = 1（嵌入内不再展开嵌入，显示占位「嵌套已省略」），防环。
- **环检测**：A⊃B⊃A 显示错误占位，不崩溃。
- **大小**：嵌入 body cap 与 `KNOWLEDGE_INDEX_BODY_CHARS` 对齐或更严（建议 64KB 渲染 cap）。
- Source 模式：显示原始 `![[…]]` 文本；Live/Preview 渲染嵌入。

#### 6.2.2 简易图谱

- 入口：space 工具栏「Graph」。
- 节点：文档；边：wiki / embed（md 普通链接可选第二期）。
- 交互：点击节点打开文档；当前文档高亮；搜索过滤节点。
- 实现：可用轻量 force-graph 或现有 DAG 视觉库子集；**首版允许静态布局**（按出度/字母）若动画成本高。
- 规模：>500 节点时默认只渲染「当前文档 1 跳邻域」+ 「显示全图」确认。

#### 6.2.3 验收

- [ ] `![[Doc]]` Preview/Live 可见嵌入内容
- [ ] 环与超深嵌套安全降级
- [ ] 图谱能打开邻接文档
- [ ] portable zip **可不包含** `.hip/`；导入后 rebuild 可恢复图谱

---

### P3 — Extended properties

#### 6.3.1 目标

在保持 YAML frontmatter 手写友好的前提下，扩展结构化字段，并提供属性行 UI。

#### 6.3.2 保留兼容

现有键不变：

- `tags: string[]`
- `status: string | null`
- `aliases: string[]`

#### 6.3.3 新增内置类型（v1）

| Key（示例） | 类型 | UI |
|-------------|------|-----|
| `tags` | multi-select strings | 已有 chips |
| `status` | select string | 已有 |
| `aliases` | string[] | 已有 |
| `date` | ISO date `YYYY-MM-DD` | date input |
| `priority` | select: `low\|medium\|high`（可选，非强制 schema） | select |
| 自定义 | 见 schema | |

**自定义属性（v1 范围）：**

- 仅支持：`string` | `number` | `date` | `select` | `multi-select` | `url` | `checkbox`
- **不支持** v1：formula、rollup、relation 双向同步、person、file property（附件仍走 MD 链接）

#### 6.3.4 Space schema 文件

```
<spaceId>/.hip/schema.json
```

```ts
type SpaceSchemaV1 = {
  version: 1
  properties: Array<{
    key: string           // yaml key; [a-z][a-z0-9_]*
    type: 'string' | 'number' | 'date' | 'select' | 'multi-select' | 'url' | 'checkbox'
    label?: string
    options?: string[]    // select / multi-select
    // built-ins tags/status/aliases may be omitted; engine still recognizes them
  }>
}
```

- 无 schema 时：仅解析内置三键 + 宽松读取其他 flat 标量（搜索可选索引 string 化）。
- UI「添加属性」写入 schema + 当前文档 FM。

#### 6.3.5 解析/序列化规则

- 继续手写 YAML 子集（不引入完整 YAML 1.2 引擎，除非现有解析不够用）。
- 未知 key：若在 schema 中则按类型校验；不在 schema 则 **保留原样 round-trip**（不删除用户手写键）。
- Live 编辑仍 strip/join 整个 FM 不透明块；属性 UI 改的是 FM 文本再 join。

#### 6.3.6 搜索

- MiniSearch / meta 过滤：tags/status 保持；P3 增加按 schema 字段的 facet 过滤（至少 select / tags / date range 其一）。
- link-index 的 `props` 与之一致。

#### 6.3.7 验收

- [ ] 属性行编辑 `date` / 自定义 select 写回 FM 且 Source 可见
- [ ] 手写未知 key 不被属性 UI 抹掉
- [ ] 过滤：按新 select 字段筛选文档列表/搜索
- [ ] Live 往返不破坏 FM

---

### P4 — Collection views

#### 6.4.1 概念

**Collection** = 一空间内的文档子集 + 视图配置，**不是**新存储实体类型。

子集来源（v1 任选其一生效，可组合 AND）：

- 指定 folder 子树（含后代 doc）
- 或 `tag == X`
- 或 schema 过滤表达式的简化版：`status is set` / `status == draft` / `tag has x`

视图配置存：

```
<spaceId>/.hip/views.json
```

```ts
type ViewsFileV1 = {
  version: 1
  views: Array<{
    id: string
    name: string
    filter: ViewFilter
    layout: 'table' | 'board'
    // table
    columns?: string[]          // property keys
    sort?: { key: string; dir: 'asc' | 'desc' }[]
    // board
    boardGroupKey?: 'status' | string  // select-like key
    boardColumnOrder?: string[]
  }>
}
```

#### 6.4.2 Table view

- 行 = 文档；列 = 属性；标题列固定可点开文档。
- 单元格编辑写回该 doc FM（与属性行同一写入路径）。
- 支持按列排序；筛选沿用 filter。

#### 6.4.3 Board view

- 分组键：任意 schema 中 `type === 'select'` 的字段；**默认** `status`。
- multi-select / tags **不可**作看板分组（仅表筛选）。
- 空值 →「No status」/「(empty)」列。
- 拖拽卡片改分组字段并写回 FM。
- 列顺序：`boardColumnOrder` ∪ 实际出现值。

#### 6.4.4 非目标（P4）

- Calendar / Timeline / Gallery
- Linked database 多处镜像同一 filter 的复杂同步
- 跨 space 集合

#### 6.4.5 验收

- [ ] 创建「文件夹 X 的表视图」，列显示 tags/status/date
- [ ] 表内改 status，文档 FM 与反链索引 meta 更新
- [ ] 看板拖拽改 status
- [ ] 删除视图不影响文档文件

---

### P5 — Editor & media

#### 6.5.1 Math

- 语法：GFM/Pandoc 风格 `$inline$` / `$$block$$`（实现选 KaTeX）。
- Preview + Live 渲染；Source 纯文本。
- 无网络字体依赖策略：打包或系统回退写明。

#### 6.5.2 Mermaid

- 语法：` ```mermaid ` fence。
- Preview 渲染；Live 可先 Preview 等价或只读块。
- 渲染失败显示源码 + 错误一行。

#### 6.5.3 Callout / Toggle（可移植约定）

采用 GitHub/Obsidian 常见方言，避免专有 XML：

```md
> [!note] Optional title
> body

> [!warning]
> body
```

Toggle（v1 可选，若成本高可降为 P5.1）：

```md
<details>
<summary>Title</summary>

body

</details>
```

或

```md
> [!toggle] Title
> hidden body
```

**决策默认：** callout 用 `[!type]`；toggle 用 HTML `<details>`（GFM 允许、导出友好）。

#### 6.5.4 Slash 扩展

在现有 `KNOWLEDGE_SLASH_ITEMS` 增加：`callout`、`mermaid`、`math`（插入骨架）、可选 `details`。

#### 6.5.5 Assets

| 项 | 行为 |
|----|------|
| 嵌套目录 | 允许 `assets/<sub>/file`（path traversal 仍 `safe_join`） |
| MIME | 增加常见音视频？**v1 仅** 现有图片+PDF；音视频链为文件链接不预览 |
| 附件面板 | space 级列出 assets，显示引用计数（来自 link-index md links）可选 |

#### 6.5.6 验收

- [ ] 公式与 mermaid 在 Preview 正确
- [ ] callout 样式可辨
- [ ] 嵌套 asset 路径导入与预览
- [ ] Live 包体不明显失控（延续 kit 路线，不引入 Crepe）

---

### P6 — Export & history UX

#### 6.6.1 导出

| 目标 | 方案 |
|------|------|
| HTML | 内置 MD→HTML（可复用预览管线 + 基础 CSS）；单 doc / 可选 space |
| PDF | 优先 **系统打印 HTML** 或 headless 打印；不强制捆绑完整 Pandoc 除非已有运维路径 |
| Word | **非 v1**；Future |

导出须处理：本地 assets 相对路径解析、wiki 链转相对 HTML 链接或纯文本标题。

#### 6.6.2 版本

- 版本列表旁 **Diff**：当前 draft vs 选中版本（line-based，可用既有 diff 组件）。
- 保留 cap 30；可选「导出该版本」。

#### 6.6.3 验收

- [ ] 单文档导出 HTML 可离线打开且图片可见
- [ ] 版本 diff 能看出增删行
- [ ] 大文档 diff 有超时/截断保护

---

### P7 — Boundary features（可选里程碑）

以下 **默认不进入 MVP 承诺**；评审通过后再排期。

| ID | 特性 | 简述 | 风险 |
|----|------|------|------|
| P7a | Open folder as space | 用户选目录，要求/生成 `tree.json` 或扫描 `**/*.md` 生成树 | 与「id 文件名」模型冲突，需设计 human-path 模式 |
| P7b | Sync-friendly | 文档化「知识库目录可放 iCloud/Syncthing」；冲突时 mtime 提示 | 无真合并 |
| P7c | Encrypted space | space 级加密 docs（密钥在系统 keychain 或用户口令） | 复杂度高；可参考思源 encrypted notebook，但实现独立 |
| P7d | Static publish | 导出 space 为静态站点目录 | 与 P6 HTML 相关 |

**P7a 若做，必须单独 ADR：** 今日 `doc_*.md` id 文件名 vs 用户可读文件名，二选一或双模。

---

## 7. Wiki / link syntax normative summary

| Form | Phase | Resolves to |
|------|-------|-------------|
| `[[Title]]` | existing | doc by title/alias |
| `[[Title\|Disp]]` | existing | same + display |
| `[[Title#Heading]]` | P1 | doc + heading |
| `[[#Heading]]` | P1 | current doc heading |
| `![[Title]]` | P2 | embed doc |
| `![[Title#Heading]]` | P2 | embed section |
| `[text](url)` | existing | md link; indexed as outbound `md` |
| `^block-id` / `[[Title^id]]` | **Future** | 块锚；本 spec 不实现 |

**明确不做（本 spec）：** 块级双向引用、嵌入查询（SQL embed）、同步块（Notion synced block）。

---

## 8. UI 信息架构（增量）

```
Knowledge Home
  └─ Space workspace
       ├─ Tree (existing)
       ├─ Doc canvas (existing)
       │    ├─ Properties row (P3 expand)
       │    ├─ Editor modes (existing)
       │    └─ Embeds in Preview/Live (P2)
       ├─ Right panel
       │    ├─ Outline (existing)
       │    ├─ Backlinks (P1)
       │    └─ Outbound (P1)
       ├─ Views (P4) — tab or sidebar entry "Views"
       └─ Graph (P2) — modal or full canvas route
```

命令面板增加：Open Graph、Rebuild Index、New Table View（P4）。

---

## 9. Data & migration

| 路径 | 兼容 |
|------|------|
| `index.json` / `tree.json` / `docs/*.md` | 不变 |
| `.hip/link-index.json` | 可删可重建；**export zip 默认排除** `.hip/`（或可选 include） |
| `.hip/schema.json` / `views.json` | 可选；缺省 = 内置行为 |
| 旧 FM | 继续工作 |
| 新 FM 键 | 旧版本 hip 忽略未知键（已有行为） |

**迁移：** 无破坏性迁移。首次打开 space 触发 P0 rebuild。

---

## 10. Testing strategy

| 层 | 要求 |
|----|------|
| Unit | wiki 扩展解析、heading 匹配、embed 环检测、FM schema round-trip、filter |
| Store | index 增量更新、backlinks 查询 |
| Component | Backlinks 面板、Table/Board 交互 |
| e2e `@knowledge` | P1 反链+锚点；P2 嵌入；P4 看板改 status 落盘 |
| 兼容 | 无 `.hip` 的旧 fixture space 全流程绿灯 |

Paid LLM：**无**（本 spec 无 AI）。

---

## 11. Performance budgets

| 场景 | 目标 |
|------|------|
| 增量更新单文档索引 | < 50ms @ 100KB body（主线程可 yield） |
| 打开文档展示反链 | < 100ms @ 2k docs space（索引已热） |
| 全量 rebuild | 2k docs 可接受后台进行；UI 有 progress（可复用 indexProgress 模式） |
| 图谱全图 | >500 nodes 默认邻域模式 |
| 嵌入渲染 | 单页同时嵌入 ≤ 20；超出折叠 |

---

## 12. Security & safety

- 所有路径继续 `safe_join`；嵌套 assets 禁止 `..`。
- 嵌入与 HTML 导出：Markdown 渲染保持现有消毒/链接策略；`<details>` 白名单。
- Mermaid：不执行用户任意 JS；用官方安全渲染配置。
- 加密 space（P7c）单独安全评审。

---

## 13. Key Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| KD-1 | **Markdown + 派生索引**，不引入块存储引擎 | 保持可移植与现有路径；成本可控 |
| KD-2 | **本 spec 零 AI** | 用户要求；AI 闭环另立 spec |
| KD-3 | **P0 直接 SQLite**（无 JSON 过渡） | 终局查询面；避免二次迁移 |
| KD-4 | 反链基于 **wiki + embed + md link** 出边反查 | 实现直观；与标题重命名策略一致（不自动改全文） |
| KD-5 | 重命名默认 **不** 改写全文；旧标题进 **aliases**；可选「更新反向 wiki」带预览 | 零破坏默认 + 一次到位的工具路径 |
| KD-6 | 嵌入 **只读 + depth 1** | 防环与编辑冲突 |
| KD-7 | 集合视图 = **filter + layout 配置**，不是新文件类型 | 对齐「MD SoT」；避免第二套 DB 文件 |
| KD-8 | 属性以 **frontmatter + space schema** 表达 | 手写与 UI 双路径 |
| KD-9 | Callout 用 `> [!type]`，toggle 用 `<details>` | 可移植；少发明方言 |
| KD-10 | Portable zip **默认不含** `.hip/index.sqlite*`；`schema.json`/`views.json` 可选打包 | DB 可重建；配置可迁移 |
| KD-11 | P7 边界：挂载 **已有 hip space 目录** + 裸 MD **导入**；不做「文件名=标题」双 SoT | 避免与 id 文件模型冲突 |
| KD-12 | 图谱：**成熟库 + lazy chunk**；默认 1 跳邻域，可全图 | 一次做对交互，不拖主包体 |
| KD-13 | PDF：**HTML 管线一次到位**；PDF = 系统打印/另存；不捆绑 Chromium/Pandoc | 安装包与维护成本 |
| KD-14 | git：忽略 `index.sqlite*`；跟踪 `schema.json` / `views.json`；提供建议 `.gitignore` 片段 | 多机无索引冲突 |

---

## 14. Resolved decisions（原 Open Questions）

| # | Question | Decision |
|---|----------|----------|
| 1 | 索引存储 | **SQLite**（space `.hip/index.sqlite`），可重建 |
| 2 | 图谱 | **第三方库 + lazy-load**；邻域默认；软目标 gzip chunk &lt; ~200KB |
| 3 | 外部文件夹 | **进路线图**：挂载 hip 布局 space；裸 MD → 导入向导。文件名保持 `doc_*` id |
| 4 | PDF | **HTML 完整**；PDF 走系统打印。可选本机 Pandoc 为后续 |
| 5 | 看板分组 | **任意 select 字段**，默认 `status` |
| 6 | 重命名链接 | **默认不改写** + 旧名 aliases；提供带预览的批量更新命令 |
| 7 | `.hip/` 与 git | **忽略 DB**；**跟踪 schema/views** |

---

## 15. PR Plan

每个 PR 应可独立合并并带测。顺序反映依赖。终局 schema 按上表锁定，不引入临时格式。

| PR | Title | Depends | Scope |
|----|-------|---------|--------|
| **PR-01** | Link index core (TS parse + SQLite store + rebuild) | — | `knowledge_link_index.rs`，IPC，write 钩子，unit tests |
| **PR-02** | Backlinks + outbound UI | PR-01 | Right panel sections，i18n，e2e smoke |
| **PR-03** | Wiki heading anchors | PR-01 | 语法解析、预览跳转、outline 一致 slug |
| **PR-04** | Embed `![[…]]` | PR-01, PR-03 | 渲染、环/深度、Source 保持原文 |
| **PR-05** | Graph view v1 (lazy) | PR-01 | 邻域图、打开文档、规模降级 |
| **PR-06** | Space schema + extended FM parse | — | schema.json、属性类型、round-trip |
| **PR-07** | Properties row UI for extended fields | PR-06 | DocPropertiesRow 扩展、写回 |
| **PR-08** | Search/filter by extended props | PR-06, PR-01 | facet UI |
| **PR-09** | Views file + Table layout | PR-06, PR-07 | views.json、表编辑写回 |
| **PR-10** | Board layout (any select) | PR-09 | DnD 改分组字段 |
| **PR-11** | Math + Mermaid + callout | — | Preview/Live、slash、CSS |
| **PR-12** | Nested assets | — | Rust asset_path、import、预览 |
| **PR-13** | HTML export + version diff | PR-11 可选 | 导出管线、diff UI |
| **PR-14** | Rename → update backlinks tool | PR-01, PR-02 | 预览 diff + 批量写回 |
| **PR-15** | (Optional) P7 mount + gitignore snippet | review | 挂载 hip space；文档化同步 |

**发布切片：**

- **MVP-Link：** PR-01 … PR-03  
- **MVP-Network：** + PR-04 … PR-05  
- **MVP-Structure：** PR-06 … PR-10  
- **MVP-Polish：** PR-11 … PR-14  

---

## 16. Success metrics（定性）

| 里程碑 | 用户可感知结果 |
|--------|----------------|
| MVP-Link | 「谁链到这篇」可见；可跳进标题 |
| MVP-Network | 可嵌入章节；可从图上逛知识 |
| MVP-Structure | 用表/看板管笔记状态，不必手改 YAML |
| MVP-Polish | 技术笔记（公式/图）可读；HTML 可分享 |

---

## 17. Future（明确不在本 spec 交付）

- 块级 ID / 块引用 / 块聚焦编辑  
- SQL/查询嵌入  
- Notion 级 formula/rollup/relation  
- 协作与评论  
- AI / Agent / Memory 闭环（独立 spec）  
- 闪卡、OCR、移动端、完整 Pandoc Word  
- 插件化知识库扩展 API  

---

## 18. Review checklist（给审核人）

- [ ] 非 AI 边界是否够清晰  
- [ ] P0–P4 优先级是否同意  
- [ ] KD-5 重命名不改写链接是否接受  
- [ ] 集合视图「非真数据库」是否满足预期  
- [ ] P7 默认不承诺是否同意  
- [ ] Open Questions 1–7 决策  
- [ ] PR 切片粒度是否可执行  

---

## Document history

| Date | Change |
|------|--------|
| 2026-07-19 | Initial draft for review（排除 AI 方向） |
| 2026-07-19 | Approved: SQLite、图谱 lazy、看板任意 select、重命名工具、git 规则；见 §14 |
