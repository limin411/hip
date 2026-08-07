# Knowledge 文档编辑器体验提升 Spec

> **状态**: Implemented (Phase 0–3)  
> **实现说明**: custom BlockNote schema + dialect bridge；PageHeader/Find/Version/AI slash；cover/properties/toggle/highlight/replace；关窗 dirty 拦截。Phase 4（columns/meta.json/大纲拖拽/fs watch/虚拟化）未做。  
> **对照产品**: Notion · 飞书文档 · 语雀  
> **范围**: 本地优先知识库文档编辑体验（`~/.hip/knowledge/`）  
> **非目标**: 多端实时协同 CRDT、企业权限/评论体系、完整 Database 产品线  
> **代码锚点**: `src/components/knowledge/*` · `src/domain/knowledge/*` · `src/store/knowledgeStore.ts` · `src-tauri/src/knowledge*.rs`

---

## 0. 一句话目标

把 hip Knowledge 从「能写 Markdown 的本地库」提升到 **Notion/飞书级块编辑手感 + 语雀级阅读排版 + 本地文件可逆向**，同时保留 Source 逃生舱与 AI Workbench 集成优势。

---

## 1. 现状基线（代码事实）

### 1.1 已具备（不必重做）

| 能力 | 实现 |
|------|------|
| 双模式 | Live = BlockNote 0.52；Source = CodeMirror + Typora 就地预览 |
| 产品默认 | 单画布 Live（`editorMode`：`preview` 已废弃并归一到 `live`） |
| Slash | Live/Source 共享目录 `slashMenu.ts` + BN 映射 `blockNoteSlash.ts` |
| Wiki | `[[title]]` 补全、断链确认创建、别名解析、改名回写 |
| 嵌入 | `![[doc]]` Reader 卡片 + 深度上限（`KnowledgeEmbedCard`） |
| 图谱 | 出链 / 反链 / Graph modal + link index（Rust） |
| 媒体方言 | Mermaid / SVG fence、`$$` 数学、GFM 任务列表 |
| Callout | Reader 识别 `> [!note]`；Live 以 MD carrier 插入 |
| 表格 | BN 原生 table（headers on） |
| 资源 | 粘贴/拖入图片、路径导入、25MB 盘上限 / 1.5MB IPC 内联 |
| 页面 chrome | 面包屑、内联标题、保存态、Live↔Source 切换、大纲 scrollspy |
| 生命周期 | 模板、日更+手动版本（cap 30）、回收站、导出 md/html/zip |
| Frontmatter | tags / aliases / status / date / priority / icon |
| 性能门禁 | 大文档 `512k` 强制 Source；perf e2e budgets |

### 1.2 与标杆的核心差距（本 Spec 聚焦）

```
                    Notion / 飞书 / 语雀          hip 现状
块语义保真          一等公民块 + 稳定 ID          MD lossy 往返（产品已接受，但体验天花板）
块类型丰富度        Toggle / 分栏 / 高亮块…       基础块 + fence 载体
行内对象            提及芯片、行内公式、标注      wiki 仍是纯文本；Live 内公式/图未可视化
块操作手感          多选、变体、颜色、快捷移动    依赖 BN 默认 side menu，能力未产品化
页面头图/属性       Cover + Icon + 属性条         标题行 + FM 半隐式
媒体块              缩放/题注/对齐/书签卡片       插入路径有，块级 UX 薄
查找替换 / 定位     文档内 F&R、稳定锚点          Source 有 searchKeymap；Live 弱
版本可读性          时间线 + 可视化 diff          列表 + 文本 diff 雏形
AI 写作             块级续写/改写/摘要            未接入（hip 最大差异化空位）
长文性能            虚拟化 / 分片                  超阈降级 Source
```

### 1.3 不可违背的产品约束

