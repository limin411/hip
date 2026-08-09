# 文档编辑器「＋ / 六点手柄」整改 Spec v3

> 版本：v3.0（2026-08）— **推翻 v1/v2**。  
> v1 只修定位；v2 猜了「两段式竖条」与菜单结构，但**图标几何与布局方向仍然错**。  
> 本版先对照 **Notion 官方帮助中心 / 飞书文档体验拆解 / 语雀块编辑** 的公开说明，再定 hip 目标。
>
> 范围：Live BlockNote 文档正文行首 **`+` 与 `⋮⋮`（六点）** 的布局、图标、颜色、hover、点击菜单。  
> 配套：`docs/design/knowledge/editor/doc-editor-sidemenu-fix-preview.html`  
> 基线：BlockNote 0.52.1 · 改动文件：
> - `src/components/knowledge/DocBlockNoteEditor.tsx`
> - `src/components/knowledge/knowledge-blocknote.css`
> - 少量 i18n 文案

---

## 0. 三家产品怎么做（公开资料对照）

### 0.1 Notion（官方 Help · Writing & editing basics）

来源：https://www.notion.com/help/writing-and-editing-basics

| 控件 | 出现时机 | 点击 | 拖拽 |
|---|---|---|---|
| **`+`** | 悬停**新行/行**时出现在左侧 gutter | 打开**内容类型菜单**（可插入的 block 类型） | — |
| **`⋮⋮`** | 悬停**新行或任意内容块**时出现在左侧 gutter | 打开**块操作菜单** | 按住拖动 = 移动块 |

官方列出的 `⋮⋮` 菜单项（节选）：

- Turn into（转换成其他块类型）
- Color
- Copy link to block
- Duplicate
- Move to
- Delete
- Comment / Suggest edits / Ask AI（协作与 AI，hip 本期可不做）

关键事实：

1. **`+` 与 `⋮⋮` 都是 hover 行/块时出现在左侧 margin**，不是「先手柄再浮出 +」的两段式。  
2. 两者**并列于同一行首高度**（行业复刻与 Tiptap/Notion 风格实现普遍为 **横向** `[+][⋮⋮]`，命中区约 18×24，图标本身更小）。  
3. `+` 打开的是**插入菜单**；`⋮⋮` 打开的是**块操作菜单**；`/` 是同一能力的键盘入口。

### 0.2 飞书文档（体验拆解 · 人人都是产品经理 / 腾讯新闻转载）

来源：https://news.qq.com/rain/a/20220908A06YW800

| 控件 | 出现时机 | 行为 |
|---|---|---|
| **`+` 工具栏** | 鼠标悬浮在文档**空白处/空行** | 悬浮到 `+` 上展开插入菜单 |
| **`⋮⋮` 工具栏** | 鼠标悬浮到**已有区块**左侧 | 悬浮展开：改格式（标题/列表等）、剪切/复制/删除、在下一行添加、**按住拖动分栏/移动** |

关键事实：

1. 飞书把 **「空行插入」** 与 **「已有块操作」** 分得更开：`+` 偏空行，`⋮⋮` 偏已有块。  
2. 仍是 **左侧 gutter、hover 显现、小图标**。  
3. `⋮⋮` 菜单里直接带「转换格式 + 剪贴删 + 添加 + 拖动」。

### 0.3 语雀

来源：公开使用说明 / 块级编辑介绍

- 写完一段后，行侧出现**六个点**。  
- **点击**六点：块操作（转换格式、缩进、剪切等）。  
- **拖拽**六点：调整块位置。  
- 多选：划选多个块后批量操作。

关键事实：语雀以 **六点手柄为主入口**；插入更多依赖 `/` 与工具栏，不如 Notion/飞书强调行首 `+`。

### 0.4 图标几何（开源 Notion 风格实现共识）

多份认真复刻 Notion 的实现（如 pm-toolkit / Tiptap 风格 handle）收敛到：

| 元素 | 规格 |
|---|---|
| 命中区 | **约 18×24px**，背景透明，hover 浅灰底，圆角 4–6px（或接近 pill） |
| 六点图标 | **实心圆点 SVG**，画布约 **8×12**，2 列 × 3 行，点半径 ~1px，列距 4、行距 ~4.5；**不是**大面积 CSS `radial-gradient` 瓷砖 |
| `+` 图标 | **描边十字** SVG ~12–14px，`stroke-width` ~2–2.5，`stroke-linecap: round`；**不是** Material 填充加号 |
| 颜色 | 静息 `rgba(55,53,47,.35)` 级暖灰 / 次级字色；hover 加深 + 浅底 |
| 布局 | **横向** `[+][⋮⋮]`，gap 2px；整体高度贴**块首行** |

参考 SVG（六点，可直接落地）：