1. **本地文件为真源**：磁盘上仍是可读 Markdown（+ YAML），不引入仅专有二进制为唯一存储。  
2. **Live 可降级 Source**：解析失败 / 大文档 / flag off → Source，数据不丢。  
3. **Lossy 必须可量化**：每一种块有「往返保真等级」，不允许静默吃内容。  
4. **桌面本地优先**：不做多人实时协同首期；评论/权限若做，也是本地注解而非服务端 ACL。  
5. **视觉服从 `DESIGN.md`**：固体、边界、克制动效；禁止玻璃拟态与消费级花活。  
6. **Board/Database 不复活为编辑器主线**（树里 board 已隐藏）；结构化视图若重启，另开 Database Spec。

---

## 2. 体验原则（对标后的 hip 取舍）

| # | 原则 | 含义 |
|---|------|------|
| P1 | **块即对象** | 用户操作的是块，不是「一串字符碰巧排版了」 |
| P2 | **所见即所得优先，源码永远可逃** | Live 为主路径；Source 是专家模式与灾难恢复 |
| P3 | **方言可视化** | callout / mermaid / math / embed / wiki 在 Live 必须有 NodeView，而不是裸 MD |
| P4 | **往返诚实** | 做不到无损的块，要有 Source badge 或降级提示，禁止假装 |
| P5 | **键盘 > 鼠标 > 菜单** | Notion 级快捷键密度；IME 组合中不抢键 |
| P6 | **阅读与写作同画布** | 不再提供独立 Preview 写作模式；Reader 仅用于嵌入/导出预览 |
| P7 | **AI 是一等入口** | `/ai` 与块手柄「问 hip」与主 Agent 同栈，而非外挂侧栏文案 |

---

## 3. 信息架构：页面画布

### 3.1 目标布局（Live 文档）

```
┌─ chrome ──────────────────────────────────────────────────────┐
│ ← breadcrumb … / Folder / Doc          [saved] [Live|Source] ⋯ │
├─ page header ─────────────────────────────────────────────────┤
│ [cover optional]                                               │
│ 📄 icon   Title (display H1, renames tree)                     │
│ tags · status · aliases  (property chips, from frontmatter)    │
├─ body (measure ~46rem) ───────────────────────────────────────┤
│  empty hint / blocks …                                         │
│  +  side-menu   drag   ⋮                                       │
├─ footer meta ─────────────────────────────────────────────────┤
│  backlinks summary · word count · last edited                  │
└────────────────────────────────────────────────────────────────┘
         right rail: Outline · Backlinks · Outbound（已有，增强）
```

### 3.2 页面头（对标 Notion/语雀）

| 项 | 需求 | 现状 | 优先级 |
|----|------|------|--------|
| Cover | 可选头图；拖入/资源库；高度 120–200px；position 微调 | 无 | P1 |
| Icon | emoji/短字符；与 `frontmatter.icon` 双向；树节点可显示 | FM 有字段，UI 不完整 | P0 |
| Title | 画布内大标题 = 树 title；禁止再复制一份 H1 进 body | `InlineDocTitle` 在 chrome | P0：下沉到 page header |
| Properties | chips 编辑 tags/status/date/priority/aliases | 搜索索引用，无页面编辑器 | P1 |
| Word count | 页脚静默展示 | 无 | P2 |

**验收**

- 改 icon/title/tags 不污染 body Markdown 语义（仍写 FM 或 tree.json）。  
- Cover 存 `assets/` + FM `cover: rel/path`；删除文档进回收站时资源策略与现资产一致。

---

## 4. 块模型与保真矩阵

### 4.1 存储策略（演进，不一次重写）

**Phase A（本 Spec 主路径）**：继续 **Markdown + YAML**，对 hip 方言引入 **稳定 carrier + 自定义 BlockNote block specs**。  
**Phase B（可选后续）**：同目录旁路 `doc.meta.json`（块 ID、折叠态、cover crop）——仅存「MD 表达不了的 UI 态」，body 仍 MD。

```
disk:  notes/doc_xxx.md
       notes/doc_xxx.meta.json   # optional, Phase B
       assets/...
```

### 4.2 保真等级定义

| 等级 | 含义 |
|------|------|
| **L3 无损** | Live ↔ Source ↔ Disk 三次往返，语义与可编辑结构一致 |
| **L2 语义保** | 内容与类型在；次要 UI 态（列宽、折叠）可丢 |
| **L1 内容保** | 文本/媒体在；类型可能退化为 paragraph/code/quote |
| **L0 禁止** | 会丢用户正文 → 不允许上线 |

### 4.3 块类型路线图

| 块 | 目标形态 | MD carrier | 保真 | 优先级 | 备注 |
|----|----------|------------|------|--------|------|
| paragraph / h1–h3 | BN 原生 | ATX | L3 | — | 已有；补 h4？P2 |
| bullet / ordered / task | BN 原生 | GFM list | L3 | — | 嵌套缩进体验 P0 |
| quote | BN 原生 | `>` | L3 | — | |
| divider | BN 原生 | `---` | L3 | — | |
| code | BN + 语言选择器 + 主题 | fenced | L3 | P0 | 语言菜单、复制按钮 |
| table | BN table + 行列操控 | GFM table | L2 | P0 | 列宽 L2 可丢 |
| image | 自定义：缩放/对齐/题注 | `![alt](path)` + 可选 title | L2 | P0 | |
| callout | **自定义 NodeView** | `> [!type] title` | L3 | **P0** | 今日 Live 无样式是最大观感落差 |
| math block | KaTeX NodeView | `$$…$$` | L3 | P0 | |
| mermaid | 预览+源码切换 NodeView | ` ```mermaid ` | L3 | P0 | |
| svg | 消毒预览 NodeView | ` ```svg ` | L3 | P1 | 沿用 `sanitizeSvg` |
| wiki link | **inline mark/chip** | `[[title\|alias]]` | L3 | **P0** | 今日纯文本点击脆弱 |
| embed | 块级卡片 NodeView | `![[title#frag]]` | L2 | P0 | 复用 EmbedCard 逻辑 |
| toggle / fold | 自定义 | `<details>` 或 `> [!toggle]` 方言 | L2 | P1 | 飞书/Notion 高频 |
| columns | 2–3 栏 | HTML comment / meta.json | L1–L2 | P2 | 无 meta 时降级纵向 |
| bookmark | 链接卡片 | `[title](url)` + FM tip | L2 | P2 | 本地不抓网页也可手填 |
| file / pdf | 附件卡 | `[name](assets/…)` | L2 | P1 | PDF 可系统打开 |
| AI block | 提示块（可选固化结果） | HTML comment carrier | L1 | P1 | 见 §9 |

**明确不做（本 Spec）**：完整 Database 属性列、看板、公式列、Synced Block 跨页实时、多人评论线程。

### 4.4 自定义块工程约定

1. 一律 `createReactBlockSpec` / inline spec，集中注册于 `src/domain/knowledge/blocks/`。  
2. `blocksToMarkdown` / `tryParseMarkdownToBlocks` **必须成对测**（golden fixtures）。  
3. 扩展 `DIALECT_PRESERVE_MARKERS`；CI 跑 `dialectRoundTrip` + 新 `blockRoundTrip.test.ts`。  
4. Live 卸载继续沿用 `hardenTiptapViewTeardown`；新 NodeView 不得在 unmount 抛错。  
5. CSS 走 `knowledge-blocknote.css` + design tokens，不引入第二套 Mantine 主题语义色。

---

## 5. 编辑手感（对标 Notion/飞书的「肌肉记忆」）

### 5.1 Slash 菜单 2.0

**现状**：分组 basic/list/media/advanced，中英关键词，hip 定制菜单组件。  

**提升**