```svg
<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
  <circle cx="2.5" cy="2" r="1.25"/>
  <circle cx="7.5" cy="2" r="1.25"/>
  <circle cx="2.5" cy="8" r="1.25"/>
  <circle cx="7.5" cy="8" r="1.25"/>
  <circle cx="2.5" cy="14" r="1.25"/>
  <circle cx="7.5" cy="14" r="1.25"/>
</svg>
```

参考 SVG（+）：

```svg
<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="2.25" stroke-linecap="round">
  <path d="M12 5v14M5 12h14"/>
</svg>
```

也可用 `lucide-react` 的 `Plus`（细线）+ 自绘六点 SVG（**不要**用 `MoreHorizontal` 三横点冒充六点矩阵）。

---

## 1. hip 现状为什么「丑 / 怪」

代码出处：`KnowledgeSideMenu` + `knowledge-blocknote.css`（含 `1e282b2f` 修补）。

| # | 问题 | 证据 | 对照三家 |
|---|---|---|---|
| P1 | **布局方向错**：强制 `flex-direction: column`，变成 28×54 **竖条** | CSS `.bn-side-menu { flex-direction: column }` | Notion/飞书是 **横向** 小按钮组 |
| P2 | **六点用 CSS 渐变假点阵**：`radial-gradient` + `background-size: 10×8`，点小、稀、偏心 | `.bn-button:has([data-test=dragHandle])` | 行业标准是 **实心 SVG 圆点** |
| P3 | **`+` 用 BlockNote 默认 MdAdd 24px 填充图标**，被硬塞进 24×24 按钮 → 粗肥顶满 | `AddBlockButton` icon size 24 | 应是 **14px 级细线 +** |
| P4 | 命中区过大、无「小图标 + 大热区」层次 | 按钮 24×24 且图标等大 | 热区 ~18×24，图标更小 |
| P5 | 颜色 `#999` / tertiary 一律，无 Notion 暖灰层级 | `color: var(--text-tertiary)` | 静息更浅、hover 才加深 |
| P6 | `+` 点击 = 插空段 + **光标处**打开 slash | `AddBlockButton` 内置 | Notion：`+` 打开**插入菜单**（贴手柄） |
| P7 | `⋮⋮` 菜单只有 复制块链接/多选/删除/颜色 | `KnowledgeDragHandleMenu` | 缺 Turn into / Duplicate；项序不像 Notion |
| P8 | 定位无 `offset/shift`，块顶出视口时手柄可消失 | `SideMenuController` 无 middleware | 三家手柄始终可点 |

> 用户说「六点矩阵很丑、+ 很奇怪」——主因是 **P1–P5（视觉）**，不是菜单项文案 alone。v2 若继续用渐变点阵 + 竖条，无论菜单多对都会继续丑。

---

## 2. 目标（hip 取舍）

> **一句话**：行首出现 **横向** 的细线 `+` 与 **紧凑实心六点**；看起来像 Notion/飞书 gutter，而不是 BlockNote demo 的粗按钮；点击行为分别对齐「插入」与「块操作」。

取舍原则（与 DESIGN.md 文档域子语言一致）：

1. **视觉优先对齐 Notion gutter**（横向、小图标、SVG 点阵、暖灰）。  
2. **交互取 Notion 主路径**，吸收飞书「空行更重 +」的提示但不做两套完全分裂 UI（BlockNote 侧栏天然挂在块上）。  
3. **不做**飞书分栏拖蓝线、语雀缩进体系、Notion AI/评论（本期范围外）。  
4. hip 特有能力（块链接 `hip://…#id`、多选）保留，但**不得压过** Turn into / Duplicate / Delete 主路径。

---

## 3. 整改方案

### 3.1 布局：横向 gutter（修丑的第一刀）

```
┌─ block first line ─────────────────────┐
│ [ + ][ ⋮⋮ ]  Paragraph text…           │
└────────────────────────────────────────┘
```

- `.bn-side-menu`：**`flex-direction: row`**，`align-items: center`，`gap: 2px`，`height: auto`，**删除 column 强制**。  
- 每个按钮：`width: 18px; height: 24px`（或 20×24），`border-radius: 4px`，`background: transparent`。  
- hover：`background: var(--state-hover)`，图标色加深。  
- 整体对齐块**首行中线**（paragraph 顶对齐即可；`codeBlock` 可 `translateY` 内容 padding）。

### 3.2 图标：弃渐变，改 SVG

**六点（替换 `display:none` + radial-gradient 方案）**：

- 在 `DragHandleButton` 的 icon 槽位无法直接换时：  
  - **方案 A（推荐）**：自定义 `KnowledgeDragHandleButton` 包装，保留 `draggable` + `blockDragStart/End` + `freezeMenu`，icon 改为内联 SVG 六点。  
  - **方案 B**：继续隐藏默认 chevron，但 **background-image 改为 data-URI 的 SVG 六点**（比 radial-gradient 准），尺寸 `10×16` 居中。  