| 项 | 说明 | 优先级 |
|----|------|--------|
| 预览条 | 悬停/高亮项右侧示意（callout 色、表格骨架） | P1 |
| 最近使用 | 本地记 top 8，空 query 置顶 | P1 |
| 子类型 | callout 一次选出 note/tip/warning… | P0 |
| AI 分组 | `ai` group：续写/总结/转任务/解释代码 | P1 |
| 空态文案 | 新段落 placeholder：`输入文字，或 / 唤起命令` | P0 |
| 与 Source 对齐 | Source 菜单视觉与 Live 统一（现已接近） | P2 |

### 5.2 选区与气泡工具条

**现状**：BN `FormattingToolbar`（粗斜下划删除线 code link + BlockTypeSelect）。  

**提升**

| 项 | 说明 | 优先级 |
|----|------|--------|
| 高亮色 / 文字色 | 有限色板（design token 6 色）；MD 用 `==highlight==` 或 `<mark>`，定一种 | P1 |
| 行内代码与链路互斥清晰 | 避免套娃 | P0 |
| 行内公式 | `$…$` mark + KaTeX | P1 |
| 清除格式 | 一键 | P1 |
| 块类型「转变为」 | 与 side menu 共用 transform 表 | P0 |
| 对齐 | 仅 image/embed；正文不提供任意 align（保持 prose 简洁） | P1 |

### 5.3 块手柄（Side menu）产品化

对标 Notion `⠿` / 飞书「⋮⋮」：

| 操作 | 快捷键（建议） | 优先级 |
|------|----------------|--------|
| 拖拽排序 | 鼠标 | P0（BN 已有，校验嵌套列表） |
| 打开块菜单 | `Mod+/` 或 `Esc` 后 `Mod+Shift+M` | P0 |
| 复制块 | `Mod+D` | P0 |
| 删除块 | `Mod+Shift+Backspace` | P0 |
| 上/下移 | `Mod+Shift+↑/↓` | P0 |
| 缩进/反缩进 | `Tab` / `Shift+Tab` | **P0** |
| 插入下方 | `Enter` 行为保持 BN；空块 `/` | — |
| 转为 toggle 子项 | 菜单 | P1 |
| 问 AI | 菜单项 | P1 |

**多选块**：Shift+点击 handles 多选 → 批量 transform / 删除 / 包装 quote（P1）。

### 5.4 Markdown 行首语法糖（飞书/Notion 均有）

在 Live 中保证（IME 结束后）：

| 输入 | 结果 |
|------|------|
| `#`–`###` + space | heading |
| `-` / `*` + space | bullet |
| `1.` + space | ordered |
| `[]` / `[ ]` + space | task |
| `>` + space | quote |
| ` ``` ` | code |
| `---` | divider |
| `[[` | wiki picker（已有，稳定位） |

Source 侧 Typora 预览已覆盖视觉；语法糖以 CM 命令保持。

### 5.5 键盘与 IME

- 所有自定义 `keydown` 必须 `if (e.isComposing) return`（Live/Source 已有范例，扩展时 retro-check）。  
- `Mod-s` 双模式 flush+save（已有）。  
- 文档内查找：Live 补 `Mod-f` 面板（高亮 + 上一个/下一个 + 可选替换）——**P0**。  
- `Mod-Click` wiki 导航；普通 click 定位光标（修正今日「整段是 link 才可点」的脆弱逻辑）——**P0**。

### 5.6 表格体验（语雀/飞书高频）

| 项 | 优先级 |
|----|--------|
| 右键/手柄：插删行列、表头行切换 | P0 |
| Tab 在单元格间移动，末格 Tab 新增行 | P0 |
| 粘贴 TSV/CSV 智能扩表 | P1 |
| 单元格内基础 marks | P1 |
| 不把表格升级成 Database | — |

---

## 6. 方言可视化（最大「看起来不像 Notion」的原因）

### 6.1 Callout（P0）

- Live：左边色条 + 类型图标 + 可编辑 title + body（可多段落）。  
- 类型切换菜单：note/tip/info/warning/danger/important…（与 `callout.ts` 对齐）。  
- Source/Reader：保持 `> [!type]`。  
- Slash：`/callout` 后二级类型 或 `/tip` `/warn` 别名。

### 6.2 Wiki chip（P0）

- 解析为 inline atom/mark：显示 title，broken 用 danger 虚线样式。  
- Hover 浮层：路径面包屑 + 打开 + 反链数（可选）。  
- 输入 `[[`：光标锚定的 picker（修 BN 里用整篇 MD 估 caret 的近似问题）。  
- 序列化必须回到 `[[title]]` / `[[title\|alias]]`。

### 6.3 Embed 卡片（P0）

- Live 内直接渲染只读卡片（复用 `KnowledgeEmbedCard`），点击标题 openDoc。  
- 编辑：块菜单「更换目标 / 指定标题片段 / 转为 wiki 链接」。  
- 深度策略与现 `EMBED_MAX_DEPTH` 一致。

### 6.4 Mermaid / Math / SVG（P0–P1）

- 默认预览态；双击或「编辑」切源码态（对标语雀公式/画图）。  
- Mermaid 跟随 dark class 重渲染（已有测试模式，接到 NodeView）。  
- Math：KaTeX；错误时红框 + 源码回退。  
- SVG：必须走 `sanitizeSvg`，禁止 raw script。

### 6.5 图片块（P0）

- 点选显示宽度手柄（预设 25/50/75/100% 或 px）。  
- 题注 caption → MD title 或下一行 `*` 强调（需在 round-trip 文档写死一种）。  
- 对齐：默认 center content column；full-bleed 可选（P2）。  
- 失败占位 + 重试（资产缺失）。

---

## 7. 导航、结构与知识网络

### 7.1 大纲

**已有**：右栏 Outline + scrollspy + jump。  

**提升**

- 从 **Live 块树** 直接取 heading（避免 draft MD 防抖 200ms 的滞后感）——P1。  
- 拖拽大纲重排 → 重排文档块（P2，谨慎做）。  
- 折叠大纲层级记忆（localStorage）——P2。

### 7.2 反链 / 出链

**已有**：panel + index。  

**提升**

- 反链条目展示上下文 snippet（左右各 ~40 字）——P1。  
- Broken 出链一键「创建并替换」批量——P1。  
- 页脚「被 N 篇引用」点击打开反链面板——P2。

### 7.3 文档内锚点

- Heading 稳定 `id`（BN `setIdAttribute: true` 已开）：外链 `doc#slug` 与 embed fragment 统一算法（`slugifyHeading`）——P0 对齐审计。  
- Source 模式 jump 与 Live 同一套 occurrence 规则（Workspace 已有部分逻辑，补测试）。

### 7.4 树与画布一致性

- 树 icon 显示 FM/space icon。  
- 从画布「复制页面链接」→ `hip://knowledge/<space>/<doc>` 或内部路由 token（P1，便于 Agent 引用）。  
- 子页面：继续用 folder/tree，不引入 Notion subpage 块（避免双结构）；Slash「子文档」= 在当前父级 `createDoc` + 插入 wiki——P1。

---

## 8. 版本、保存与信任感

### 8.1 保存

**已有**：节流 draft、autosave、saveState 点、失败重试。  

**提升**

| 项 | 优先级 |
|----|--------|
| 离焦点 / 切文档 / 切模式 **强制 flush**（部分已有，做矩阵测试） | P0 |
| 「未保存」关闭窗口拦截（Tauri close 与 tray 策略对齐） | P0 |
| saved 态 2s 后淡出，避免常驻噪音 | P1 |
| 冲突：外部改文件 → 提示 reload/keep（fs watch 可选） | P2 |

### 8.2 版本历史（对标语雀历史 / Notion History）

**已有**：daily + manual、list/read/restore、简易 line diff。  

**提升**

| 项 | 优先级 |
|----|--------|
| 时间线 UI（今日 / 更早分组） | P0 |
| 并排或 inline diff 高亮（复用 `textDiff`） | P0 |
| 预览只读渲染（Reader 管线）再决定恢复 | P1 |
| 恢复前自动 manual snapshot（已 flush） | P0 确认 |
| 命名版本（optional label 字段） | P2 |
| cap 30 可设置 | P2 |

---

## 9. AI 写作（hip 差异化，对标「飞书智能创作」但更深）

> hip 是 AI workbench：Knowledge 不应只是「另一套笔记」，而应是 Agent 的可写记忆表面。

### 9.1 入口

1. Slash：`/ai`、`/续写`、`/总结`、`/转任务`  
2. 块菜单：「用 Agent 改写」  
3. 选区气泡：「解释 / 缩短 / 更正式 / 译为…」  
4. 页面级：「根据会话生成文档」（已有会话 → 知识库沉淀，可后续）

### 9.2 行为

- 默认调用当前默认 Agent/模型；需权限确认的工具仍走 hip hitl。  
- 流式插入下方新块；用户 Esc 取消。  
- 结果可「替换选区」或「保留为 AI 块（可折叠）」——P1。  
- **绝不**在未确认时静默改全篇。

### 9.3 上下文打包

- 当前文档标题 + 大纲 + 选区 +（可选）反链 top N。  
- 遵守大文档 cap：只送 outline + 局部窗口。

### 9.4 非目标

- 不在编辑器内再造完整 Chat UI；深聊跳转主会话并带 `knowledgeDocId` 引用。

---

## 10. 性能与大文档

| 场景 | 目标 | 手段 | 优先级 |
|------|------|------|--------|
| 冷开 Live ≤ 阈值阈值 | 保持/收紧现 `knowledge-perf` budget | 解析 worker 化可选 | P1 |
| 输入延迟 | 打字无可见 jank | draft 节流 120ms 已有；序列化移 idle | P0 审计 |
| 512k+ | 仍强制 Source（可提示「性能模式」） | 已有 | — |
| 长文档滚动 | 稳定 60fps | 图片懒加载；Mermaid 视口内渲染 | P1 |
| 全库搜索 | 保持 MiniSearch 增量 | 已有 | — |
| 虚拟化 | 仅当 block count > N | 调研 BN 可行性；否则维持 Source 降级 | P2 |

---

## 11. 无障碍、i18n、平台

- 块菜单/slash 完整键盘操作与 `aria-activedescendant`（菜单已有基础，补 Live）。  
- 所有新增文案走 i18n（en/ja/ko/zh-CN/zh-TW）。  
- 快捷键文案 mac `⌘` / win `Ctrl` 自适应。  
- 触控板：侧栏与画布滚动链不抢（已有 scroller 分离，回归测）。  
- 对比度：callout / chip 在 dark/light 均 AA。

---

## 12. Source 模式定位（对标「语雀 MD 模式 / Notion 无源码」的中间道路）

Source **不是二等公民**，而是：

1. 大文档与排障；  
2. 精确 MD/方言编辑；  
3. Typora 级就地预览（已有 `typoraLivePreview`）。  

**提升**

| 项 | 优先级 |
|----|--------|
| Live↔Source 往返前后 diff 提示（若 L1 降级发生 toast） | P0 |
| Source 状态栏：行列、字数、FM on/off | P2 |
| 与 Live 快捷键表文档化（帮助面板） | P1 |
| 不恢复 Preview 三分模式 | — |

---

## 13. 分阶段交付

### Phase 0 — 信任与基线（1 迭代）

- 往返保真矩阵文档化 + golden fixtures 扩容  
- 保存/切页/切模式/关窗 flush 矩阵测试  
- Wiki 点击与 picker 定位修复  
- 文档内 Live `Mod-f`  
- Page header：title 下沉 + icon 编辑  

**成功标准**：无新增块类型的情况下，KE e2e 全绿；wiki 导航误触率手测可接受。

### Phase 1 — 方言可视化与块手感（核心，2–3 迭代）**← 对齐 Notion/飞书观感的关键路径**

- Callout / Wiki chip / Embed card / Math / Mermaid NodeViews  
- 图片宽度 + caption  
- Tab 缩进、块复制/移动/删除快捷键  
- 表格行列操控  
- Slash 二级 callout + 空态 placeholder  
- 版本时间线 + diff 预览  

**成功标准**：新用户截图对比可感知「像文档产品」；dialect fixtures L3 全过。

### Phase 2 — 页面属性与结构（1–2 迭代）

- Cover、property chips  
- Toggle 块  
- 反链 snippet、broken 批量创建  
- 查找替换  
- 高亮色  

### Phase 3 — AI 与附件（1–2 迭代）

- Slash/选区/块菜单 AI 动作  
- 文件/PDF 卡、bookmark  
- 页面链接 scheme  
- 「子文档」slash  

### Phase 4 — 可选深化

- columns + meta.json  
- 大纲拖拽重排  
- 外部文件变更 watch  
- 块虚拟化调研  

---

## 14. 明确 Out of Scope（避免 scope creep）

| 项 | 原因 |
|----|------|
| 多人实时协同 / 光标 | 本地优先架构；成本高 |
| 评论/建议模式 | 无账号体系；可未来做本地 annotation 另开 spec |
| Notion Database / 飞书多维表格 | 与 MD 真源冲突大；board 已移除 |
| 所见即所得 HTML 邮件式排版 | 违背 prose 与 MD 可逆 |
| 重写为仅 JSON block 存储 | 破坏「文件系统内容」承诺 |
| 移动端原生编辑 | 当前 Tauri 桌面 |

---

## 15. 测试与验收

### 15.1 自动化

| 层 | 内容 |
|----|------|
| Unit | 每块 `parse ↔ serialize` golden；callout/wiki/embed/math/mermaid |
| Component | NodeView 交互（类型切换、chip 点击、图片 resize 键盘） |
| Store | flush 矩阵；version restore 前 snapshot |
| E2E `@knowledge` | 扩展 live-r*：callout 可见样式、wiki chip 导航、表格 Tab 增行、Mod-f、AI mock |
| Perf | 既有 `knowledge-perf`；新增「100 块 mermaid 关闭」预算 |

### 15.2 手感验收清单（Dogfood）

- [ ] 连续输入中文 IME 不弹 slash、不丢字  
- [ ] `/` 菜单键盘仅能完成 10 种常用块  
- [ ] 从空页到「带 callout + 表格 + 图 + 双链」&lt; 60s  
- [ ] Live 编辑后 Source 打开，无正文丢失  
- [ ] Source 改 callout 类型后回 Live 样式正确  
- [ ] 500KB 级文档自动 Source 且提示清晰  
- [ ] 版本恢复可预览再确认  
- [ ] 暗色模式 callout/代码/mermaid 可读  

### 15.3 竞品对照题（评审用）

1. **Notion**：块手柄 + slash + toggle + 多选是否达到 80% 日用？  
2. **飞书文档**：标题区属性、表格编辑、图片、查找是否不挫败？  
3. **语雀**：阅读排版（measure、标题层级、callout、代码）是否舒适？  
4. **hip 独有**：AI 改写与 wiki 网络是否形成「愿意把结论写在这」的理由？

---

## 16. 风险与决策点（需产品拍板）

| ID | 问题 | 选项 | 建议 |
|----|------|------|------|
| D1 | 高亮语法 | `==x==` vs `<mark>` | `==x==`（Obsidian 友好） |
| D2 | Toggle carrier | `<details>` vs `> [!toggle]` | `<details>` 更通用 |
| D3 | 列宽/封面 crop | 只 FM vs meta.json | Phase 2 末再开 meta.json |
| D4 | 行内公式分隔 | `$` vs `\(` | `$`，代码中需避免误伤 |
| D5 | AI 默认模型 | 跟随全局 vs 知识库专用 | 跟随全局 |
| D6 | Title 是否允许 body H1 重复 | 禁 / 警告 / 允许 | **禁止自动生成；已有 H1 不删除但 UI 不以之为 title** |
| D7 | Columns 无 meta 时 | 禁止 / 纵向降级 | 纵向降级 + Source 提示 |

---

## 17. 代码落点建议（实施时）

```
src/domain/knowledge/
  blocks/                 # 新：block specs + md mapping + goldens
    calloutBlock.ts
    wikiInline.ts
    embedBlock.ts
    mathBlock.ts
    mermaidBlock.ts
    imageBlock.ts
    toggleBlock.ts
  blockRegistry.ts        # 注册表，供 DocBlockNoteEditor 使用
  fidelityMatrix.md       # 或 .ts 导出供测试

src/components/knowledge/
  DocBlockNoteEditor.tsx  # 变薄：组合 registry + find UI + keymap
  page/                   # PageCover, PageIcon, PageProperties
  find/                   # DocFindBar
  version/                # VersionTimeline, VersionDiff

src/domain/knowledge/ai/
  knowledgeAiActions.ts   # 选区打包 + 调用 session/agent 门面
```

原则：**DocBlockNoteEditor 继续做 host**，不再堆 900+ 行业务；新块与 AI 全部 domain 化便于单测。

---

## 18. 成功度量（发版后）

| 指标 | 基线 | 目标 |
|------|------|------|
| Live 默认会话占比 | 已 default on | &gt; 90% 文档打开落在 Live |
| Live→Source 被动降级 | 大文档/解析失败 | 解析失败 &lt; 1% 抽样 |
| 方言块 L3 测试 | 部分 markers | 100% 表内 L3 块 |
| Dogfood「愿意日用」主观分 | — | ≥ 飞书文档日用 4/5（内部） |
| AI 动作周活 | 0 | 内部 dogfood 可测 |

---

## 19. 附录 A — 现状文件地图（速查）

| 路径 | 职责 |
|------|------|
| `DocBlockNoteEditor.tsx` | Live host |
| `DocEditor.tsx` | Source CM + Typora |
| `KnowledgeWorkspace.tsx` | 布局、保存、版本、导出、模式 |
| `slashMenu.ts` / `blockNoteSlash.ts` | Slash 目录与 BN 映射 |
| `editorMode.ts` | Live flag / per-doc mode |
| `frontmatter.ts` | YAML 语义 |
| `wikiLink.ts` / `linkIndex` | 双链 |
| `callout.ts` + `KnowledgeMarkdownBody` | Reader 方言 |
| `knowledgeStore.ts` | 树/文档/保存/搜索/版本 |
| `src-tauri/src/knowledge.rs` | FS、版本、导入导出 |

## 附录 B — 快捷键目标总表（Phase 1 末应文档化到 UI）

| 快捷键 | 动作 |
|--------|------|
| `Mod+B/I/E` | 粗 / 斜 / 行内代码 |
| `Mod+Shift+S` | 删除线（若启用） |
| `Mod+K` | 链接 |
| `Mod+Alt+1..3` | 标题（已有） |
| `Mod+Shift+7/8` | 有序/无序（已有） |
| `Mod+Shift+.` | 引用（已有） |
| `Tab` / `Shift+Tab` | 缩进 |
| `Mod+D` | 复制块 |
| `Mod+Shift+↑/↓` | 移动块 |
| `Mod+Shift+Backspace` | 删除块 |
| `Mod+F` | 查找 |
| `Mod+Alt+F` | 查找替换 |
| `Mod+S` | 保存 |
| `/` | Slash |
| `[[` | Wiki |
| `Mod+Click` | 打开链接/wiki |

---

## 附录 C — 修订记录

| 日期 | 变更 |
|------|------|
| 2026-08-07 | 初稿：基于当前 BlockNote Live + CM Source 代码基线，对照 Notion/飞书/语雀列出分阶段提升 Spec |