- **禁止**：继续用 10×8 tile 的 radial-gradient 冒充点阵。  
- 颜色：`color: var(--kb-grip, #b4b2ad)`；hover `#6b6862`（亮色）；暗色用 `rgba(255,255,255,.35/.55)`。

**`+`（弃用默认 MdAdd）**：

- 自研按钮或覆盖 `AddBlockButton` 的 icon 槽：`<Plus size={14} strokeWidth={2.25} />`（lucide 细线）。  
- **禁止**：24px 填充 Material 加号。

### 3.3 显现与定位

- 仍由 BlockNote `SideMenuController` 在块 hover 时挂载（三家都是 hover 显现）。  
- `floatingUIOptions.middleware = [offset(6), shift({ padding: 8 })]`：与文字留 6–8px；块顶出视口时钳回可视区。  
- 动画：opacity 120ms ease，无位移弹跳。

### 3.4 点击行为

#### `+` → 插入菜单（贴手柄右侧）

| 项 | 说明 |
|---|---|
| UI | 自研轻量列表（可复用 slash 目录样式），**贴 `+` 右侧**，不要先插段再在光标处开 slash |
| 数据 | `KNOWLEDGE_SLASH_ITEMS` 核心集：正文 / H1–H3 / 待办 / 无序 / 有序 / 折叠 / 代码 / 引用 / 分割线 / 标注 |
| 语义 | `insertOrUpdateBlockForSlashMenu`：空块转换、非空块下方插入（与 Notion + slash 一致） |
| 关闭 | Escape / 外点 / 选中后 |

#### `⋮⋮` → 块操作菜单（Notion 主路径 + hip 扩展）

顺序：

1. **转换成… ▸**（Turn into，子菜单 = 上表核心类型，`updateBlock` 转换当前块）  
2. **颜色 ▸**（复用 `BlockColorsItem`）  
3. **复制链接到块**（现有 `hip://doc/…#blockId`）  
4. **创制副本**（Duplicate：`insertBlocks([clone], block, 'after')`）  
5. ──  
6. **加入多选**（hip 扩展，保留）  
7. ──  
8. **删除**（红，`RemoveBlockItem`）

- 菜单 `position: "right"`（向内容区展开，避免左缘裁切）。  
- 拖拽：仍走 `DragHandleButton` / 等价 pointer 逻辑；**点击与拖拽冲突**用位移阈值抑制（mousedown 后移动超阈值则不触发 click）。

### 3.5 明确不做

| 项 | 原因 |
|---|---|
| Move to / 飞书分栏蓝线 | 跨页移动与分栏模型未就绪 |
| Comment / AI | 产品未接入 |
| 语雀式缩进菜单 | 与当前大纲模型不一致 |
| 把菜单 portal 到 body | 破坏 CSS 作用域与 SideMenu hover 维持（既有结论） |

---

## 4. 实施清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `knowledge-blocknote.css` | 删 column；横向 gutter；按钮 18×24；删 radial 点阵；SVG/data-URI 六点；细线 +；hover/focus；颜色 token |
| 2 | `DocBlockNoteEditor.tsx` | 自研/包装 `+` 与 drag handle 图标；`KnowledgeAddMenu`；`TurnIntoItem` / `DuplicateBlockItem`；菜单重排；`floatingUIOptions` middleware |
| 3 | i18n | `转换成…` / `创制副本` / `复制链接到块` 等 |
| 4 | 测试 | 现有 editor 测试绿；新增：菜单项顺序、空块转换、duplicate 调用、testid 保留 `kb-side-menu` / `dragHandleAdd` |

## 5. 验收（视觉为主）

- [ ] 悬停块：左侧出现 **横向** `[+][⋮⋮]`，高度贴首行，不呈 54px 竖条。  
- [ ] 六点是 **6 个实心圆点、2×3、紧凑居中**，不糊、不稀、不偏。  
- [ ] `+` 是 **细线十字**，不粗肥。  
- [ ] 静息浅灰、hover 浅底+加深；grab 光标在六点上。  
- [ ] 点 `+`：手柄旁打开插入菜单；空块转换 / 非空插入。  
- [ ] 点 `⋮⋮`：Turn into / 颜色 / 复制链接 / 副本 / 多选 / 删除。  
- [ ] 拖六点可排序；块顶出视口时手柄仍可见。  
- [ ] 与 slash、右键菜单不互相破坏。

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 换图标时破坏 HTML5 drag | 保留 `draggable` + `blockDragStart/End`；e2e 回归拖拽 |
| Mantine 子菜单样式 | 沿用 `BlockColorsItem` 的 `sub` 写法 |
| 横向后窄屏挤压 | gutter 依赖既有 `knowledge-doc-inline-pad`（32/48/64） |

## 7. 回退

单提交可整体 revert；视觉改动集中在 side-menu CSS + KnowledgeSideMenu 一段。
